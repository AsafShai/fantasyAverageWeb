from unittest.mock import AsyncMock, patch

import pytest

from app.services import adp_cache
from app.services.adp_fetch import (
    AdpRow,
    assemble_adp_payload,
    coerce_adp,
    fetch_live_adp_payload,
    parse_espn_payload,
    parse_espn_projections,
    parse_fantrax_payload,
    parse_sleeper_payload,
    parse_yahoo_payload,
    projection_from_stat_block,
)


@pytest.fixture(autouse=True)
def no_real_adp_provider_db():
    """fetch_live_adp_payload now persists through adp_cache, which talks to Neon by
    default. Keep these tests off the real database -- adp_cache's own DB behavior is
    covered separately in test_adp_cache.py."""
    with patch("app.services.adp_cache.DBService") as mock_db:
        mock_db.return_value._get_pool = AsyncMock(return_value=None)
        yield


def test_coerce_adp_rejects_blank_and_non_positive():
    assert coerce_adp(None) is None
    assert coerce_adp("-") is None
    assert coerce_adp(0) is None
    assert coerce_adp("1.55") == 1.55
    assert coerce_adp("1,234.5") == 1234.5


def test_parse_espn_payload_splits_adp_from_roto_ranking():
    data = {
        "players": [
            {
                "id": 3112335,
                "player": {
                    "id": 3112335,
                    "fullName": "Nikola Jokic",
                    "eligibleSlots": [4],
                    "ownership": {"averageDraftPosition": 1.8},
                    "draftRanksByRankType": {
                        "STANDARD": {"rank": 1, "averageRank": None},
                        "ROTO": {"rank": 2, "averageRank": None},
                    },
                },
            },
            {
                "player": {
                    "id": 99,
                    "fullName": "Unlisted Guy",
                    "draftRanksByRankType": {},
                }
            },
        ]
    }
    assert parse_espn_payload(data) == [AdpRow(3112335, "Nikola Jokic", 1.8, ["C"], 2)]


def test_parse_espn_payload_reports_espn_adp_without_a_depth_cutoff():
    """ESPN's number is shown as published, however deep it runs.

    Most values just under 140 are ESPN's undrafted default rather than a real average
    pick, but they run continuously up from ~125 with no clean break to cut on, so nothing
    is discarded here -- sorting breaks the resulting ties on the rankings blend instead.
    """
    data = {
        "players": [
            {
                "player": {
                    "id": 1,
                    "fullName": "Undrafted Everywhere",
                    "ownership": {"averageDraftPosition": 140.0},
                    "draftRanksByRankType": {"ROTO": {"rank": 500}},
                }
            },
            {
                "player": {
                    "id": 2,
                    "fullName": "Barely Drafted",
                    "ownership": {"averageDraftPosition": 139.4},
                    "draftRanksByRankType": {"ROTO": {"rank": 300}},
                }
            },
            {
                "player": {
                    "id": 3,
                    "fullName": "Really Drafted",
                    "ownership": {"averageDraftPosition": 130.2},
                    "draftRanksByRankType": {"ROTO": {"rank": 150}},
                }
            },
        ]
    }
    rows = {row.espn_id: row for row in parse_espn_payload(data)}
    assert rows[1].adp == 140.0 and rows[1].ranking == 500
    assert rows[2].adp == 139.4
    assert rows[3].adp == 130.2


def test_parse_espn_payload_keeps_a_ranked_player_with_no_adp():
    data = {
        "players": [
            {
                "player": {
                    "id": 4433134,
                    "fullName": "Deep Bench Guy",
                    "draftRanksByRankType": {"ROTO": {"rank": 260}},
                }
            }
        ]
    }
    assert parse_espn_payload(data) == [AdpRow(4433134, "Deep Bench Guy", None, [], 260)]


def test_parse_espn_payload_ignores_standard_only_ranks():
    data = {
        "players": [
            {
                "player": {
                    "id": 3112335,
                    "fullName": "Nikola Jokic",
                    "eligibleSlots": [4],
                    "draftRanksByRankType": {"STANDARD": {"rank": 1, "averageRank": 1.4}},
                },
            },
        ]
    }
    assert parse_espn_payload(data) == []


def test_projection_from_stat_block_prefers_average_stats():
    block = {
        "id": "102026",
        "stats": {"0": 2144.0, "1": 60.0, "2": 110.0, "3": 747.0, "6": 940.0, "17": 134.0, "19": 0.579, "20": 0.82, "42": 74.0},
        "averageStats": {"0": 28.97, "1": 0.81, "2": 1.49, "3": 10.09, "6": 12.70, "17": 1.81, "19": 0.579, "20": 0.82, "42": 74.0},
    }
    row = projection_from_stat_block(block)
    assert row is not None
    assert row["gp"] == 74
    assert row["ppg"] == 29.0
    assert row["apg"] == 10.1
    assert row["rpg"] == 12.7
    assert row["three_pm"] == 1.8
    assert row["fg_pct"] == 0.579
    assert row["ft_pct"] == 0.82


def test_projection_from_stat_block_divides_totals_when_no_averages():
    block = {"stats": {"0": 200.0, "3": 50.0, "6": 80.0, "1": 10.0, "2": 20.0, "17": 30.0, "19": 50.0, "20": 80.0, "42": 10.0}}
    row = projection_from_stat_block(block)
    assert row == {
        "gp": 10,
        "fg_pct": 0.5,
        "ft_pct": 0.8,
        "ppg": 20.0,
        "rpg": 8.0,
        "apg": 5.0,
        "spg": 2.0,
        "bpg": 1.0,
        "three_pm": 3.0,
    }


def test_parse_espn_projections_picks_season_projection_split():
    data = {
        "players": [
            {
                "player": {
                    "id": 3112335,
                    "fullName": "Nikola Jokic",
                    "stats": [
                        {"id": "002026", "statSourceId": 0, "seasonId": 2026, "scoringPeriodId": 0, "stats": {"42": 65}},
                        {
                            "id": "102026",
                            "statSourceId": 1,
                            "seasonId": 2026,
                            "scoringPeriodId": 0,
                            "stats": {"0": 2144.0, "42": 74.0, "19": 0.579, "20": 0.82, "3": 747.0, "6": 940.0, "1": 60.0, "2": 110.0, "17": 134.0},
                            "averageStats": {"0": 28.97, "3": 10.09, "6": 12.7, "1": 0.81, "2": 1.49, "17": 1.81, "19": 0.579, "20": 0.82, "42": 74.0},
                        },
                    ],
                }
            }
        ]
    }
    parsed = parse_espn_projections(data, 2026)
    assert 3112335 in parsed
    assert parsed[3112335]["ppg"] == 29.0
    assert parse_espn_projections(data, 2027) == {}


def test_parse_sleeper_payload_skips_unranked():
    data = {
        "a": {
            "sport": "nba",
            "full_name": "Shai Gilgeous-Alexander",
            "espn_id": "4278073",
            "search_rank": 2,
            "fantasy_positions": ["PG", "SG"],
        },
        "b": {
            "sport": "nba",
            "full_name": "Bench Warmer",
            "search_rank": 999,
        },
    }
    rows = parse_sleeper_payload(data)
    assert rows == [AdpRow(4278073, "Shai Gilgeous-Alexander", None, ["PG", "SG"], 2)]


def test_parse_fantrax_payload_reads_adp_list():
    data = {"adp": [{"name": "Victor Wembanyama", "adp": 2.1}, {"playerName": "No ADP"}]}
    rows = parse_fantrax_payload(data)
    assert rows == [AdpRow(None, "Victor Wembanyama", 2.1, [], None)]


def test_parse_yahoo_payload_reads_average_pick_and_overall_rank():
    entries = [
        {
            "player": {
                "name": {"full": "Victor Wembanyama"},
                "eligible_positions": [{"position": "C"}],
                "draft_analysis": {"average_pick": "2.6"},
                "player_ranks": [
                    {"player_rank": {"rank_type": "OR", "rank_value": "1"}},
                    {"player_rank": {"rank_type": "S", "rank_value": "9", "rank_season": "2026"}},
                ],
            }
        },
        {
            "player": {
                "name": {"full": "Rarely Drafted"},
                "draft_analysis": {"average_pick": "-"},
                "player_ranks": [{"player_rank": {"rank_type": "OR", "rank_value": "402"}}],
            }
        },
        {"player": {"name": {"full": "No Data"}, "draft_analysis": {"average_pick": "-"}}},
    ]
    rows = parse_yahoo_payload(entries)
    assert rows == [
        AdpRow(None, "Victor Wembanyama", 2.6, ["C"], 1),
        AdpRow(None, "Rarely Drafted", None, [], 402),
    ]


def test_assemble_adp_payload_keeps_per_site_rows():
    payload = assemble_adp_payload(
        {
            "espn": ([AdpRow(3112335, "Nikola Jokic", 1.0, ["C"], 3)], "espn-src"),
            "sleeper": ([AdpRow(3112335, "Nikola Jokic", None, ["C"], 2)], "sleeper-src"),
        },
        season_label="2025-26",
        updated_at="2026-08-21T00:00:00Z",
    )
    assert payload["sources"] == {"espn": "espn-src", "sleeper": "sleeper-src"}
    assert payload["players"] == [
        {
            "espn_id": 3112335,
            "name": "Nikola Jokic",
            "positions": ["C"],
            "adp": {"espn": 1.0},
            "ranking": {"espn": 3},
        },
        {
            "espn_id": 3112335,
            "name": "Nikola Jokic",
            "positions": ["C"],
            "adp": {},
            "ranking": {"sleeper": 2},
        },
    ]


def test_assemble_adp_payload_accepts_rows_rehydrated_from_json():
    payload = assemble_adp_payload(
        {"espn": ([[3112335, "Nikola Jokic", 1.0, ["C"], 3]], "espn-src")},
        season_label="2025-26",
    )
    assert payload["players"][0]["ranking"] == {"espn": 3}


@pytest.mark.asyncio
async def test_fetch_live_adp_payload_omits_failed_site():
    adp_cache.reset_provider_cache()

    async def espn(_client):
        return [AdpRow(1, "A", 1.0, ["C"], 2)], "espn"

    async def fantrax(_client):
        raise RuntimeError("down")

    async def sleeper(_client):
        return [AdpRow(1, "A", None, ["C"], 3)], "sleeper"

    async def yahoo(_client):
        return [AdpRow(None, "A", 4.0, ["C"], 4)], "yahoo"

    with (
        patch("app.services.adp_fetch.fetch_espn", espn),
        patch("app.services.adp_fetch.fetch_fantrax", fantrax),
        patch("app.services.adp_fetch.fetch_sleeper", sleeper),
        patch("app.services.adp_fetch.fetch_yahoo", yahoo),
        patch("app.services.adp_fetch.settings") as settings,
    ):
        settings.season_id = 2026
        payload = await fetch_live_adp_payload()
    assert "espn" in payload["sources"]
    assert "sleeper" in payload["sources"]
    assert "yahoo" in payload["sources"]
    assert "fantrax" not in payload["sources"]
    assert len(payload["players"]) == 3
    assert [m["key"] for m in payload["providers"]] == ["espn", "sleeper", "yahoo"]
    espn_meta = next(m for m in payload["providers"] if m["key"] == "espn")
    assert espn_meta["has_adp"] is True and espn_meta["has_rankings"] is True
    sleeper_meta = next(m for m in payload["providers"] if m["key"] == "sleeper")
    assert sleeper_meta["has_adp"] is False and sleeper_meta["has_rankings"] is True


@pytest.mark.asyncio
async def test_fetch_live_adp_payload_raises_when_all_fail():
    adp_cache.reset_provider_cache()

    async def boom(_client):
        raise RuntimeError("down")

    with (
        patch("app.services.adp_fetch.fetch_espn", boom),
        patch("app.services.adp_fetch.fetch_fantrax", boom),
        patch("app.services.adp_fetch.fetch_sleeper", boom),
        patch("app.services.adp_fetch.fetch_yahoo", boom),
    ):
        with pytest.raises(RuntimeError, match="All ADP sources failed"):
            await fetch_live_adp_payload()
