from datetime import date, datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

from app.config import settings
from app.exceptions import InvalidParameterError
from app.services import roster_day_service as svc


def _entry(pid, name, slot_id, pro_team, stats=None, period=16):
    player = {"id": pid, "fullName": name, "proTeamId": pro_team, "eligibleSlots": [0, 1, 5, 11, 12, 13], "stats": []}
    if stats is not None:
        player["stats"].append({
            "statSplitTypeId": 5, "statSourceId": 0, "scoringPeriodId": period, "stats": stats,
        })
    # Season totals and projections must be ignored.
    player["stats"].append({"statSplitTypeId": 0, "statSourceId": 0, "scoringPeriodId": 0, "stats": {"0": 999}})
    return {"playerId": pid, "lineupSlotId": slot_id, "playerPoolEntry": {"player": player}}


def _roster_payload(period=16):
    return {
        "seasonId": settings.season_id,
        "teams": [
            {"id": 1, "roster": {"entries": [
                _entry(10, "Starter Guy", 0, 13, {"40": 37, "13": 7, "14": 15, "15": 6, "16": 6, "17": 1,
                                                    "6": 3, "3": 4, "2": 0, "1": 0, "0": 21, "11": 2}, period),
                _entry(11, "Bench Guy", 12, 15, {}, period),
                _entry(12, "Off Day", 13, 16, None, period),
                {"playerId": 13, "lineupSlotId": 99, "playerPoolEntry": {"player": {}}},  # unknown slot
            ]}},
            {"id": 2, "roster": {"entries": [_entry(20, "Other Team", 4, 1, None, period)]}},
        ],
    }


def test_parse_roster_payload_trims_every_team():
    rows = svc.parse_roster_payload(_roster_payload(), 16, settings.season_id)
    by_id = {r[1]: r for r in rows}
    assert set(by_id) == {10, 11, 12, 20}
    team_id, pid, name, positions, pro_team_id, slot, stats = by_id[10]
    assert (team_id, name, positions, pro_team_id, slot) == (1, "Starter Guy", "PG, SG", 13, "PG")
    assert stats["pts"] == 21 and stats["fga"] == 15 and stats["minutes"] == 37
    assert by_id[11][5] == "BE" and by_id[11][6] == {}   # a line without numbers: did not play
    assert by_id[12][5] == "IR" and by_id[12][6] is None  # no line: no game


def test_parse_roster_payload_rejects_other_season():
    payload = _roster_payload()
    payload["seasonId"] = settings.season_id - 1
    with pytest.raises(svc.DataSourceError):
        svc.parse_roster_payload(payload, 16, settings.season_id)


def test_stats_array_round_trip():
    stats = {"minutes": 30.0, "pts": 12.0, "fgm": 5.0}
    values = svc.stats_to_array(stats)
    assert len(values) == len(svc.STAT_ORDER)
    back = svc.stats_from_array(values)
    assert back["pts"] == 12 and back["fgm"] == 5 and back["reb"] == 0
    assert svc.stats_to_array(None) is None and svc.stats_from_array(None) is None
    assert svc.stats_to_array({}) == [] and svc.stats_from_array([]) == {}


def test_parse_transactions_keeps_executed_moves_only():
    payload = {"transactions": [
        {"id": "a", "type": "FREEAGENT", "status": "EXECUTED", "processDate": 1_793_000_000_000,
         "items": [{"type": "ADD", "playerId": 5, "fromTeamId": 0, "toTeamId": 1},
                   {"type": "DROP", "playerId": 6, "fromTeamId": 1, "toTeamId": 0},
                   {"type": "LINEUP", "playerId": 7}]},
        {"id": "b", "type": "ROSTER", "status": "EXECUTED", "processDate": 1, "items": [{"type": "LINEUP", "playerId": 7}]},
        {"id": "c", "type": "WAIVER", "status": "FAILED_INVALIDPLAYERSOURCE", "processDate": 1,
         "items": [{"type": "ADD", "playerId": 8, "toTeamId": 1}]},
    ]}
    rows = svc.parse_transactions(payload)
    assert len(rows) == 1
    tx_id, kind, at, items = rows[0]
    assert (tx_id, kind) == ("a", "FREEAGENT")
    assert at.tzinfo is not None
    assert [i["type"] for i in items] == ["ADD", "DROP"]


def test_opponents_for_period():
    payload = {"settings": {"proTeams": [
        {"id": 13, "proGamesByScoringPeriod": {"16": [{"homeProTeamId": 23, "awayProTeamId": 13}]}},
        {"id": 23, "proGamesByScoringPeriod": {"16": [{"homeProTeamId": 23, "awayProTeamId": 13}]}},
    ]}}
    assert svc.opponents_for_period(payload, 16) == {13: "SAC", 23: "LAL"}
    assert svc.opponents_for_period(payload, 17) == {}


def _ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


def test_effective_period_moves_after_lock_to_next_day():
    lock = datetime(2026, 11, 5, 0, 0, tzinfo=timezone.utc)
    assert svc.effective_period(datetime(2026, 11, 4, 18, 42, tzinfo=timezone.utc), 16, _ms(lock)) == 16
    assert svc.effective_period(datetime(2026, 11, 5, 0, 52, tzinfo=timezone.utc), 16, _ms(lock)) == 17
    assert svc.effective_period(datetime(2026, 11, 5, 0, 52, tzinfo=timezone.utc), 16, None) == 16


def _tx(tx_id, period, at, items, kind="FREEAGENT"):
    return {"scoring_period_id": period, "tx_id": tx_id, "kind": kind, "at": at, "items": items}


def _add(pid, team=1):
    return {"type": "ADD", "player_id": pid, "from_team_id": 0, "to_team_id": team}


def _drop(pid, team=1):
    return {"type": "DROP", "player_id": pid, "from_team_id": team, "to_team_id": 0}


def test_build_moves_tags_and_strip():
    """Real Nov 2 / Nov 3 sequence: Demin added and dropped again before lock
    (never on a locked roster), Walker added before lock and dropped by a waiver
    claim the next morning -- Walker is both Added and Dropped on Nov 2."""
    utc = timezone.utc
    locks = {14: _ms(datetime(2026, 11, 3, 0, 0, tzinfo=utc)), 15: _ms(datetime(2026, 11, 4, 0, 0, tzinfo=utc))}
    txs = [
        _tx("t1", 14, datetime(2026, 11, 2, 10, 14, tzinfo=utc), [_add(5175643), _drop(5279133)]),
        _tx("t2", 14, datetime(2026, 11, 2, 18, 1, tzinfo=utc), [_add(5106060), _drop(5175643)]),
        _tx("t3", 15, datetime(2026, 11, 3, 8, 42, tzinfo=utc), [_add(5101761), _drop(5106060)], kind="WAIVER"),
        _tx("other", 14, datetime(2026, 11, 2, 12, 0, tzinfo=utc), [_add(1, team=4), _drop(2, team=4)]),
    ]
    names = {5175643: "Egor Demin", 5279133: "Joan Beringer", 5106060: "Jarace Walker", 5101761: "Mikel Brown Jr."}
    roster = {5106060, 4066457}
    moves, added, dropped = svc.build_moves(txs, 1, 14, locks, roster, names)
    assert [m.id for m in moves] == ["t1", "t2"]
    assert moves[0].added[0].name == "Egor Demin" and moves[0].added[0].on_roster is False
    assert moves[1].added[0].on_roster is True
    assert added == {5106060} and dropped == {5106060}

    moves15, added15, _ = svc.build_moves(txs, 1, 15, locks, {5101761}, names)
    assert [m.kind for m in moves15] == ["waiver"] and added15 == {5101761}


def test_build_moves_after_lock_and_trades():
    utc = timezone.utc
    locks = {16: _ms(datetime(2026, 11, 5, 0, 0, tzinfo=utc))}
    late = _tx("late", 16, datetime(2026, 11, 5, 0, 52, tzinfo=utc), [_add(5149077), _drop(4601023)])
    trade = _tx("tr", 16, datetime(2026, 11, 4, 12, 0, tzinfo=utc), [
        {"type": "TRADE", "player_id": 30, "from_team_id": 4, "to_team_id": 1},
        {"type": "TRADE", "player_id": 31, "from_team_id": 1, "to_team_id": 4},
    ], kind="TRADE_ACCEPT")
    moves16, _, dropped16 = svc.build_moves([late, trade], 1, 16, locks, {4601023, 31, 30}, {})
    assert [m.id for m in moves16] == ["tr"] and moves16[0].kind == "trade"
    assert [p.player_id for p in moves16[0].added] == [30] and [p.player_id for p in moves16[0].dropped] == [31]
    assert dropped16 == {4601023}
    moves17, added17, _ = svc.build_moves([late], 1, 17, locks, {5149077}, {})
    assert moves17[0].after_lock is True and added17 == {5149077}


def test_player_status():
    assert svc.player_status({"minutes": 12}, "LAL", False) == "played"
    assert svc.player_status({}, "LAL", False) == "dnp"
    assert svc.player_status(None, "LAL", False) == "dnp"
    assert svc.player_status(None, "LAL", True) == "scheduled"
    assert svc.player_status(None, None, False) == "no_game"


class _FakeDB:
    """No database: nothing saved, every save reports failure."""

    async def get_saved_roster_periods(self, periods, kind, team_id=0):
        return None

    async def get_roster_day_rows(self, period, team_id):
        return []

    async def save_roster_day(self, period, team_id, rows):
        return False

    async def get_roster_moves(self, periods):
        return []

    async def save_roster_moves(self, period, rows):
        return False


@pytest.mark.asyncio
async def test_get_roster_day_builds_the_day_and_caches_without_db():
    service = svc.RosterDayService()
    service._db = _FakeDB()
    season_start = date(2026, 10, 20)
    provider = AsyncMock()
    provider.get_team_names.return_value = [{"team_id": 1, "team_name": "A"}, {"team_id": 2, "team_name": "B"}]
    provider.get_players_directory.return_value = {}
    provider.get_pro_team_schedules.return_value = {"settings": {"proTeams": [
        {"id": 13, "proGamesByScoringPeriod": {"16": [{"id": 1, "date": 1_793_000_000_000, "homeProTeamId": 23, "awayProTeamId": 13}]}},
        {"id": 15, "proGamesByScoringPeriod": {"16": [{"id": 2, "date": 1_793_000_000_000, "homeProTeamId": 15, "awayProTeamId": 2}]}},
    ]}}
    calls = []

    async def fake_get(params):
        calls.append(dict(params)["view"])
        if dict(params)["view"] == "mRoster":
            # One team per request (rosterForTeamId); ESPN still lists every team.
            assert "rosterForTeamId" in dict(params)
        if dict(params)["view"] == "mRoster":
            return _roster_payload(16)
        return {"transactions": []}

    with patch.object(svc, "get_data_provider", return_value=provider), \
         patch.object(svc.schedule_service, "get_season_start_date", AsyncMock(return_value=season_start)), \
         patch.object(svc, "eastern_today", return_value=date(2026, 11, 5)), \
         patch.object(service, "_get", side_effect=fake_get):
        day = await service.get_roster_day(1, date(2026, 11, 4))
        assert day.scoring_period_id == 16 and day.is_today is False and day.has_games is True
        by_name = {p.player_name: p for p in day.players}
        assert set(by_name) == {"Starter Guy", "Bench Guy", "Off Day"}
        assert by_name["Starter Guy"].status == "played" and by_name["Starter Guy"].opponent == "SAC"
        assert by_name["Starter Guy"].stats.pts == 21
        assert by_name["Bench Guy"].status == "dnp" and by_name["Bench Guy"].stats is None
        assert by_name["Off Day"].status == "no_game"
        assert calls.count("mRoster") == 1

        # The same team-day again: served from the in-process copy (no database here).
        service._responses.clear()
        await service.get_roster_day(1, date(2026, 11, 4))
        assert calls.count("mRoster") == 1

        # Another team on the same day is its own small request.
        other = await service.get_roster_day(2, date(2026, 11, 4))
        assert [p.player_name for p in other.players] == ["Other Team"]
        assert calls.count("mRoster") == 2

        with pytest.raises(InvalidParameterError):
            await service.get_roster_day(1, date(2026, 11, 6))
        with pytest.raises(InvalidParameterError):
            await service.get_roster_day(1, date(2026, 10, 19))
        with pytest.raises(svc.ResourceNotFoundError):
            await service.get_roster_day(9, date(2026, 11, 4))
