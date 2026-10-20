import json
from datetime import date, datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.exceptions import DataSourceError
from app.models.activity_models import ActivityTeam
from app.services import league_activity_service as las
from app.services.league_activity_service import (
    GameLine,
    LeagueActivityService,
    Schedule,
    build_league_activity,
    merge_card_transactions,
    parse_game_logs,
    parse_schedule,
    parse_teams,
)

FIXTURE = json.loads((Path(__file__).parent.parent / 'fixtures' / 'league_activity_2026_trimmed.json').read_text())
SEASON_START = date.fromisoformat(FIXTURE['season_start'])
ASAF, DOR = 1, 8
ADEBAYO, COLLINS, MOBLEY, REED, DUNN = 4066261, 3908845, 4432158, 4278562, 2991139
MAR17 = 'cf9f5a50-f1d8-4eb9-b3b3-e4e29927f4b9'


def build_fixture(**kwargs):
    txs, names = merge_card_transactions(FIXTURE['cards'])
    return build_league_activity(
        season_id=2026,
        transactions=txs,
        game_logs=parse_game_logs(FIXTURE['stat_cards'], 2026),
        schedule=parse_schedule(FIXTURE['schedule'], 1, 174),
        season_start=SEASON_START,
        teams=parse_teams(FIXTURE['league']),
        categories=['PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'FG%', 'FT%'],
        latest_period=174,
        names=names,
        **kwargs,
    )


def raw_points(pid: int, first: int, last: int) -> tuple[float, int]:
    """Independent tally straight from the fixture JSON: points and games
    (minutes > 0) for pid over scoring periods first..last."""
    pts, games = 0.0, 0
    card = next(c for c in FIXTURE['stat_cards'] if c['id'] == pid)
    for s in card['player']['stats']:
        if first <= s['scoringPeriodId'] <= last and s['stats'].get('40', 0) > 0:
            pts += s['stats'].get('0', 0)
            games += 1
    return pts, games


# --- synthetic data -----------------------------------------------------------
# Day n's roster locks at noon UTC on Oct 20 + n; game ids are "g<period>".

DAY_MS = 86_400_000
LOCK0 = int(datetime(2025, 10, 21, 12, tzinfo=timezone.utc).timestamp() * 1000)


def lock(period: int) -> int:
    return LOCK0 + (period - 1) * DAY_MS


def schedule(last: int = 10) -> Schedule:
    return Schedule(
        period_lock={p: lock(p) for p in range(1, last + 2)},
        game_start={f'g{p}': lock(p) + 3 * 3_600_000 for p in range(1, last + 1)},
    )


def tx(tx_id: str, kind: str, ms: int, items: list[tuple], related: str | None = None) -> dict:
    out = {'id': tx_id, 'type': kind, 'status': 'EXECUTED', 'proposedDate': ms, 'scoringPeriodId': 0,
           'items': [{'type': t, 'playerId': pid, 'fromTeamId': f, 'toTeamId': to} for t, pid, f, to in items]}
    if related:
        out['relatedTransactionId'] = related
    return out


def games(pid_lines: dict[int, list[int]], played=True) -> dict[int, list[GameLine]]:
    return {pid: [GameLine(period=p, game_id=f'g{p}', box={'PTS': 10.0} if played else {}) for p in ps]
            for pid, ps in pid_lines.items()}


def build(txs, logs=None, last=10, **kw):
    return build_league_activity(
        season_id=2026, transactions=txs, game_logs=logs or {}, schedule=schedule(last),
        season_start=date(2025, 10, 21),
        teams=[ActivityTeam(team_id=i, name=f'T{i}', abbrev=f'T{i}') for i in (1, 2, 3)],
        categories=['PTS'], latest_period=last, **kw,
    )


class TestParsing:
    def test_card_transactions_are_merged_across_cards(self):
        shared = {'id': 'x', 'type': 'FREEAGENT', 'items': [{'type': 'ADD', 'playerId': 1, 'fromTeamId': 0, 'toTeamId': 3}]}
        other_copy = {'id': 'x', 'type': 'FREEAGENT', 'items': [{'type': 'DROP', 'playerId': 2, 'fromTeamId': 3, 'toTeamId': 0}]}
        txs, names = merge_card_transactions([
            {'id': 1, 'player': {'fullName': 'One'}, 'transactions': [shared]},
            {'id': 2, 'player': {'fullName': 'Two'}, 'transactions': [other_copy]},
        ])
        assert len(txs) == 1
        assert [i['type'] for i in txs[0]['items']] == ['ADD', 'DROP']
        assert names == {1: 'One', 2: 'Two'}

    def test_game_logs_keep_single_games_and_mark_dnp(self):
        card = {'id': 7, 'player': {'stats': [
            {'seasonId': 2026, 'scoringPeriodId': 3, 'statSourceId': 0, 'statSplitTypeId': 5, 'externalId': '11',
             'stats': {'0': 21.0, '6': 9.0, '14': 15.0, '40': 33.0}},
            {'seasonId': 2026, 'scoringPeriodId': 4, 'statSourceId': 0, 'statSplitTypeId': 5, 'externalId': '12', 'stats': {}},
            {'seasonId': 2026, 'scoringPeriodId': 0, 'statSourceId': 0, 'statSplitTypeId': 0, 'stats': {'0': 999.0}},
            {'seasonId': 2026, 'scoringPeriodId': 3, 'statSourceId': 1, 'statSplitTypeId': 5, 'stats': {'0': 18.0}},
        ]}}
        lines = parse_game_logs([card], 2026)[7]
        assert [(g.period, g.game_id) for g in lines] == [(3, '11'), (4, '12')]
        assert lines[0].box['PTS'] == 21.0 and lines[0].box['FGA'] == 15.0
        assert lines[1].box == {}

    def test_schedule_locks_at_first_tip_and_fills_off_days(self):
        data = {'settings': {'proTeams': [
            {'proGamesByScoringPeriod': {'1': [{'id': 1, 'date': 5_000}], '3': [{'id': 3, 'date': 9_000_000_000}]}},
            {'proGamesByScoringPeriod': {'1': [{'id': 2, 'date': 4_000}]}},
        ]}}
        s = parse_schedule(data, 1, 3)
        assert s.period_lock[1] == 4_000  # earliest game of the day
        assert s.period_lock[2] == 4_000 + DAY_MS  # no games: a day after period 1
        assert s.game_start['2'] == 4_000


class TestRealTrade:
    """The 2026-03-17 trade between teams 1 and 8, from trimmed real data."""

    def trade(self, result):
        return next(t for t in result.trades if t.id == MAR17)

    def stint(self, result, pid):
        return next(p for s in self.trade(result).sides for p in s.received if p.player_id == pid)

    def test_sides_and_dates(self):
        trade = self.trade(build_fixture())
        received = {s.team_id: sorted(p.name for p in s.received) for s in trade.sides}
        assert received == {ASAF: ['Bam Adebayo', 'John Collins'], DOR: ['Evan Mobley']}
        assert trade.date == date(2026, 3, 17)

    def test_release_made_for_the_trade(self):
        result = build_fixture()
        assert [p.name for p in self.trade(result).released_for_trade] == ['Kris Dunn']
        trade_drops = [m for m in result.moves if m.kind == 'trade_drop']
        assert [p.player_id for m in trade_drops for p in m.dropped] == [DUNN]

    def test_stint_totals_match_raw_box_scores(self):
        adebayo = self.stint(build_fixture(), ADEBAYO)
        pts, games_played = raw_points(ADEBAYO, 148, 174)
        assert (adebayo.games_played, adebayo.totals['PTS']) == (games_played, pts) == (13, 266.0)
        assert adebayo.team_games == 14  # one DNP while on team 1
        assert adebayo.start == date(2026, 3, 17)
        assert adebayo.exit == 'on_roster'

    def test_season_over_marks_season_end(self):
        assert self.stint(build_fixture(season_over=True), ADEBAYO).exit == 'season_end'

    def test_released_player_picked_up_by_other_team(self):
        collins = self.stint(build_fixture(), COLLINS)
        assert (collins.exit, collins.end, collins.games_played) == ('released', date(2026, 3, 27), 5)
        assert collins.picked_up_after.team_id == DOR
        assert collins.picked_up_after.date == date(2026, 3, 30)

    def test_open_roster_spot_is_the_no_drop_pickup(self):
        spot = self.trade(build_fixture()).open_roster_spot
        assert (spot.team_id, spot.stint.player_id, spot.added_on) == (DOR, REED, date(2026, 3, 17))

    def test_released_list_threshold(self):
        assert all(r.stint.games_played >= las.MIN_RELEASED_GAMES for r in build_fixture().released)
        with patch.object(las, 'MIN_RELEASED_GAMES', 1):
            released = build_fixture().released
        assert ('John Collins', ASAF, DOR) in [(r.name, r.released_by, r.stint.team_id) for r in released]

    def test_feed_is_newest_first_and_has_the_trade(self):
        result = build_fixture()
        assert [m.at for m in result.moves] == sorted((m.at for m in result.moves), reverse=True)
        trade_move = next(m for m in result.moves if m.trade_id == MAR17)
        assert {trade_move.team_id, trade_move.other_team_id} == {ASAF, DOR}
        assert {m.kind for m in result.moves} <= {'add', 'drop', 'waiver', 'trade_drop', 'trade'}


class TestOwnership:
    def test_move_after_first_tip_counts_from_the_next_day(self):
        # Added after day 3's first tip-off: day 3's game isn't his team's.
        txs = [tx('a', 'FREEAGENT', lock(3) + 1, [('ADD', 10, 0, 1)])]
        b = las._Builder(txs, games({10: [3, 4, 5]}), schedule(), date(2025, 10, 21), {}, False, 10, False)
        s = b.stints[0]
        assert (s.first_period, b._games(s)[0]) == (4, 2)

    def test_per_game_lock_uses_the_players_own_tip_off(self):
        # Same add, but this league locks each player at his own game (3h after the day's lock).
        txs = [tx('a', 'FREEAGENT', lock(3) + 1, [('ADD', 10, 0, 1)])]
        b = las._Builder(txs, games({10: [3, 4, 5]}), schedule(), date(2025, 10, 21), {}, False, 10, True)
        assert b._games(b.stints[0])[0] == 3

    def test_dnp_counts_as_team_game_not_game_played(self):
        txs = [tx('d', 'DRAFT', lock(1) - 1, [('DRAFT', 10, 0, 1)])]
        logs = {10: [GameLine(1, 'g1', {'PTS': 12.0}), GameLine(2, 'g2', {})]}
        b = las._Builder(txs, logs, schedule(), date(2025, 10, 21), {}, False, 10, False)
        assert b._games(b.stints[0])[:2] == (1, 2)


class TestTrades:
    def test_trade_sides_and_onward_trade_link(self):
        txs = [
            tx('d1', 'DRAFT', lock(1) - 9, [('DRAFT', 10, 0, 1)]),
            tx('d2', 'DRAFT', lock(1) - 8, [('DRAFT', 20, 0, 2)]),
            tx('t1', 'TRADE_ACCEPT', lock(3) - 5, [('TRADE', 10, 1, 2), ('TRADE', 20, 2, 1)], related='T1'),
            tx('t2', 'TRADE_ACCEPT', lock(6) - 5, [('TRADE', 20, 1, 3)], related='T2'),
        ]
        r = build(txs, games({10: [1, 2, 3, 4], 20: [3, 4, 5, 6]}))
        assert [t.id for t in r.trades] == ['T1', 'T2']
        t1 = r.trades[0]
        assert t1.date == date(2025, 10, 23)
        got = {s.team_id: [(p.player_id, p.games_played, p.exit, p.exit_trade_id) for p in s.received] for s in t1.sides}
        assert got == {1: [(20, 3, 'traded', 'T2')], 2: [(10, 2, 'on_roster', None)]}

    def test_same_day_trade_and_release_is_a_zero_day_stint(self):
        txs = [
            tx('d', 'DRAFT', lock(1) - 9, [('DRAFT', 10, 0, 1)]),
            tx('t', 'TRADE_ACCEPT', lock(4) - 9, [('TRADE', 10, 1, 2)], related='T'),
            tx('r', 'ROSTER', lock(4) - 5, [('DROP', 10, 2, 0)]),
        ]
        stint = build(txs, games({10: [3, 4]})).trades[0].sides[1].received[0]
        assert (stint.days, stint.games_played, stint.exit) == (0, 0, 'released')

    def test_open_spot_needs_a_pickup_without_a_drop_inside_the_window(self):
        base = [
            tx('d1', 'DRAFT', lock(1) - 9, [('DRAFT', 10, 0, 1), ('DRAFT', 11, 0, 1)]),
            tx('d2', 'DRAFT', lock(1) - 8, [('DRAFT', 20, 0, 2)]),
            tx('t', 'TRADE_ACCEPT', lock(3) - 5, [('TRADE', 10, 1, 2), ('TRADE', 11, 1, 2), ('TRADE', 20, 2, 1)], related='T'),
        ]
        swap = tx('s', 'FREEAGENT', lock(3), [('ADD', 30, 0, 1), ('DROP', 20, 1, 0)])
        late = tx('l', 'FREEAGENT', lock(3) + 4 * DAY_MS, [('ADD', 31, 0, 1)])
        assert build(base + [swap, late]).trades[0].open_roster_spot is None
        clean = tx('c', 'FREEAGENT', lock(3) + DAY_MS, [('ADD', 32, 0, 1)])
        spot = build(base + [clean]).trades[0].open_roster_spot
        assert (spot.team_id, spot.stint.player_id) == (1, 32)

    def test_draft_pick_trades_are_ignored(self):
        txs = [tx('p', 'TRADE_ACCEPT', lock(1) - 99, [('DRAFT_TRADE', 0, 1, 2)], related='P')]
        assert build(txs).trades == []

    def test_released_then_readded_by_same_team_is_not_listed(self):
        txs = [
            tx('d', 'DRAFT', lock(1) - 9, [('DRAFT', 10, 0, 1)]),
            tx('r', 'ROSTER', lock(2) - 5, [('DROP', 10, 1, 0)]),
            tx('a', 'FREEAGENT', lock(3) - 5, [('ADD', 10, 0, 1)]),
        ]
        with patch.object(las, 'MIN_RELEASED_GAMES', 1):
            assert build(txs, games({10: [1, 2, 3, 4, 5]})).released == []


class TestServiceCaching:
    LEAGUE = {'status': {'firstScoringPeriod': 1, 'latestScoringPeriod': 3, 'finalScoringPeriod': 10},
              'teams': [{'id': 1, 'name': 'One', 'abbrev': 'ONE'}],
              'settings': {'scoringSettings': {'scoringItems': [{'statId': 0}]},
                           'rosterSettings': {'rosterLocktimeType': 'FIRSTGAME_SCORINGPERIOD'}}}
    CARD = {'id': 10, 'player': {'fullName': 'Ten'}, 'transactions': [
        {'id': 'd', 'type': 'DRAFT', 'status': 'EXECUTED', 'proposedDate': 1, 'items': [
            {'type': 'DRAFT', 'playerId': 10, 'fromTeamId': 0, 'toTeamId': 1}]}]}

    @pytest.fixture(autouse=True)
    def fresh_cache(self):
        las._cache.clear()
        yield
        las._cache.clear()

    def service(self, fail=False):
        calls = []

        async def fake_get(params, fantasy_filter=None, url=None):
            views = tuple(v for k, v in params if k == 'view')
            calls.append(views[0] if 'kona_playercard' not in views else
                         ('stats' if 'filterIds' in (fantasy_filter or '') else 'cards'))
            if fail:
                raise httpx.ConnectError('down')
            if 'mSettings' in views:
                return self.LEAGUE
            if 'proTeamSchedules_wl' in views:
                return {'settings': {'proTeams': []}}
            if 'filterIds' in (fantasy_filter or ''):
                return {'players': [{'id': 10, 'player': {'stats': []}}]}
            return {'players': [self.CARD, {'id': 99, 'player': {'fullName': 'No moves'}, 'transactions': []}]}

        svc = LeagueActivityService(season_id=2026, league_id=1)
        svc._get = AsyncMock(side_effect=fake_get)
        return svc, calls

    @pytest.mark.asyncio
    async def test_cold_start_is_a_handful_of_calls_then_cached(self):
        svc, calls = self.service()
        first = await svc.get_activity()
        assert sorted(calls) == ['cards', 'mSettings', 'proTeamSchedules_wl', 'stats']
        assert [t.abbrev for t in first.teams] == ['ONE']

        calls.clear()
        assert await svc.get_activity() is first
        assert calls == []

    @pytest.mark.asyncio
    async def test_each_source_refreshes_on_its_own_schedule(self):
        svc, calls = self.service()
        await svc.get_activity()
        calls.clear()
        las._cache.cards_at -= las.CARDS_TTL_SECONDS + 1
        await svc.get_activity()
        assert sorted(calls) == ['cards', 'mSettings']  # stats and schedule still fresh

        calls.clear()
        las._cache.stats_at -= las.STATS_TTL_SECONDS + 1
        las._cache.schedule_at -= las.SCHEDULE_TTL_SECONDS + 1
        await svc.get_activity()
        assert sorted(calls) == ['proTeamSchedules_wl', 'stats']

    @pytest.mark.asyncio
    async def test_only_players_with_transactions_get_stats(self):
        svc, _ = self.service()
        await svc.get_activity()
        filters = [c.args[1] for c in svc._get.call_args_list if len(c.args) > 1 and c.args[1]]
        stats_filter = next(f for f in filters if 'filterIds' in f)
        assert '"value":[10]' in stats_filter.replace(' ', '')

    @pytest.mark.asyncio
    async def test_failure_without_cache_raises(self):
        svc, _ = self.service(fail=True)
        with pytest.raises(DataSourceError):
            await svc.get_activity()

    @pytest.mark.asyncio
    async def test_failure_serves_last_good_result(self):
        svc, _ = self.service()
        good = await svc.get_activity()
        las._cache.cards_at -= las.CARDS_TTL_SECONDS + 1
        failing, _ = self.service(fail=True)
        assert await failing.get_activity() is good


class TestFetchRetry:
    @pytest.mark.asyncio
    async def test_transport_error_is_retried(self):
        svc = LeagueActivityService(season_id=2026, league_id=1)
        ok = httpx.Response(200, json={'ok': True}, request=httpx.Request('GET', svc.url))
        client = AsyncMock()
        client.get.side_effect = [httpx.RemoteProtocolError('Server disconnected'), ok]
        svc._client = client
        with patch.object(las.asyncio, 'sleep', new=AsyncMock()):
            assert await svc._get([('view', 'mTeam')]) == {'ok': True}
        assert client.get.call_count == 2

    @pytest.mark.asyncio
    async def test_gives_up_after_retries(self):
        svc = LeagueActivityService(season_id=2026, league_id=1)
        client = AsyncMock()
        client.get.side_effect = httpx.ConnectError('down')
        svc._client = client
        with patch.object(las.asyncio, 'sleep', new=AsyncMock()), pytest.raises(httpx.ConnectError):
            await svc._get([('view', 'mTeam')])
        assert client.get.call_count == las.FETCH_RETRIES + 1
