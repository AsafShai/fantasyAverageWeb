import json
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock
from zoneinfo import ZoneInfo

import pytest

from app.services import nba_player_catalog
from app.services.nba_players_refresh import (
    MIN_PLAYERS,
    _dedupe_and_preserve,
    normalize_position,
    refresh_nba_players_json,
)
from app.services.nba_players_scheduler import compute_next_trigger


@pytest.fixture(autouse=True)
def _reset_catalog():
    nba_player_catalog.reset_catalog_cache()
    yield
    nba_player_catalog.reset_catalog_cache()


def _player(pid: str, name: str, height=None):
    return {
        "id": pid,
        "displayName": name,
        "team": "San Antonio Spurs",
        "teamAbbr": "SAS",
        "conference": "West",
        "division": "Southwest",
        "position": "Center",
        "photoUrl": None,
        "height": height,
        "nationality": None,
        "age": 21,
        "jerseyNumber": "1",
    }


def test_normalize_position_buckets_specific_roles():
    assert normalize_position("Power Forward") == "Forward"
    assert normalize_position("Small Forward") == "Forward"
    assert normalize_position("Point Guard") == "Guard"
    assert normalize_position("Shooting Guard") == "Guard"
    assert normalize_position("PF") == "Forward"
    assert normalize_position("SG") == "Guard"
    assert normalize_position("Center") == "Center"
    assert normalize_position("Guard") == "Guard"
    assert normalize_position("Wing") == "Wing"


def test_dedupe_and_preserve_keeps_prior_non_null_fields(tmp_path):
    out = tmp_path / "nba-players-2025-26.json"
    out.write_text(
        json.dumps({"players": [_player("espn-1", "Victor Wembanyama", height="7'4\"")]}),
        encoding="utf-8",
    )
    unique = _dedupe_and_preserve(
        [_player("espn-1", "Victor Wembanyama", height=None), _player("espn-1", "Victor Wembanyama")],
        out,
    )
    assert len(unique) == 1
    assert unique[0]["height"] == "7'4\""


def test_dedupe_and_preserve_takes_new_value_when_espn_fills_a_null(tmp_path):
    out = tmp_path / "nba-players-2025-26.json"
    old = _player("espn-1", "Victor Wembanyama")
    old["jerseyNumber"] = None
    old["photoUrl"] = None
    out.write_text(json.dumps({"players": [old]}), encoding="utf-8")
    incoming = _player("espn-1", "Victor Wembanyama")
    incoming["jerseyNumber"] = "1"
    incoming["photoUrl"] = "https://example.com/wemby.png"
    unique = _dedupe_and_preserve([incoming], out)
    assert unique[0]["jerseyNumber"] == "1"
    assert unique[0]["photoUrl"] == "https://example.com/wemby.png"


def test_compute_next_trigger_is_today_before_eight_and_tomorrow_after():
    tz = ZoneInfo("Asia/Jerusalem")
    before = datetime(2026, 8, 31, 7, 59, tzinfo=tz)
    after = datetime(2026, 8, 31, 8, 0, tzinfo=tz)
    next_before = compute_next_trigger(before)
    next_after = compute_next_trigger(after)
    assert next_before.date().isoformat() == "2026-08-31"
    assert next_before.hour == 8 and next_before.minute == 0
    assert next_after.date().isoformat() == "2026-09-01"
    assert next_after.hour == 8 and next_after.minute == 0


@pytest.mark.asyncio
async def test_refresh_writes_json_and_reloads_catalog(tmp_path, monkeypatch):
    out = tmp_path / "nba-players-2025-26.json"
    monkeypatch.setattr(nba_player_catalog, "JSON_PATH", out)
    monkeypatch.setattr(nba_player_catalog, "_JSON_PATH", out)
    nba_player_catalog.reset_catalog_cache()

    teams = {
        "sports": [
            {
                "leagues": [
                    {
                        "teams": [
                            {"team": {"id": "24", "abbreviation": "SA", "location": "San Antonio", "name": "Spurs"}}
                        ]
                    }
                ]
            }
        ]
    }
    roster = {
        "athletes": [
            {
                "id": "3945274",
                "fullName": "Victor Wembanyama",
                "position": {"abbreviation": "C"},
                "headshot": {"href": "https://example.com/wemby.png"},
                "displayHeight": "7'4\"",
                "age": 21,
                "jersey": "1",
            }
        ]
    }

    class FakeResp:
        def __init__(self, payload):
            self._payload = payload

        def raise_for_status(self):
            return self

        def json(self):
            return self._payload

    async def fake_get(url, **_kwargs):
        if "teams?limit" in url:
            return FakeResp(teams)
        return FakeResp(roster)

    fake_client = MagicMock()
    fake_client.get = AsyncMock(side_effect=fake_get)
    fake_client.__aenter__ = AsyncMock(return_value=fake_client)
    fake_client.__aexit__ = AsyncMock(return_value=False)

    monkeypatch.setattr("app.services.nba_players_refresh.MIN_PLAYERS", 1)
    monkeypatch.setattr("app.services.nba_players_refresh.httpx.AsyncClient", lambda **_k: fake_client)

    count = await refresh_nba_players_json(out)
    assert count == 1
    payload = json.loads(out.read_text(encoding="utf-8"))
    assert payload["players"][0]["displayName"] == "Victor Wembanyama"
    assert payload["players"][0]["teamAbbr"] == "SAS"
    bio = nba_player_catalog.get_player_bio("3945274")
    assert bio is not None
    assert bio.display_name == "Victor Wembanyama"


@pytest.mark.asyncio
async def test_refresh_refuses_to_overwrite_when_too_few(tmp_path, monkeypatch):
    out = tmp_path / "nba-players-2025-26.json"
    out.write_text(json.dumps({"players": [_player("espn-1", "Keep Me")]}), encoding="utf-8")

    class FakeResp:
        def raise_for_status(self):
            return self

        def json(self):
            return {"sports": [{"leagues": [{"teams": []}]}]}

    fake_client = MagicMock()
    fake_client.get = AsyncMock(return_value=FakeResp())
    fake_client.__aenter__ = AsyncMock(return_value=fake_client)
    fake_client.__aexit__ = AsyncMock(return_value=False)
    monkeypatch.setattr("app.services.nba_players_refresh.httpx.AsyncClient", lambda **_k: fake_client)

    with pytest.raises(RuntimeError, match="need at least"):
        await refresh_nba_players_json(out)
    assert json.loads(out.read_text(encoding="utf-8"))["players"][0]["displayName"] == "Keep Me"
    assert MIN_PLAYERS == 100
