"""League activity: every add, drop, waiver claim and trade, plus what each side
of a trade actually got.

Everything comes from ESPN's player cards (view=kona_playercard), which carry
each player's full transaction history in this league (draft, adds, drops,
waiver claims and executed trades with every player on both sides) and, on
request, his per-game box scores for the season:

- one call lists the cards of every player with any transaction this season;
- a few batched calls return those players' per-game stats;
- one call returns the NBA schedule, to know when each scoring period locks.

The same per-game stats for the most-owned players form the pool each stint is
valued against (stint_value): his z-score and rank over the same dates.

A player belongs to a fantasy team for a scoring period if he was on it when
that period's roster locked. ESPN's rosterLocktimeType decides when that is:
the day's first tip-off (FIRSTGAME_SCORINGPERIOD) or the player's own game
(INDIVIDUAL_GAME). Checked against daily roster snapshots for 2025-26, this
attributes all 29,079 player-games to the same team ESPN did.
"""
import asyncio
import logging
import time
from bisect import bisect_left
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import httpx

from app.config import settings
from app.exceptions import DataSourceError
from app.models.activity_models import (
    ActivityMove,
    ActivityPlayer,
    ActivityTeam,
    LeagueActivity,
    OpenRosterSpot,
    PendingTrade,
    PendingTradeSide,
    PickedUpAfter,
    PlayerStint,
    ReleasedPlayer,
    StintValue,
    Trade,
    TradeSide,
)
from app.services.data_transformer import DataTransformer
from app.services.stint_value import StintValuer
from app.utils.espn_stat_map import STAT_ID_TO_CATEGORY
from app.utils.ssl_context import shared_ssl_context

logger = logging.getLogger(__name__)

ESPN_SEASON_URL = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{season}'
ESPN_LEAGUE_URL = ESPN_SEASON_URL + '/segments/0/leagues/{league}'

# Raw box-score stats kept per game: every countable category a roto league
# might score, plus the makes/attempts the percentage categories are built from.
BOX_STAT_IDS = (0, 1, 2, 3, 4, 5, 6, 11, 13, 14, 15, 16, 17, 18)
MINUTES_STAT_ID = '40'
SINGLE_PERIOD_SPLIT = 5
ACTUAL_STATS = 0

# More than the whole NBA player pool (~1,100), so one call covers every card.
CARD_LIMIT = 3000
STATS_BATCH = 50
# Most-owned players whose game logs form the pool stints are ranked against;
# comfortably more than the 300-player reference pool Player Rankings uses.
VALUE_POOL_SIZE = 450
# How soon after an uneven trade a no-drop pickup counts as filling the spot.
OPEN_SPOT_WINDOW_DAYS = 3
# Released players are listed only when the new team got some real use out of them.
MIN_RELEASED_GAMES = 5

CARDS_TTL_SECONDS = 5 * 60
STATS_TTL_SECONDS = 30 * 60
SCHEDULE_TTL_SECONDS = 24 * 60 * 60
FETCH_CONCURRENCY = 4
FETCH_RETRIES = 2

ROSTER_TYPES = ('FREEAGENT', 'WAIVER', 'ROSTER')


# ---------------------------------------------------------------------------
# Parsing ESPN payloads
# ---------------------------------------------------------------------------

def parse_teams(api_data: dict) -> list[ActivityTeam]:
    return sorted(
        (
            ActivityTeam(team_id=t['id'], name=t.get('name') or f"Team {t['id']}", abbrev=t.get('abbrev') or str(t['id']))
            for t in api_data.get('teams', []) if 'id' in t
        ),
        key=lambda t: t.team_id,
    )


def merge_card_transactions(cards: list[dict]) -> tuple[list[dict], dict[int, str]]:
    """Unique transactions across all cards, plus playerId -> name.

    A transaction shows up on the card of every player it involves; copies can
    differ in which items they carry, so their items are merged."""
    txs: dict[str, dict] = {}
    names: dict[int, str] = {}
    for card in cards:
        player = card.get('player') or {}
        if card.get('id') is not None and player.get('fullName'):
            names[card['id']] = player['fullName']
        for tx in card.get('transactions') or []:
            if 'id' not in tx:
                continue
            kept = txs.setdefault(tx['id'], {**tx, 'items': []})
            for item in tx.get('items') or []:
                if item not in kept['items']:
                    kept['items'].append(item)
    return list(txs.values()), names


def parse_pending_trades(api_data: dict, names: dict[int, str]) -> list[PendingTrade]:
    """Accepted trades still in the review period, soonest to process first.

    From the league's mPendingTransactions view. Offers the other team has not
    accepted yet are left out: they are between the two teams until accepted."""
    trades = []
    for tx in api_data.get('pendingTransactions') or []:
        if tx.get('type') != 'TRADE_ACCEPT' or tx.get('status') != 'PENDING' or 'id' not in tx:
            continue
        received: dict[int, list[ActivityPlayer]] = {}
        for item in tx.get('items') or []:
            if item.get('type') != 'TRADE' or item.get('toTeamId') is None:
                continue
            pid = item['playerId']
            received.setdefault(item['toTeamId'], []).append(
                ActivityPlayer(player_id=pid, name=names.get(pid, f'Player {pid}')))
            received.setdefault(item.get('fromTeamId'), [])
        received.pop(None, None)
        if not received:
            continue
        proposer = tx.get('teamId')
        order = sorted(received, key=lambda t: (t != proposer, t))
        votes = [a for t, a in (tx.get('teamActions') or {}).items() if int(t) not in received]
        trades.append(PendingTrade(
            id=tx['id'],
            proposed_by=proposer if proposer in received else None,
            proposed_at=_dt(tx['proposedDate']) if tx.get('proposedDate') else None,
            accepted_at=_dt(tx['acceptedDate']) if tx.get('acceptedDate') else None,
            processes_at=_dt(tx['processDate']) if tx.get('processDate') else None,
            sides=[PendingTradeSide(team_id=t, received=received[t]) for t in order],
            approvals=sum(a == 'APPROVED' for a in votes),
            vetoes=sum(str(a).startswith('VETO') for a in votes),
        ))
    return sorted(trades, key=lambda t: (t.processes_at is None, t.processes_at or datetime.min.replace(tzinfo=timezone.utc)))


@dataclass
class GameLine:
    period: int
    game_id: str
    box: dict[str, float]  # empty when he didn't play (DNP / injured)


def parse_game_logs(stat_cards: list[dict], season_id: int) -> dict[int, list[GameLine]]:
    logs: dict[int, list[GameLine]] = {}
    for card in stat_cards:
        lines = []
        for s in (card.get('player') or {}).get('stats') or []:
            if (s.get('statSplitTypeId') != SINGLE_PERIOD_SPLIT or s.get('statSourceId') != ACTUAL_STATS
                    or s.get('seasonId', season_id) != season_id):
                continue
            raw = s.get('stats') or {}
            played = float(raw.get(MINUTES_STAT_ID, 0) or 0) > 0
            box = {STAT_ID_TO_CATEGORY[sid]: float(raw.get(str(sid), 0) or 0) for sid in BOX_STAT_IDS} if played else {}
            lines.append(GameLine(period=s['scoringPeriodId'], game_id=str(s.get('externalId', '')), box=box))
        logs[card['id']] = sorted(lines, key=lambda g: g.period)
    return logs


@dataclass
class Schedule:
    """When each scoring period's roster locks (its first tip-off, ms) and when
    each NBA game starts. Periods without games lock a day after the previous one."""
    period_lock: dict[int, int] = field(default_factory=dict)
    game_start: dict[str, int] = field(default_factory=dict)


def parse_schedule(api_data: dict, first_period: int, last_period: int) -> Schedule:
    sched = Schedule()
    firsts: dict[int, int] = {}
    for team in (api_data.get('settings') or {}).get('proTeams') or []:
        for period, games in (team.get('proGamesByScoringPeriod') or {}).items():
            for g in games:
                sched.game_start[str(g['id'])] = g['date']
                p = int(period)
                firsts[p] = min(firsts.get(p, g['date']), g['date'])
    known = sorted(firsts)
    for p in range(first_period, last_period + 2):
        if p in firsts:
            sched.period_lock[p] = firsts[p]
        else:
            # Off day (All-Star break, season edges): a day after the closest
            # earlier period with games, or a day before the next one.
            i = bisect_left(known, p)
            if i > 0:
                sched.period_lock[p] = firsts[known[i - 1]] + (p - known[i - 1]) * 86_400_000
            elif known:
                sched.period_lock[p] = firsts[known[0]] - (known[0] - p) * 86_400_000
    return sched


# ---------------------------------------------------------------------------
# Building the activity view (pure; unit-tested against trimmed real data)
# ---------------------------------------------------------------------------

def _ms(tx: dict) -> int:
    return tx.get('processDate') or tx.get('proposedDate') or 0


def _dt(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc)


@dataclass
class _Stint:
    pid: int
    team: int
    acquired_at: int            # ms
    acquired_by: str            # transaction id
    left_at: Optional[int] = None
    left_by: Optional[dict] = None  # the transaction that ended it
    left_kind: Optional[str] = None  # 'TRADE' | 'DROP'
    first_period: int = 0       # first period whose lock falls inside the stint
    last_period: int = -1       # last such period (< first_period: never locked in)


class _Builder:
    def __init__(
        self,
        transactions: list[dict],
        game_logs: dict[int, list[GameLine]],
        schedule: Schedule,
        season_start: date,
        names: dict[int, str],
        season_over: bool,
        latest_period: int,
        lock_per_game: bool,
        valuer: Optional[StintValuer] = None,
    ):
        self.valuer = valuer
        self._values: dict[tuple[int, int], Optional[StintValue]] = {}
        self.txs = [tx for tx in transactions if tx.get('status', 'EXECUTED') == 'EXECUTED']
        self.logs = game_logs
        self.sched = schedule
        self.season_start = season_start
        self.names = names
        self.season_over = season_over
        self.latest = latest_period
        self.lock_per_game = lock_per_game
        self.periods = sorted(p for p in schedule.period_lock if p <= latest_period)
        self.locks = [schedule.period_lock[p] for p in self.periods]
        self.stints = self._stints()
        self.stints_by_pid: dict[int, list[_Stint]] = defaultdict(list)
        for s in self.stints:
            self.stints_by_pid[s.pid].append(s)

    # -- helpers ----------------------------------------------------------
    def day(self, period: int) -> date:
        return self.season_start + timedelta(days=period - 1)

    def player(self, pid: int) -> ActivityPlayer:
        return ActivityPlayer(player_id=pid, name=self.names.get(pid, f'Player {pid}'))

    def _first_period_at_or_after(self, ms: int) -> int:
        i = bisect_left(self.locks, ms)
        return self.periods[i] if i < len(self.periods) else self.latest + 1

    def _stints(self) -> list[_Stint]:
        events: dict[int, list[tuple[int, dict, dict]]] = defaultdict(list)
        for tx in self.txs:
            for item in tx.get('items') or []:
                if item.get('type') in ('DRAFT', 'ADD', 'DROP', 'TRADE'):
                    events[item['playerId']].append((_ms(tx), tx, item))
        stints: list[_Stint] = []
        for pid, evs in events.items():
            evs.sort(key=lambda e: e[0])
            current: Optional[_Stint] = None
            for ms, tx, item in evs:
                kind = item['type']
                if current is not None and kind in ('DROP', 'TRADE'):
                    current.left_at, current.left_by, current.left_kind = ms, tx, kind
                    stints.append(current)
                    current = None
                if kind in ('DRAFT', 'ADD', 'TRADE') and item.get('toTeamId'):
                    current = _Stint(pid=pid, team=item['toTeamId'], acquired_at=ms, acquired_by=tx['id'])
            if current is not None:
                stints.append(current)
        for s in stints:
            s.first_period = self._first_period_at_or_after(s.acquired_at)
            last_excl = self._first_period_at_or_after(s.left_at) if s.left_at is not None else self.latest + 1
            s.last_period = min(last_excl - 1, self.latest)
        return sorted(stints, key=lambda s: (s.pid, s.acquired_at))

    def _owns_game(self, s: _Stint, g: GameLine) -> bool:
        if self.lock_per_game and g.game_id in self.sched.game_start:
            lock = self.sched.game_start[g.game_id]
        else:
            lock = self.sched.period_lock.get(g.period)
        if lock is None:
            return s.first_period <= g.period <= s.last_period
        return s.acquired_at <= lock and (s.left_at is None or lock < s.left_at)

    def _games(self, s: _Stint) -> tuple[int, int, dict[str, float]]:
        totals: dict[str, float] = defaultdict(float)
        played = team_games = 0
        for g in self.logs.get(s.pid, []):
            if not self._owns_game(s, g):
                continue
            team_games += 1
            if g.box:
                played += 1
                for k, v in g.box.items():
                    totals[k] += v
        return played, team_games, totals

    def _trade_id(self, tx: dict) -> str:
        return tx.get('relatedTransactionId') or tx['id']

    def _next_stint(self, s: _Stint) -> Optional[_Stint]:
        later = [x for x in self.stints_by_pid[s.pid] if x.acquired_at > s.acquired_at]
        return later[0] if later else None

    def _value(self, s: _Stint, played: int, totals: dict[str, float]) -> Optional[StintValue]:
        # The same stint is modelled for the feed, its trade and the released list.
        if self.valuer is None:
            return None
        key = (s.pid, s.acquired_at)
        if key not in self._values:
            self._values[key] = self.valuer.value(s.first_period, s.last_period, played, totals)
        return self._values[key]

    def stint_model(self, s: _Stint, valued: bool = True) -> PlayerStint:
        played, team_games, totals = self._games(s)
        if s.left_kind == 'TRADE':
            exit_, exit_trade = 'traded', self._trade_id(s.left_by)
        elif s.left_kind == 'DROP':
            exit_, exit_trade = 'released', None
        else:
            exit_, exit_trade = ('season_end' if self.season_over else 'on_roster'), None
        picked_up = None
        if exit_ == 'released':
            nxt = self._next_stint(s)
            if nxt is not None and nxt.team != s.team:
                picked_up = PickedUpAfter(
                    team_id=nxt.team, date=self.day(nxt.first_period), games_played=self._games(nxt)[0],
                )
        start = s.first_period
        end = max(s.last_period, start - 1)
        return PlayerStint(
            player_id=s.pid,
            name=self.names.get(s.pid, f'Player {s.pid}'),
            team_id=s.team,
            start=self.day(start),
            # A stint that never reached a roster lock (traded or dropped the
            # same day) starts and ends on its first day with no days counted.
            end=self.day(max(end, start)),
            days=max(0, end - start + 1),
            games_played=played,
            team_games=team_games,
            totals={k: round(v, 1) for k, v in totals.items()},
            exit=exit_,
            exit_trade_id=exit_trade,
            picked_up_after=picked_up,
            value=self._value(s, played, totals) if valued else None,
        )

    # -- trades -------------------------------------------------------------
    def trades(self) -> list[Trade]:
        acquired_by = {(s.acquired_by, s.pid): s for s in self.stints}
        out = []
        for tx in sorted(self.txs, key=_ms):
            items = tx.get('items') or []
            moved = [i for i in items if i.get('type') == 'TRADE']
            if tx.get('type') != 'TRADE_ACCEPT' or not moved:
                continue
            teams = sorted({i['toTeamId'] for i in moved} | {i['fromTeamId'] for i in moved})
            sides = []
            for team in teams:
                received = [
                    self.stint_model(acquired_by[(tx['id'], i['playerId'])])
                    for i in moved if i['toTeamId'] == team and (tx['id'], i['playerId']) in acquired_by
                ]
                sides.append(TradeSide(team_id=team, received=sorted(received, key=lambda p: p.name)))
            out.append(Trade(
                id=self._trade_id(tx),
                date=self.day(self._first_period_at_or_after(_ms(tx))),
                accepted_at=_dt(_ms(tx)),
                sides=sides,
                released_for_trade=[self.player(i['playerId']) for i in items if i.get('type') == 'DROP'],
                open_roster_spot=self._open_spot(tx, sides),
            ))
        return out

    def _open_spot(self, trade_tx: dict, sides: list[TradeSide]) -> Optional[OpenRosterSpot]:
        counts = {s.team_id: len(s.received) for s in sides}
        if len(set(counts.values())) < 2:
            return None
        short = min(counts, key=counts.get)
        traded_at = _ms(trade_tx)
        window = OPEN_SPOT_WINDOW_DAYS * 86_400_000
        for tx in sorted(self.txs, key=_ms):
            items = tx.get('items') or []
            if (tx.get('type') not in ('FREEAGENT', 'WAIVER') or not items
                    or not all(i.get('type') == 'ADD' and i.get('toTeamId') == short for i in items)
                    or not traded_at <= _ms(tx) <= traded_at + window):
                continue
            stint = next((s for s in self.stints if s.acquired_by == tx['id']), None)
            if stint is not None:
                return OpenRosterSpot(team_id=short, added_on=_dt(_ms(tx)).date(), stint=self.stint_model(stint))
        return None

    # -- feed + released ---------------------------------------------------
    def moves(self, trades: list[Trade]) -> list[ActivityMove]:
        out = []
        for tx in self.txs:
            items = [i for i in tx.get('items') or [] if i.get('type') in ('ADD', 'DROP')]
            if not items or tx.get('type') not in ROSTER_TYPES + ('TRADE_ACCEPT',):
                continue
            adds = [i for i in items if i['type'] == 'ADD']
            drops = [i for i in items if i['type'] == 'DROP']
            if tx['type'] == 'TRADE_ACCEPT':
                kind = 'trade_drop'
            elif tx['type'] == 'WAIVER':
                kind = 'waiver'
            else:
                kind = 'add' if adds else 'drop'
            out.append(ActivityMove(
                id=tx['id'], kind=kind, at=_dt(_ms(tx)),
                team_id=adds[0]['toTeamId'] if adds else drops[0]['fromTeamId'],
                added=[self.player(i['playerId']) for i in adds],
                dropped=[self.player(i['playerId']) for i in drops],
            ))
        for t in trades:
            a, b = t.sides[0], t.sides[-1]
            out.append(ActivityMove(
                id=t.id, kind='trade', at=t.accepted_at, team_id=a.team_id, other_team_id=b.team_id, trade_id=t.id,
                added=[self.player(s.player_id) for s in a.received],
                dropped=[self.player(s.player_id) for s in b.received],
            ))
        out.sort(key=lambda m: m.at, reverse=True)
        return out

    def released(self) -> list[ReleasedPlayer]:
        best: dict[tuple[int, int], ReleasedPlayer] = {}
        for s in self.stints:
            if s.left_kind != 'DROP':
                continue
            nxt = self._next_stint(s)
            if nxt is None or nxt.team == s.team:
                continue
            stint = self.stint_model(nxt, valued=False)
            if stint.games_played < MIN_RELEASED_GAMES:
                continue
            key = (s.pid, s.team)
            if key not in best or stint.games_played > best[key].stint.games_played:
                best[key] = ReleasedPlayer(
                    player_id=s.pid, name=self.names.get(s.pid, f'Player {s.pid}'),
                    released_by=s.team, released_on=_dt(s.left_at).date(),
                    games_before_release=self._games(s)[0], stint=stint,
                )
        return sorted(best.values(), key=lambda r: (-r.stint.games_played, r.name))


def build_league_activity(
    *,
    season_id: int,
    transactions: list[dict],
    game_logs: dict[int, list[GameLine]],
    schedule: Schedule,
    season_start: date,
    teams: list[ActivityTeam],
    categories: list[str],
    latest_period: int,
    names: Optional[dict[int, str]] = None,
    season_over: bool = False,
    lock_per_game: bool = False,
    pool_logs: Optional[dict[int, list[GameLine]]] = None,
    reverse_categories: Optional[set[str]] = None,
    pending_trades: Optional[list[PendingTrade]] = None,
) -> LeagueActivity:
    valuer = StintValuer(pool_logs, categories, reverse_categories or set(), latest_period) if pool_logs else None
    b = _Builder(transactions, game_logs, schedule, season_start, names or {}, season_over, latest_period, lock_per_game, valuer)
    trades = b.trades()
    return LeagueActivity(
        season_id=season_id,
        season_over=season_over,
        latest_date=b.day(latest_period) if latest_period else None,
        categories=categories,
        teams=teams,
        moves=b.moves(trades),
        trades=trades,
        released=b.released(),
        pending_trades=pending_trades or [],
        last_updated=datetime.now(timezone.utc),
    )


# ---------------------------------------------------------------------------
# Fetching + caching
# ---------------------------------------------------------------------------

class _ActivityCache:
    """Process-wide. League settings and transactions refresh every
    CARDS_TTL_SECONDS, per-game stats every STATS_TTL_SECONDS, the schedule daily.
    Per-game stats are kept parsed: ESPN's raw stat cards are several times
    bigger and nothing else in them is read.

    A refresh is a conditional request: ESPN answers 304 with no body when the
    ETag still matches, so an unchanged source costs neither the download nor
    the JSON parse (the per-game stats alone are ~25 MB). The *_version
    counters move only when a source's content changed, so the built result is
    reused until something it depends on did."""

    def __init__(self):
        self.league: Optional[dict] = None
        self.cards: Optional[list[dict]] = None
        self.pool_ids: list[int] = []
        self.names: dict[int, str] = {}
        self.cards_at = 0.0
        self.stats: dict[int, list[GameLine]] = {}
        self.stats_at = 0.0
        self.schedule: Optional[dict] = None
        self.schedule_at = 0.0
        self.result: Optional[LeagueActivity] = None
        self.result_key: Optional[tuple] = None
        self.result_checked: Optional[tuple] = None
        # ESPN ETag per request (see LeagueActivityService._get's etag_key).
        self.etags: dict = {}
        self.cards_version = 0
        self.stats_version = 0
        self.schedule_version = 0
        self.lock = asyncio.Lock()

    def clear(self) -> None:
        self.__init__()


_cache = _ActivityCache()


class LeagueActivityService:
    def __init__(self, season_id: Optional[int] = None, league_id: Optional[int] = None):
        self.season_id = season_id or settings.season_id
        self.league_id = league_id or settings.league_id
        self.url = ESPN_LEAGUE_URL.format(season=self.season_id, league=self.league_id)
        self.season_url = ESPN_SEASON_URL.format(season=self.season_id)
        self._client: Optional[httpx.AsyncClient] = None

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(60.0, connect=10.0),
                limits=httpx.Limits(max_keepalive_connections=FETCH_CONCURRENCY, max_connections=FETCH_CONCURRENCY * 2),
                verify=shared_ssl_context(),
            )
        return self._client

    async def _get(
        self, params: list[tuple[str, str]], fantasy_filter: Optional[str] = None,
        url: Optional[str] = None, etag_key=None,
    ) -> Optional[dict]:
        """The parsed JSON. With ``etag_key`` the request is conditional on the
        ETag ESPN sent last time for that key, and None means 304: unchanged
        since then. The caller must still hold what it parsed from that response."""
        headers = {'x-fantasy-filter': fantasy_filter} if fantasy_filter else {}
        if etag_key is not None and etag_key in _cache.etags:
            headers['If-None-Match'] = _cache.etags[etag_key]
        for attempt in range(FETCH_RETRIES + 1):
            try:
                response = await self._http().get(url or self.url, params=params, headers=headers or None)
                break
            except httpx.TransportError:
                if attempt == FETCH_RETRIES:
                    raise
                await asyncio.sleep(0.5 * 2 ** attempt)
        if etag_key is not None and response.status_code == 304:
            return None
        response.raise_for_status()
        data = response.json()
        if etag_key is not None:
            if response.headers.get('etag'):
                _cache.etags[etag_key] = response.headers['etag']
            else:
                _cache.etags.pop(etag_key, None)
        return data

    async def _cards(self) -> Optional[tuple[list[dict], list[int], dict[int, str]]]:
        """Every player card with a transaction this season, the ids of the
        most-owned players (the valuation pool) and every card's name (a player
        in a pending trade may have no transaction yet), in one call. None: unchanged."""
        # The cards are read for their transactions, names and ownership order
        # only; a stat source no card has drops the stats, ~80% of the bytes.
        f = ('{"players":{"limit":%d,"sortPercOwned":{"sortPriority":1,"sortAsc":false},'
             '"filterStatsForSourceIds":{"value":[99]}}}' % CARD_LIMIT)
        data = await self._get([('view', 'kona_playercard')], f, etag_key='cards')
        if data is None:
            return None
        players = data.get('players', [])
        names = {c['id']: c['player']['fullName'] for c in players if (c.get('player') or {}).get('fullName')}
        return [c for c in players if c.get('transactions')], [c['id'] for c in players[:VALUE_POOL_SIZE]], names

    def _stats_filter(self, chunk: list[int]) -> str:
        """Per-game lines for ``chunk``. Asking for the season's scoring periods
        returns this season's games only; the top-200-periods filter it
        replaces returned each player's last 200 games across seasons, and the
        earlier seasons (which parse_game_logs drops) were ~95% of the bytes
        early in a season. Without league settings yet, the old filter."""
        status = (_cache.league or {}).get('status', {})
        last = max(status.get('finalScoringPeriod') or 0, status.get('latestScoringPeriod') or 0)
        if not last:
            return ('{"players":{"filterIds":{"value":%s},"filterStatsForTopScoringPeriodIds":'
                    '{"value":200,"additionalValue":["00%d"]}}}' % (chunk, self.season_id))
        return ('{"players":{"filterIds":{"value":%s},"filterStatsForScoringPeriodIds":{"value":%s}}}'
                % (chunk, list(range(1, last + 1))))

    async def _stat_cards(self, ids: list[int]) -> tuple[list[dict], bool]:
        """Stat cards for ``ids``, skipping batches ESPN reports unchanged (their
        players' parsed stats are already cached), and whether any batch changed."""
        sem = asyncio.Semaphore(FETCH_CONCURRENCY)

        async def batch(chunk: list[int]) -> Optional[list[dict]]:
            f = self._stats_filter(chunk)
            # Only a batch already parsed into _cache.stats may come back as 304.
            key = ('stats', tuple(chunk))
            if not all(i in _cache.stats for i in chunk):
                _cache.etags.pop(key, None)
            async with sem:
                data = await self._get([('view', 'kona_playercard')], f, etag_key=key)
            return None if data is None else data.get('players', [])

        chunks = [ids[i:i + STATS_BATCH] for i in range(0, len(ids), STATS_BATCH)]
        try:
            parts = await asyncio.gather(*(batch(c) for c in chunks))
        except BaseException:
            # The batches that did arrive are dropped with this error, so their
            # new ETags must not let the retry skip them.
            for c in chunks:
                _cache.etags.pop(('stats', tuple(c)), None)
            raise
        changed = [p for p in parts if p is not None]
        return [c for part in changed for c in part], bool(changed)

    async def _refresh(self) -> None:
        now = time.monotonic()
        if _cache.cards is None or now - _cache.cards_at >= CARDS_TTL_SECONDS:
            if _cache.league is None:
                _cache.etags.pop('league', None)
            league = await self._get(
                [('view', 'mSettings'), ('view', 'mTeam'), ('view', 'mPendingTransactions')], etag_key='league')
            if league is not None:
                _cache.league = league
                _cache.cards_version += 1
            if _cache.cards is None:
                _cache.etags.pop('cards', None)
            cards = await self._cards()
            if cards is not None:
                _cache.cards, _cache.pool_ids, _cache.names = cards
                _cache.cards_version += 1
            _cache.cards_at = now
        if _cache.schedule is None or now - _cache.schedule_at >= SCHEDULE_TTL_SECONDS:
            if _cache.schedule is None:
                _cache.etags.pop('schedule', None)
            schedule = await self._get([('view', 'proTeamSchedules_wl')], url=self.season_url, etag_key='schedule')
            if schedule is not None:
                _cache.schedule = schedule
                _cache.schedule_version += 1
            _cache.schedule_at = now
        ids = list(dict.fromkeys([c['id'] for c in _cache.cards] + _cache.pool_ids))
        missing = [i for i in ids if i not in _cache.stats]
        if now - _cache.stats_at >= STATS_TTL_SECONDS:
            missing, _cache.stats_at = ids, now
            # Batch boundaries move when the card list changes; drop the ETags
            # of batches this refresh no longer asks for, or they pile up.
            live = {('stats', tuple(ids[i:i + STATS_BATCH])) for i in range(0, len(ids), STATS_BATCH)}
            for key in [k for k in _cache.etags if isinstance(k, tuple) and k not in live]:
                del _cache.etags[key]
        if missing:
            cards, changed = await self._stat_cards(missing)
            _cache.stats.update(parse_game_logs(cards, self.season_id))
            # A player ESPN returns nothing for isn't asked for again until the next stats refresh.
            for i in missing:
                if i not in _cache.stats:
                    _cache.stats[i] = []
                    changed = True
            if changed:
                _cache.stats_version += 1

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def warm(self) -> None:
        """Startup prefetch; failures are logged and the next request retries."""
        try:
            await self.get_activity()
        except DataSourceError as e:
            logger.warning(f"League activity warm-up failed, will retry on first request: {e}")

    async def get_activity(self) -> LeagueActivity:
        async with _cache.lock:
            try:
                await self._refresh()
            except (httpx.HTTPError, ValueError) as e:
                logger.error(f"League activity: ESPN fetch failed: {type(e).__name__}: {e}")
                if _cache.result is not None:
                    return _cache.result
                raise DataSourceError("Error fetching league activity from ESPN API") from e

            result_key = (self.season_id, _cache.cards_version, _cache.stats_version, _cache.schedule_version)
            checked = (_cache.cards_at, _cache.stats_at, _cache.schedule_at)
            if _cache.result is not None and _cache.result_key == result_key:
                if _cache.result_checked != checked:
                    # ESPN confirmed nothing changed: same result, stamped with
                    # this check the way a rebuild would have been.
                    _cache.result = _cache.result.model_copy(update={'last_updated': datetime.now(timezone.utc)})
                    _cache.result_checked = checked
                return _cache.result

            league = _cache.league or {}
            status = league.get('status', {})
            first = status.get('firstScoringPeriod', 1) or 1
            latest = status.get('latestScoringPeriod') or league.get('scoringPeriodId') or first
            final = status.get('finalScoringPeriod') or latest
            roster_lock = ((league.get('settings') or {}).get('rosterSettings') or {}).get('rosterLocktimeType')
            transactions, names = merge_card_transactions(_cache.cards or [])
            ids = dict.fromkeys([c['id'] for c in _cache.cards or []] + _cache.pool_ids)
            logs = {i: _cache.stats[i] for i in ids if i in _cache.stats}
            transformer = DataTransformer()
            result = build_league_activity(
                season_id=self.season_id,
                transactions=transactions,
                game_logs=logs,
                schedule=parse_schedule(_cache.schedule or {}, first, min(latest, final)),
                season_start=settings.season_start,
                teams=parse_teams(league),
                categories=transformer.resolve_ranking_categories(league),
                latest_period=min(latest, final),
                names=names,
                season_over=latest > final,
                lock_per_game=roster_lock == 'INDIVIDUAL_GAME',
                pool_logs={i: logs[i] for i in _cache.pool_ids if i in logs},
                reverse_categories=transformer.resolve_reverse_categories(league),
                pending_trades=parse_pending_trades(league, {**_cache.names, **names}),
            )
            _cache.result, _cache.result_key, _cache.result_checked = result, result_key, checked
            logger.info(
                f"League activity built: {len(result.moves)} moves, {len(result.trades)} trades, "
                f"{len(result.pending_trades)} pending, "
                f"{len(_cache.cards or [])} players"
            )
            return result


_service: Optional[LeagueActivityService] = None


def get_league_activity_service() -> LeagueActivityService:
    """One instance, so its HTTP connection pool is shared across requests."""
    global _service
    if _service is None:
        _service = LeagueActivityService()
    return _service
