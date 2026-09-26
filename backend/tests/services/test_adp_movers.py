from datetime import date
from unittest.mock import patch

import pytest

from app.services import adp_movers, adp_snapshots
from app.services.adp_snapshots import SnapshotMeta

D20, D21, D22, D23, D25 = (date(2026, 9, d) for d in (20, 21, 22, 23, 25))


def _row(name, adp=None, ranking=None):
    return [None, name, adp, [], ranking]


@pytest.fixture
def store():
    """(provider, day) -> payload, served through patched adp_snapshots reads."""
    data: dict[tuple[str, date], list] = {}

    async def list_snapshots():
        metas = []
        for (provider, day), payload in data.items():
            adp_hash, ranking_hash = adp_snapshots.payload_hashes(payload)
            metas.append(SnapshotMeta(provider, day, adp_hash, ranking_hash))
        return metas

    async def load_payload(provider, day):
        return data.get((provider, day))

    adp_movers.reset_movers_cache()
    with (
        patch.object(adp_snapshots, "list_snapshots", list_snapshots),
        patch.object(adp_snapshots, "load_payload", load_payload),
        patch("app.services.adp_service.nba_player_catalog.list_all_bios", return_value={}),
        patch.object(adp_movers, "today_utc", return_value=D25),
    ):
        yield data
    adp_movers.reset_movers_cache()


def _names(movers):
    return [(m.name, m.delta) for m in movers]


@pytest.mark.asyncio
async def test_range_reports_risers_and_fallers_per_site(store):
    store[("espn", D21)] = [_row("Riser", 92.6), _row("Faller", 88.8), _row("Still", 10.0)]
    store[("espn", D25)] = [_row("Riser", 69.2), _row("Faller", 115.5), _row("Still", 10.0)]

    resp = await adp_movers.get_movers(metric="adp", sites="espn", from_date=D22, to_date=D25)

    assert [s.key for s in resp.sections] == ["espn"]  # one site: no Blend section
    espn = resp.sections[0]
    assert (espn.from_date, espn.to_date) == ("2026-09-21", "2026-09-25")
    assert _names(espn.risers) == [("Riser", 23.4)]
    assert _names(espn.fallers) == [("Faller", -26.7)]
    assert espn.compared == 3


@pytest.mark.asyncio
async def test_top_filter_drops_deep_players_on_both_ends(store):
    store[("fantrax", D21)] = [_row("Deep", 230.0), _row("Edge", 160.0)]
    store[("fantrax", D25)] = [_row("Deep", 220.0), _row("Edge", 140.0)]

    resp = await adp_movers.get_movers(metric="adp", sites="fantrax", from_date=D21, top=150)
    assert _names(resp.sections[0].risers) == [("Edge", 20.0)]

    everyone = await adp_movers.get_movers(metric="adp", sites="fantrax", from_date=D21, top=0)
    assert {m.name for m in everyone.sections[0].risers} == {"Deep", "Edge"}


@pytest.mark.asyncio
async def test_new_and_dropped_players_are_listed_separately_not_as_moves(store):
    store[("espn", D21)] = [_row("Old", 50.0), _row("Stay", 20.0)]
    store[("espn", D25)] = [_row("New", 60.0), _row("Stay", 20.0)]

    section = (await adp_movers.get_movers(metric="adp", sites="espn", from_date=D21)).sections[0]
    assert section.risers == [] and section.fallers == []
    assert [(m.name, m.to_value) for m in section.entered] == [("New", 60.0)]
    assert [(m.name, m.from_value) for m in section.exited] == [("Old", 50.0)]


@pytest.mark.asyncio
async def test_blend_uses_only_sites_listing_the_player_at_both_ends(store):
    store[("espn", D21)] = [_row("Paul Reed", 40.0)]
    store[("espn", D25)] = [_row("Paul Reed", 30.0)]
    # Yahoo starts listing P at 80: joining the blend is not a fall.
    store[("yahoo", D21)] = [_row("Other", 5.0)]
    store[("yahoo", D25)] = [_row("Paul Reed", 80.0), _row("Other", 5.0)]

    resp = await adp_movers.get_movers(metric="adp", sites="espn,yahoo", from_date=D21)
    blend = resp.sections[0]
    assert blend.key == "blend"
    assert _names(blend.risers) == [("Paul Reed", 10.0)]
    assert blend.fallers == []


@pytest.mark.asyncio
async def test_history_start_is_used_when_range_reaches_before_it(store):
    store[("yahoo", D23)] = [_row("Paul Reed", 50.0)]
    store[("yahoo", D25)] = [_row("Paul Reed", 45.0)]

    section = (await adp_movers.get_movers(metric="adp", sites="yahoo", from_date=D20)).sections[0]
    assert section.from_date == "2026-09-23"
    assert section.note == "History starts 2026-09-23."
    assert _names(section.risers) == [("Paul Reed", 5.0)]


@pytest.mark.asyncio
async def test_single_snapshot_explains_itself(store):
    store[("espn", D25)] = [_row("Paul Reed", 50.0)]
    section = (await adp_movers.get_movers(metric="adp", sites="espn")).sections[0]
    assert section.risers == []
    assert "Only one snapshot" in (section.note or "")


@pytest.mark.asyncio
async def test_last_update_compares_latest_rankings_version_with_the_one_before(store):
    # Rankings change on the 21st and 23rd; ADP moves daily and must not count as updates.
    store[("espn", D20)] = [_row("A", 10.0, 5), _row("B", 20.0, 6)]
    store[("espn", D21)] = [_row("A", 11.0, 6), _row("B", 21.0, 5)]
    store[("espn", D22)] = [_row("A", 12.0, 6), _row("B", 22.0, 5)]
    store[("espn", D23)] = [_row("A", 13.0, 2), _row("B", 23.0, 9)]
    store[("espn", D25)] = [_row("A", 14.0, 2), _row("B", 24.0, 9)]

    resp = await adp_movers.get_movers(metric="rank", sites="espn", mode="last_update")
    section = resp.sections[0]
    assert (section.from_date, section.to_date) == ("2026-09-22", "2026-09-23")
    assert _names(section.risers) == [("A", 4.0)]
    assert _names(section.fallers) == [("B", -4.0)]
    assert resp.history[0].change_dates == ["2026-09-21", "2026-09-23"]


@pytest.mark.asyncio
async def test_rankings_view_only_offers_sites_that_publish_rankings(store):
    resp = await adp_movers.get_movers(metric="rank", sites="fantrax,sleeper", mode="last_update")
    assert [s.key for s in resp.sections] == ["sleeper"]


@pytest.mark.asyncio
async def test_from_after_to_is_rejected(store):
    with pytest.raises(ValueError):
        await adp_movers.get_movers(metric="adp", from_date=D25, to_date=D21)


@pytest.mark.asyncio
async def test_trend_returns_blend_delta_per_player(store):
    store[("espn", D21)] = [_row("Paul Reed", 40.0), _row("Tre Jones", 50.0)]
    store[("espn", D25)] = [_row("Paul Reed", 30.0), _row("Tre Jones", 50.0)]
    store[("fantrax", D21)] = [_row("Paul Reed", 42.0)]
    store[("fantrax", D25)] = [_row("Paul Reed", 38.0)]

    resp = await adp_movers.get_trend(metric="adp", sites="espn,fantrax", days=7)
    assert resp.deltas == {"name:paul reed": 7.0}
    assert (resp.from_date, resp.to_date) == ("2026-09-21", "2026-09-25")


@pytest.mark.asyncio
async def test_espn_slide_onto_undrafted_floor_is_an_exit_not_a_fall(store):
    store[("espn", D21)] = [_row("Jordan Poole", 120.0), _row("Bj Johnson", 131.7), _row("Tre Jones", 139.2)]
    store[("espn", D25)] = [_row("Jordan Poole", 137.9), _row("Bj Johnson", 138.0), _row("Tre Jones", 125.0)]

    section = (await adp_movers.get_movers(metric="adp", sites="espn", from_date=D21)).sections[0]
    assert _names(section.fallers) == [("Jordan Poole", -17.9)]
    assert [m.name for m in section.exited] == ["Bj Johnson"]
    assert [m.name for m in section.entered] == ["Tre Jones"]
    assert section.risers == []
