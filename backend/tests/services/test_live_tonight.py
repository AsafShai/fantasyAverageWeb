"""Tonight per player, for the team page's Daily roster and its "N starters
are playing now" note (plan section 7 step 3)."""
from app.services import live_overlay as lo
from tests.services.test_live_overlay import (
    GAME_A, GAME_B, LINE_10PTS, _entry, _line, _payload, _slot_state,
)

TIP = 1_794_528_000_000
HOUR = 3_600_000
# pro team 20 plays game A, 27 game B, 16 game C (later tip), 5 has no game.
GAMES = {20: (GAME_A, TIP), 28: (GAME_A, TIP), 27: (GAME_B, TIP), 8: (GAME_B, TIP),
         16: ("401909978", TIP + HOUR), 6: ("401909978", TIP + HOUR)}


def _with_team(entry, pro_team):
    entry["playerPoolEntry"]["player"]["proTeamId"] = pro_team
    return entry


def _raw(**kw):
    return _payload(entries_by_team={1: [
        _with_team(_entry(11, 0, _line(GAME_A, 24, LINE_10PTS)), 20),   # PG, playing
        _with_team(_entry(12, 1, _line(GAME_B, 24, LINE_10PTS)), 27),   # SG, playing
        _with_team(_entry(13, 2), 16),                                  # SF, game later
        _with_team(_entry(14, 12, _line(GAME_A, 24, LINE_10PTS)), 28),  # BE, playing
        _with_team(_entry(15, 3), 5),                                   # PF, no game
    ]}, **kw)


def test_tonight_players_reads_slots_lines_and_games():
    players = {p.player_id: p for p in lo.tonight_players(_raw(), 1)}
    assert set(players) == {11, 12, 13, 14, 15}
    assert players[11].counts and players[11].played and players[11].game_id == GAME_A
    assert players[11].line["0"] == 10.0
    assert players[13].line is None and not players[13].played
    assert players[14].counts is False          # bench never counts
    assert lo.tonight_players(_raw(), 9) == []


def test_capped_slot_does_not_count():
    raw = _raw(slots_by_team={1: _slot_state(s0=20)})
    players = {p.player_id: p for p in lo.tonight_players(raw, 1)}
    assert players[11].counts is False and players[12].counts is True


def test_pro_team_games_maps_both_sides():
    import json
    from pathlib import Path
    schedule = json.loads((Path(__file__).resolve().parent.parent / "fixtures"
                           / "pro_team_schedules_2027_periods_22_25.json").read_text())
    games = lo.pro_team_games(schedule, 24)
    assert games[20] == (GAME_A, TIP) and games[28] == (GAME_A, TIP)
    assert games[8][0] == GAME_B
    assert 1 not in games


def test_game_phase():
    assert lo.game_phase(None, None, set(), TIP) is None
    assert lo.game_phase(GAME_A, TIP, set(), TIP - 1) == 'scheduled'
    assert lo.game_phase(GAME_A, TIP, set(), TIP - 1, has_line=True) == 'live'
    assert lo.game_phase(GAME_A, TIP, set(), TIP) == 'live'
    assert lo.game_phase(GAME_A, TIP, {GAME_A}, TIP) == 'final'


def test_starters_playing_counts_checked_in_starters_whose_game_is_not_final():
    players = lo.tonight_players(_raw(), 1)
    now = TIP + HOUR // 2
    assert lo.starters_playing(players, GAMES, set(), now) == 2          # PG and SG, not BE
    assert lo.starters_playing(players, GAMES, {GAME_A}, now) == 1       # PG's game final
    assert lo.starters_playing(players, GAMES, {GAME_A, GAME_B}, now) == 0


# --- through the real DataProvider ---------------------------------------------

import pytest  # noqa: E402

from tests.services.test_live_data_provider import flag_off, flag_on, provider  # noqa: E402,F401


@pytest.mark.real_dataprovider
@pytest.mark.asyncio
async def test_starters_live_follows_finals_known_to_the_provider(provider, flag_on):
    await provider.get_live_state(include_finals=True)
    assert await provider.get_starters_live(1) == 2
    provider.scoreboard.return_value = {"games": [{"game_id": GAME_A, "status": "final"}]}
    await provider.get_live_state(include_finals=True)
    assert await provider.get_starters_live(1) == 1
    assert await provider.get_starters_live(2) == 0


@pytest.mark.real_dataprovider
@pytest.mark.asyncio
async def test_starters_live_is_zero_with_the_flag_off(provider, flag_off):
    await provider.get_totals_df()
    assert await provider.get_starters_live(1) == 0
