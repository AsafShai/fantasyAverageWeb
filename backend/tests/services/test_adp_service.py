from datetime import date
from unittest.mock import AsyncMock, patch

import pytest

from app.models.adp import AdpPlayer, LastYearStats, SiteAdp
from app.models.nba_player_models import NbaPlayerBio
from app.services.adp_service import (
    apply_last_year_stats,
    apply_projection_stats,
    apply_visible_sites,
    assign_ranks,
    build_adp_response,
    compute_blend,
    compute_spread,
    last_year_from_agg_row,
    load_espn_projections,
    normalize_player_name,
    parse_sites,
    reset_adp_cache,
    resolve_adp_seasons,
)


def _bio(espn_id: int, name: str, abbr: str = "DEN", position: str = "Center") -> NbaPlayerBio:
    return NbaPlayerBio(
        id=f"espn-{espn_id}",
        display_name=name,
        team="Denver Nuggets" if abbr == "DEN" else f"{abbr} Team",
        team_abbr=abbr,
        conference="West",
        division="Northwest",
        position=position,
        photo_url=f"https://example.com/{espn_id}.png",
    )


def test_normalize_player_name_strips_accents_and_suffixes():
    assert normalize_player_name("Nikola Jokić") == "nikola jokic"
    assert normalize_player_name("Jabari Smith Jr.") == "jabari smith"
    assert normalize_player_name("P.J. Washington") == "pj washington"
    assert normalize_player_name("Karl-Anthony Towns") == "karl anthony towns"


def test_compute_blend_means_all_sites_and_skips_nulls():
    assert compute_blend({"espn": 1.0, "fantrax": 3.0, "sleeper": 5.0}) == 3.0
    assert compute_blend({"espn": 10.0, "fantrax": 20.0, "sleeper": None}) == 15.0
    assert compute_blend({"espn": None, "fantrax": None, "sleeper": None}) is None


def test_compute_blend_and_spread_honor_site_subset():
    adp = {"espn": 1.0, "fantrax": 10.0, "sleeper": 20.0}
    assert compute_blend(adp, ("fantrax", "sleeper")) == 15.0
    assert compute_spread(adp, ("fantrax", "sleeper")) == 10.0
    assert compute_blend(adp, ("espn",)) == 1.0
    assert compute_spread(adp, ("espn",)) is None


def test_parse_sites_keeps_known_keys():
    assert parse_sites(None) is None
    assert parse_sites("") is None
    assert parse_sites("yahoo,unknown") is None
    assert parse_sites("espn,sleeper,espn") == ("espn", "sleeper")


def test_apply_visible_sites_recomputes_blend_and_ranks():
    a = AdpPlayer(
        id="a",
        name="A",
        espn=SiteAdp(adp=1.0),
        fantrax=SiteAdp(adp=30.0),
        sleeper=SiteAdp(adp=2.0),
        blend=11.0,
        blend_rank=1,
        spread=29.0,
    )
    b = AdpPlayer(
        id="b",
        name="B",
        espn=SiteAdp(adp=20.0),
        fantrax=SiteAdp(adp=3.0),
        sleeper=SiteAdp(adp=4.0),
        blend=9.0,
        blend_rank=2,
        spread=17.0,
    )
    out = apply_visible_sites([a, b], ("fantrax", "sleeper"))
    assert [p.id for p in out] == ["a", "b"]
    assert out[0].blend == 16.0
    assert out[1].blend == 3.5
    assert out[1].blend_rank == 1
    assert out[0].blend_rank == 2
    assert out[0].spread == 28.0
    assert a.blend == 11.0
    assert apply_visible_sites([a], ("espn", "fantrax", "sleeper")) is not None
    same = apply_visible_sites([a, b], ("espn", "fantrax", "sleeper"))
    assert same is not out
    assert same[0] is a


def test_compute_spread_requires_two_sites():
    assert compute_spread({"espn": 10.0, "fantrax": 4.0, "sleeper": None}) == 6.0
    assert compute_spread({"espn": 5.0, "fantrax": None, "sleeper": None}) is None


def test_assign_ranks_skips_none_and_sorts_ascending():
    assert assign_ranks([3.2, 1.1, None, 1.1]) == [3, 1, None, 2]
    assert assign_ranks([None, None]) == [None, None]


def test_build_adp_response_joins_bios_and_appends_catalog_only():
    payload = {
        "seasonLabel": "2025-26",
        "updatedAt": "2026-08-21T00:00:00Z",
        "sources": {"espn": "test"},
        "players": [
            {
                "espn_id": 3112335,
                "name": "Nikola Jokic",
                "positions": ["C"],
                "adp": {"espn": 1.7, "yahoo": 1.6, "fantrax": 1.6, "sleeper": 1},
            },
            {
                "name": "Shai Gilgeous-Alexander",
                "adp": {"espn": 3.1, "yahoo": 3.8, "fantrax": None, "sleeper": 2},
            },
        ],
    }
    bios = {
        3112335: _bio(3112335, "Nikola Jokic", "DEN", "Center"),
        4278073: _bio(4278073, "Shai Gilgeous-Alexander", "OKC", "Point Guard"),
        99: _bio(99, "Sleeper Candidate", "BOS", "Guard"),
    }
    resp = build_adp_response(payload, bios_by_id=bios)
    by_id = {p.espn_id: p for p in resp.players}

    jokic = by_id[3112335]
    assert jokic.photo_url.endswith("3112335.png")
    assert jokic.team_abbr == "DEN"
    assert jokic.positions == ["C"]
    assert jokic.blend == 1.43  # (1.7+1.6+1)/3 — Yahoo is not a source
    assert jokic.blend_rank == 1
    assert jokic.espn.rank == 1
    assert jokic.spread == 0.7

    shai = by_id[4278073]
    assert shai.positions == ["PG"]  # from catalog, name-matched
    assert shai.blend == 2.55  # (3.1+2)/2
    assert shai.blend_rank == 2
    assert shai.fantrax.adp is None
    assert shai.fantrax.rank is None

    sleeper = by_id[99]
    assert sleeper.blend is None
    assert sleeper.blend_rank is None
    assert sleeper.positions == ["PG", "SG"]
    assert resp.players[-1].espn_id == 99


def test_unmatched_player_keeps_synthetic_id():
    payload = {
        "seasonLabel": "2025-26",
        "updatedAt": "",
        "players": [{"name": "Mystery Guy", "adp": {"espn": 50.0}}],
    }
    resp = build_adp_response(payload, bios_by_id={})
    assert len(resp.players) == 1
    assert resp.players[0].espn_id is None
    assert resp.players[0].id == "name:mystery guy"
    assert resp.players[0].blend == 50.0
    assert resp.players[0].blend_rank == 1


def test_normalize_strips_eligibility_and_injury_suffixes():
    assert normalize_player_name("Anthony Edwards SF") == "anthony edwards"
    assert normalize_player_name("Trae Young OUT") == "trae young"
    assert normalize_player_name("SF,SG) Amen Thompson PG") == "amen thompson"
    assert normalize_player_name("Joel Embiid DTD") == "joel embiid"
    assert normalize_player_name("PF") == ""
    assert normalize_player_name("Chase-DUP Audiege-DUP") == ""
    assert normalize_player_name("FA Jared Butler") == "jared butler"
    assert normalize_player_name("RET Russell Westbrook III") == "russell westbrook"


def test_build_adp_response_merges_scraped_name_duplicates():
    payload = {
        "seasonLabel": "2025-26",
        "updatedAt": "",
        "players": [
            {"name": "Anthony Edwards SF", "adp": {"yahoo": 6}},
            {
                "espn_id": 4594268,
                "name": "Anthony Edwards",
                "adp": {"espn": 10, "fantrax": 9.01, "sleeper": 6},
            },
            {"name": "Trae Young OUT", "adp": {"yahoo": 11}},
            {
                "espn_id": 4277905,
                "name": "Trae Young",
                "adp": {"espn": 52, "sleeper": 21},
            },
            {"name": "SF,SG) Amen Thompson PG", "adp": {"yahoo": 21}},
            {
                "espn_id": 4684740,
                "name": "Amen Thompson",
                "adp": {"espn": 13, "fantrax": 23.43},
            },
            {"name": "Nicolas Claxton", "adp": {"fantrax": 98.77}},
            {
                "espn_id": 4278067,
                "name": "Nic Claxton",
                "adp": {"espn": 129, "sleeper": 103},
            },
            {"name": "Ron Holland", "adp": {"fantrax": 236.98}},
            {
                "espn_id": 4683771,
                "name": "Ronald Holland II",
                "adp": {"espn": 255, "sleeper": 228},
            },
            {"name": "PF", "adp": {"yahoo": 158}},
        ],
    }
    bios = {
        4594268: _bio(4594268, "Anthony Edwards", "MIN", "Shooting Guard"),
        4277905: _bio(4277905, "Trae Young", "WAS", "Point Guard"),
        4684740: _bio(4684740, "Amen Thompson", "HOU", "Small Forward"),
        4278067: _bio(4278067, "Nic Claxton", "CHI", "Center"),
        4683771: _bio(4683771, "Ronald Holland II", "DET", "Small Forward"),
    }
    resp = build_adp_response(payload, bios_by_id=bios)
    names = [p.name for p in resp.players]
    assert "Anthony Edwards SF" not in names
    assert "Trae Young OUT" not in names
    assert "PF" not in names
    assert names.count("Anthony Edwards") == 1
    assert names.count("Trae Young") == 1
    assert names.count("Amen Thompson") == 1
    assert names.count("Nic Claxton") == 1

    by_id = {p.espn_id: p for p in resp.players}
    edwards = by_id[4594268]
    assert edwards.espn.adp == 10
    assert edwards.sleeper.adp == 6
    assert edwards.fantrax.adp == 9.01

    young = by_id[4277905]
    assert young.espn.adp == 52

    thompson = by_id[4684740]
    assert thompson.espn.adp == 13

    claxton = by_id[4278067]
    assert claxton.fantrax.adp == 98.77
    assert claxton.espn.adp == 129

    holland = by_id[4683771]
    assert holland.fantrax.adp == 236.98
    assert holland.espn.adp == 255


def test_last_year_from_agg_row_averages_and_skips_zero_gp():
    assert last_year_from_agg_row({"gp": 0, "pts": 10}) is None
    stats = last_year_from_agg_row(
        {
            "gp": 2,
            "pts": 50,
            "reb": 20,
            "ast": 10,
            "stl": 3,
            "blk": 1,
            "three_pm": 4,
            "fg_pct": 0.5,
            "ft_pct": 0.8,
        }
    )
    assert stats is not None
    assert stats.gp == 2
    assert stats.ppg == 25.0
    assert stats.rpg == 10.0
    assert stats.apg == 5.0
    assert stats.spg == 1.5
    assert stats.bpg == 0.5
    assert stats.three_pm == 2.0
    assert stats.fg_pct == 0.5
    assert stats.ft_pct == 0.8


def test_apply_last_year_stats_joins_by_espn_id():
    payload = {
        "seasonLabel": "2025-26",
        "updatedAt": "",
        "players": [
            {"espn_id": 1, "name": "Played", "adp": {"espn": 1}},
            {"name": "Rookie", "adp": {"espn": 2}},
        ],
    }
    resp = build_adp_response(payload, bios_by_id={})
    stats = {
        1: LastYearStats(gp=70, fg_pct=0.47, ft_pct=0.85, ppg=20.1, rpg=5.2, apg=4.0, spg=1.1, bpg=0.4, three_pm=2.3),
    }
    out = apply_last_year_stats(resp, stats, "2025-26")
    by_name = {p.name: p for p in out.players}
    assert out.last_year_season == "2025-26"
    assert by_name["Played"].last_year is not None
    assert by_name["Played"].last_year.ppg == 20.1
    assert by_name["Rookie"].last_year is None


def test_apply_projection_stats_joins_by_espn_id():
    payload = {
        "seasonLabel": "2025-26",
        "updatedAt": "",
        "players": [
            {"espn_id": 1, "name": "Played", "adp": {"espn": 1}},
            {"name": "Rookie", "adp": {"espn": 2}},
        ],
    }
    resp = build_adp_response(payload, bios_by_id={})
    stats = {
        1: LastYearStats(gp=74, fg_pct=0.58, ft_pct=0.82, ppg=29.0, rpg=12.7, apg=10.1, spg=1.5, bpg=0.8, three_pm=1.8),
    }
    out = apply_projection_stats(resp, stats, "2026-27")
    by_name = {p.name: p for p in out.players}
    assert out.projection_season == "2026-27"
    assert by_name["Played"].projection is not None
    assert by_name["Played"].projection.ppg == 29.0
    assert by_name["Rookie"].projection is None


_PROJ_ROW = {
    99: {
        "gp": 82,
        "fg_pct": 0.5,
        "ft_pct": 0.8,
        "ppg": 20.0,
        "rpg": 5.0,
        "apg": 4.0,
        "spg": 1.0,
        "bpg": 1.0,
        "three_pm": 2.0,
    }
}


@pytest.mark.asyncio
async def test_projection_cache_does_not_store_empty_failure():
    reset_adp_cache()
    fetch = AsyncMock(side_effect=[{}, _PROJ_ROW])
    with patch("app.services.adp_service.fetch_espn_projection_map", fetch):
        empty = await load_espn_projections()
        filled = await load_espn_projections()
    assert empty[1] == {}
    assert 99 in filled[1]
    assert fetch.await_count == 2


@pytest.mark.asyncio
async def test_projection_cache_retries_after_exception():
    reset_adp_cache()
    fetch = AsyncMock(side_effect=[RuntimeError("down"), _PROJ_ROW])
    with patch("app.services.adp_service.fetch_espn_projection_map", fetch):
        empty = await load_espn_projections()
        filled = await load_espn_projections()
    assert empty[1] == {}
    assert 99 in filled[1]


def test_resolve_seasons_before_tipoff_uses_previous_actuals():
    with patch("app.services.adp_service.settings") as cfg:
        cfg.season_id = 2027
        cfg.season_start = date(2026, 10, 20)
        with patch("app.services.adp_service.date") as fake_date:
            fake_date.today.return_value = date(2026, 8, 24)
            assert resolve_adp_seasons() == ("2025-26", 2027)


def test_resolve_seasons_in_season_uses_current_actuals():
    with patch("app.services.adp_service.settings") as cfg:
        cfg.season_id = 2027
        cfg.season_start = date(2026, 10, 20)
        with patch("app.services.adp_service.date") as fake_date:
            fake_date.today.return_value = date(2027, 1, 15)
            assert resolve_adp_seasons() == ("2026-27", 2027)
