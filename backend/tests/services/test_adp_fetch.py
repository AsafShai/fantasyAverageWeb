from unittest.mock import AsyncMock, patch

import pytest

from app.services.adp_fetch import (
    assemble_adp_payload,
    coerce_adp,
    fetch_live_adp_payload,
    parse_espn_payload,
    parse_espn_projections,
    parse_fantrax_payload,
    parse_sleeper_payload,
    projection_from_stat_block,
)


def test_coerce_adp_rejects_blank_and_non_positive():
    assert coerce_adp(None) is None
    assert coerce_adp("-") is None
    assert coerce_adp(0) is None
    assert coerce_adp("1.55") == 1.55
    assert coerce_adp("1,234.5") == 1234.5


def test_parse_espn_payload_uses_standard_rank():
    data = {
        "players": [
            {
                "id": 3112335,
                "player": {
                    "id": 3112335,
                    "fullName": "Nikola Jokic",
                    "eligibleSlots": [4],
                    "draftRanksByRankType": {"STANDARD": {"rank": 1, "averageRank": 1.4}},
                },
            },
            {
                "player": {
                    "id": 99,
                    "fullName": "Unranked Guy",
                    "draftRanksByRankType": {},
                }
            },
        ]
    }
    rows = parse_espn_payload(data)
    assert rows == [(3112335, "Nikola Jokic", 1.4, ["C"])]


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
    assert rows == [(4278073, "Shai Gilgeous-Alexander", 2.0, ["PG", "SG"])]


def test_parse_fantrax_payload_reads_adp_list():
    data = {"adp": [{"name": "Victor Wembanyama", "adp": 2.1}, {"playerName": "No ADP"}]}
    rows = parse_fantrax_payload(data)
    assert rows == [(None, "Victor Wembanyama", 2.1, [])]


def test_assemble_adp_payload_keeps_per_site_rows():
    payload = assemble_adp_payload(
        {
            "espn": ([(3112335, "Nikola Jokic", 1.0, ["C"])], "espn-src"),
            "sleeper": ([(3112335, "Nikola Jokic", 2.0, ["C"])], "sleeper-src"),
        },
        season_label="2025-26",
        updated_at="2026-08-21T00:00:00Z",
    )
    assert payload["sources"] == {"espn": "espn-src", "sleeper": "sleeper-src"}
    assert payload["players"] == [
        {"espn_id": 3112335, "name": "Nikola Jokic", "positions": ["C"], "adp": {"espn": 1.0}},
        {"espn_id": 3112335, "name": "Nikola Jokic", "positions": ["C"], "adp": {"sleeper": 2.0}},
    ]


@pytest.mark.asyncio
async def test_fetch_live_adp_payload_omits_failed_site():
    async def espn(_client):
        return [(1, "A", 1.0, ["C"])], "espn"

    async def fantrax(_client):
        raise RuntimeError("down")

    async def sleeper(_client):
        return [(1, "A", 3.0, ["C"])], "sleeper"

    with (
        patch("app.services.adp_fetch.fetch_espn", espn),
        patch("app.services.adp_fetch.fetch_fantrax", fantrax),
        patch("app.services.adp_fetch.fetch_sleeper", sleeper),
        patch("app.services.adp_fetch.settings") as settings,
    ):
        settings.season_id = 2026
        payload = await fetch_live_adp_payload()
    assert "espn" in payload["sources"]
    assert "sleeper" in payload["sources"]
    assert "fantrax" not in payload["sources"]
    assert len(payload["players"]) == 2


@pytest.mark.asyncio
async def test_fetch_live_adp_payload_raises_when_all_fail():
    async def boom(_client):
        raise RuntimeError("down")

    with (
        patch("app.services.adp_fetch.fetch_espn", boom),
        patch("app.services.adp_fetch.fetch_fantrax", boom),
        patch("app.services.adp_fetch.fetch_sleeper", boom),
    ):
        with pytest.raises(RuntimeError, match="All ADP sources failed"):
            await fetch_live_adp_payload()
