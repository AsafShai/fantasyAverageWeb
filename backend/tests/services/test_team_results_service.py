import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from app.services import team_results_service
from app.services.team_results_service import UnknownTeam, get_team_results, parse_team_results

FIXTURE = Path(__file__).resolve().parents[1] / "fixtures" / "espn_team_schedule_cle_2027_trimmed.json"
CLE = 5


@pytest.fixture
def payload():
    return json.loads(FIXTURE.read_text())


@pytest.fixture(autouse=True)
def clear_cache():
    team_results_service.clear_cache()
    yield
    team_results_service.clear_cache()


def test_keeps_finished_games_in_date_order_with_eastern_dates(payload):
    results = parse_team_results(payload, CLE)
    # Cleveland had played 18 games when the fixture was captured (Nov 24, 2026).
    assert len(results) == 18
    assert [r["date"] for r in results] == sorted(r["date"] for r in results)
    first = results[0]
    assert first == {
        "game_id": "401909093", "date": "2026-10-22", "is_home": False, "opponent_id": 20,
        "opponent_abbreviation": "PHL", "team_score": 106, "opponent_score": 114, "won": False,
    }
    # A 7pm ET tip is past midnight UTC: the Grizzlies game is Nov 18 in the US, not Nov 19.
    memphis = next(r for r in results if r["game_id"] == "401910007")
    assert memphis["date"] == "2026-11-18"
    assert (memphis["team_score"], memphis["opponent_score"], memphis["is_home"], memphis["won"]) == (121, 124, True, False)
    assert sum(r["won"] for r in results) == 9


def test_skips_games_not_played_or_without_a_score(payload):
    event = payload["events"][0]
    upcoming = json.loads(json.dumps(event))
    upcoming["competitions"][0]["status"]["type"] = {"state": "pre", "completed": False}
    no_score = json.loads(json.dumps(event))
    no_score["competitions"][0]["competitors"][0]["score"] = None
    assert parse_team_results({"events": [upcoming, no_score]}, CLE) == []


def test_reads_plain_string_scores(payload):
    event = json.loads(json.dumps(payload["events"][0]))
    for competitor in event["competitions"][0]["competitors"]:
        competitor["score"] = competitor["score"]["displayValue"]
    assert parse_team_results({"events": [event]}, CLE)[0]["team_score"] == 106


@pytest.mark.asyncio
async def test_caches_each_team(payload):
    with patch("app.services.team_results_service.espn_client.async_get_json", new_callable=AsyncMock) as fetch:
        fetch.return_value = payload
        first = await get_team_results(CLE)
        second = await get_team_results(CLE)
    assert first is second
    fetch.assert_awaited_once()
    assert fetch.await_args.args[1] == "teams/5/schedule"


@pytest.mark.asyncio
async def test_rejects_an_unknown_team():
    with pytest.raises(UnknownTeam):
        await get_team_results(99)
