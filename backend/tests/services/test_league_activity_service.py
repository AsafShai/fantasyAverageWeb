import json
from datetime import date
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.exceptions import DataSourceError
from app.models.activity_models import ActivityTeam
from app.services import league_activity_service as las
from app.services.league_activity_service import (
    DaySnapshot,
    LeagueActivityService,
    build_league_activity,
    parse_roster_snapshot,
    parse_teams,
)

FIXTURE = json.loads((Path(__file__).parent.parent / 'fixtures' / 'league_activity_2026_trimmed.json').read_text())
SEASON_START = date.fromisoformat(FIXTURE['season_start'])
ASAF, DOR = 1, 8
ADEBAYO, COLLINS, MOBLEY, REED, TSHIEBWE = 4066261, 3908845, 4432158, 4278562, 4432827


def fixture_snapshots() -> dict[int, DaySnapshot]:
    return {int(p): parse_roster_snapshot(data, int(p)) for p, data in FIXTURE['rosters'].items()}


def build_fixture(**kwargs):
    return build_league_activity(
        season_id=2026,
        snapshots=fixture_snapshots(),
        transactions=FIXTURE['transactions'],
        season_start=SEASON_START,
        teams=parse_teams(FIXTURE['league']),
        categories=['PTS', 'REB', 'AST', 'STL', 'BLK', '3PM', 'FG%', 'FT%'],
        **kwargs,
    )


def raw_points(pid: int, team: int, first: int, last: int) -> tuple[float, int]:
    """Independent tally straight from the fixture JSON: points and games
    (minutes > 0) for pid while on `team`, over periods first..last."""
    pts, games = 0.0, 0
    for p, data in FIXTURE['rosters'].items():
        if not first <= int(p) <= last:
            continue
        for t in data['teams']:
            for e in t['roster']['entries']:
                if t['id'] != team or e['playerId'] != pid:
                    continue
                for s in e['playerPoolEntry']['player']['stats']:
                    if s['stats'].get('40', 0) > 0:
                        pts += s['stats'].get('0', 0)
                        games += 1
    return pts, games


def snap(owners: dict[int, int], box: dict[int, dict] | None = None) -> DaySnapshot:
    return DaySnapshot(owners=owners, names={pid: f'P{pid}' for pid in owners}, box=box or {})


def accept(tx_id: str, team: int, period: int, ms: int, related: str, drops=()) -> dict:
    return {
        'id': tx_id, 'type': 'TRADE_ACCEPT', 'teamId': team, 'scoringPeriodId': period,
        'proposedDate': ms, 'relatedTransactionId': related,
        'items': [{'type': 'DROP', 'playerId': pid, 'fromTeamId': team, 'toTeamId': 0} for pid in drops],
    }


def fa(tx_id: str, period: int, ms: int, team: int, add=None, drop=None, kind='FREEAGENT') -> dict:
    items = []
    if add:
        items.append({'type': 'ADD', 'playerId': add, 'fromTeamId': 0, 'toTeamId': team})
    if drop:
        items.append({'type': 'DROP', 'playerId': drop, 'fromTeamId': team, 'toTeamId': 0})
    return {'id': tx_id, 'type': kind, 'status': 'EXECUTED', 'scoringPeriodId': period,
            'proposedDate': ms, 'teamId': team, 'items': items}


class TestParseRosterSnapshot:
    def test_box_line_dnp_and_no_game(self):
        data = {'teams': [{'id': 3, 'roster': {'entries': [
            {'playerId': 1, 'playerPoolEntry': {'player': {'fullName': 'Played', 'stats': [
                {'statSourceId': 0, 'statSplitTypeId': 5, 'scoringPeriodId': 10,
                 'stats': {'0': 20.0, '6': 7.0, '13': 8.0, '14': 15.0, '40': 31.0}},
                # yesterday's line rides along in the same payload and must be ignored
                {'statSourceId': 0, 'statSplitTypeId': 5, 'scoringPeriodId': 9, 'stats': {'0': 99.0, '40': 30.0}},
            ]}}},
            {'playerId': 2, 'playerPoolEntry': {'player': {'fullName': 'Sat', 'stats': [
                {'statSourceId': 0, 'statSplitTypeId': 5, 'scoringPeriodId': 10, 'stats': {}},
            ]}}},
            {'playerId': 3, 'playerPoolEntry': {'player': {'fullName': 'Off day', 'stats': []}}},
        ]}}]}

        s = parse_roster_snapshot(data, 10)

        assert s.owners == {1: 3, 2: 3, 3: 3}
        assert s.box[1]['PTS'] == 20.0 and s.box[1]['REB'] == 7.0 and s.box[1]['FGA'] == 15.0
        assert s.box[2] == {}  # team played, he didn't
        assert 3 not in s.box  # no game that day


class TestRealTrade:
    """The 2026-03-17 trade between teams 1 and 8, from trimmed real data."""

    def trade(self, result):
        return next(t for t in result.trades if t.date == date(2026, 3, 17))

    def test_sides_and_dates(self):
        result = build_fixture()
        trade = self.trade(result)

        received = {s.team_id: sorted(p.name for p in s.received) for s in trade.sides}
        assert received == {ASAF: ['Bam Adebayo', 'John Collins'], DOR: ['Evan Mobley']}
        assert trade.id.startswith('cf9f5a50')  # DOR's accept, not team 1's withdrawn one
        assert trade.accepted_at.date() == date(2026, 3, 16)

    def test_withdrawn_accept_release_is_not_attributed(self):
        result = build_fixture()

        assert self.trade(result).released_for_trade == []
        assert not [m for m in result.moves if m.kind == 'trade_drop']
        # the release still shows up as the plain roster drop it was
        drops = [m for m in result.moves if m.kind == 'drop']
        assert [p.player_id for m in drops for p in m.dropped] == [TSHIEBWE]

    def test_stint_totals_match_raw_box_scores(self):
        result = build_fixture()
        adebayo = next(p for s in self.trade(result).sides for p in s.received if p.player_id == ADEBAYO)

        pts, games = raw_points(ADEBAYO, ASAF, 148, 162)
        assert adebayo.totals['PTS'] == pts
        assert adebayo.games_played == games
        assert adebayo.team_games >= adebayo.games_played
        assert adebayo.start == date(2026, 3, 17)
        assert adebayo.exit == 'on_roster'

    def test_season_over_marks_season_end(self):
        result = build_fixture(season_over=True)
        adebayo = next(p for s in self.trade(result).sides for p in s.received if p.player_id == ADEBAYO)
        assert adebayo.exit == 'season_end'

    def test_released_player_picked_up_by_other_team(self):
        collins = next(p for s in self.trade(build_fixture()).sides for p in s.received if p.player_id == COLLINS)

        assert collins.exit == 'released'
        assert collins.end == date(2026, 3, 27)
        assert collins.picked_up_after.team_id == DOR
        assert collins.picked_up_after.date == date(2026, 3, 30)

    def test_open_roster_spot_is_the_no_drop_pickup(self):
        spot = self.trade(build_fixture()).open_roster_spot

        assert spot.team_id == DOR
        assert spot.stint.player_id == REED
        assert spot.added_on == date(2026, 3, 17)

    def test_released_list_threshold(self):
        assert build_fixture().released == []  # Collins played 2 games for DOR in the fixture window
        with patch.object(las, 'MIN_RELEASED_GAMES', 1):
            released = build_fixture().released
        assert [(r.name, r.released_by, r.stint.team_id) for r in released if r.player_id == COLLINS] == [
            ('John Collins', ASAF, DOR)
        ]

    def test_feed_is_newest_first_and_has_the_trade(self):
        result = build_fixture()
        assert [m.at for m in result.moves] == sorted((m.at for m in result.moves), reverse=True)
        trade_moves = [m for m in result.moves if m.kind == 'trade']
        assert len(trade_moves) == 1
        assert {trade_moves[0].team_id, trade_moves[0].other_team_id} == {ASAF, DOR}


class TestEdgeCases:
    def build(self, snapshots, txs):
        return build_league_activity(
            season_id=2026, snapshots=snapshots, transactions=txs, season_start=date(2025, 10, 21),
            teams=[ActivityTeam(team_id=i, name=f'T{i}', abbrev=f'T{i}') for i in (1, 2, 3)], categories=['PTS'],
        )

    def test_release_and_same_day_pickup_is_not_a_trade(self):
        snaps = {1: snap({10: 1}), 2: snap({10: 2})}
        txs = [fa('d', 2, 1, 1, drop=10), fa('a', 2, 2, 2, add=10)]

        result = self.build(snaps, txs)

        assert result.trades == []
        assert {m.kind for m in result.moves} == {'add', 'drop'}

    def test_unmatched_roster_move_is_still_a_trade(self):
        result = self.build({1: snap({10: 1, 20: 2}), 2: snap({10: 2, 20: 1})}, [])

        assert len(result.trades) == 1
        assert result.trades[0].accepted_at is None

    def test_vetoed_accept_yields_to_clean_one(self):
        snaps = {1: snap({10: 1, 20: 2}), 2: snap({10: 2, 20: 1})}
        txs = [
            accept('x', 1, 1, 100, 'withdrawn', drops=[30]),
            {'id': 'v', 'type': 'TRADE_VETO', 'teamId': 1, 'scoringPeriodId': 1, 'proposedDate': 101,
             'relatedTransactionId': 'withdrawn', 'items': []},
            accept('y', 2, 1, 200, 'real'),
        ]

        trade = self.build(snaps, txs).trades[0]

        assert trade.id == 'real'
        assert trade.released_for_trade == []

    @pytest.mark.parametrize('even_ms,uneven_ms', [(100, 200), (200, 100)])
    def test_accept_drops_pick_the_matching_trade(self, even_ms, uneven_ms):
        # team 1 accepted two trades the same day; the one that came with a
        # release is the 2-for-1 in its favour, whichever was accepted first
        snaps = {
            1: snap({10: 1, 20: 2, 21: 2, 30: 1, 40: 3}),
            2: snap({10: 2, 20: 1, 21: 1, 30: 3, 40: 1}),
        }
        txs = [accept('first', 1, 1, even_ms, 'even'), accept('second', 1, 1, uneven_ms, 'uneven', drops=[99])]

        trades = {t.id: t for t in self.build(snaps, txs).trades}

        uneven = trades['uneven']
        assert sorted(p.player_id for s in uneven.sides for p in s.received if s.team_id == 1) == [20, 21]
        assert [p.player_id for p in uneven.released_for_trade] == [99]
        assert trades['even'].released_for_trade == []

    def test_uneven_trade_without_pickup_has_no_open_spot(self):
        snaps = {1: snap({10: 1, 11: 1, 20: 2}), 2: snap({10: 2, 11: 2, 20: 1})}
        trade = self.build(snaps, []).trades[0]
        assert trade.open_roster_spot is None

    def test_pickup_with_a_drop_does_not_fill_the_open_spot(self):
        snaps = {1: snap({10: 1, 11: 1, 20: 2, 5: 1}), 2: snap({10: 2, 11: 2, 20: 1, 5: 1}),
                 3: snap({10: 2, 11: 2, 20: 1, 50: 1})}
        txs = [fa('swap', 3, 1_700_000_000_000, 1, add=50, drop=5)]
        trade = self.build(snaps, txs).trades[0]
        assert trade.open_roster_spot is None

    def test_dnp_counts_as_team_game_not_game_played(self):
        snaps = {
            1: snap({10: 1}),
            2: snap({10: 2}, box={10: {'PTS': 12.0}}),
            3: snap({10: 2}, box={10: {}}),
            4: snap({10: 2}),
        }
        stint = self.build(snaps, []).trades[0].sides[1].received[0]
        assert (stint.games_played, stint.team_games, stint.totals['PTS']) == (1, 2, 12.0)


class TestServiceCaching:
    LEAGUE = {'status': {'firstScoringPeriod': 1, 'latestScoringPeriod': 3, 'finalScoringPeriod': 10},
              'teams': [{'id': 1, 'name': 'One', 'abbrev': 'ONE'}],
              'settings': {'scoringSettings': {'scoringItems': [{'statId': 0}]}}}

    @pytest.fixture(autouse=True)
    def fresh_cache(self):
        las._cache.clear()
        yield
        las._cache.clear()

    def service(self, fail=False):
        calls = []

        async def fake_get(params):
            calls.append(dict(params) | {'views': tuple(v for k, v in params if k == 'view')})
            if fail:
                raise httpx.ConnectError('down')
            views = calls[-1]['views']
            if 'mSettings' in views:
                return self.LEAGUE
            if 'mRoster' in views:
                return {'teams': [{'id': 1, 'roster': {'entries': []}}]}
            return {'transactions': []}

        svc = LeagueActivityService(season_id=2026, league_id=1)
        svc._get = AsyncMock(side_effect=fake_get)
        return svc, calls

    def roster_periods(self, calls):
        return sorted(int(c['scoringPeriodId']) for c in calls if 'mRoster' in c['views'])

    @pytest.mark.asyncio
    async def test_past_days_fetched_once_latest_refreshed(self):
        svc, calls = self.service()
        with patch.object(las, 'DataProvider') as dp:
            dp.return_value.get_players_directory = AsyncMock(return_value={})
            first = await svc.get_activity()
            assert self.roster_periods(calls) == [1, 2, 3]

            # same status window: served from the built result
            assert await svc.get_activity() is first
            assert self.roster_periods(calls) == [1, 2, 3]

            # status expired: only the latest day is fetched again
            las._cache.status_at -= las.STATUS_TTL_SECONDS + 1
            calls.clear()
            await svc.get_activity()
            assert self.roster_periods(calls) == [3]

    @pytest.mark.asyncio
    async def test_failure_without_cache_raises(self):
        svc, _ = self.service(fail=True)
        with pytest.raises(DataSourceError):
            await svc.get_activity()

    @pytest.mark.asyncio
    async def test_failure_serves_last_good_result(self):
        svc, _ = self.service()
        with patch.object(las, 'DataProvider') as dp:
            dp.return_value.get_players_directory = AsyncMock(return_value={})
            good = await svc.get_activity()
        las._cache.status_at -= las.STATUS_TTL_SECONDS + 1
        failing, _ = self.service(fail=True)

        assert await failing.get_activity() is good

    @pytest.mark.asyncio
    async def test_players_directory_failure_is_tolerated(self):
        svc, _ = self.service()
        with patch.object(las, 'DataProvider') as dp:
            dp.return_value.get_players_directory = AsyncMock(side_effect=DataSourceError('nope'))
            result = await svc.get_activity()
        assert [t.abbrev for t in result.teams] == ['ONE']
        assert result.categories == ['PTS']


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
