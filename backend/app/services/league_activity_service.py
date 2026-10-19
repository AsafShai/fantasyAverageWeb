"""League activity: every add, drop, waiver claim and trade, plus what each side
of a trade actually got.

ESPN's public API never returns the player list of an executed trade: the
TRADE_ACCEPT / TRADE_UPHOLD records carry no items and the TRADE_PROPOSAL they
point to is never served. So trades are rebuilt from daily roster snapshots
(view=mRoster per scoring period): a player who is on team A one day and team B
the next, without a DROP record in between, moved by trade. The accept record
dates the trade and names the players released to make room for it.

The same snapshots carry each rostered player's box score for that day
(statSplitTypeId 5), so one fetch per day gives both who owned a player and what
he did while owned. Past days never change, so they are fetched once per process.
"""
import asyncio
import logging
import time
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
    PickedUpAfter,
    PlayerStint,
    ReleasedPlayer,
    Trade,
    TradeSide,
)
from app.services.data_provider import DataProvider
from app.services.data_transformer import DataTransformer
from app.utils.espn_stat_map import STAT_ID_TO_CATEGORY
from app.utils.ssl_context import shared_ssl_context

logger = logging.getLogger(__name__)

ESPN_LEAGUE_URL = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{season}/segments/0/leagues/{league}'

# Raw box-score stats kept per game: every countable category a roto league
# might score, plus the makes/attempts the percentage categories are built from.
BOX_STAT_IDS = (0, 1, 2, 3, 4, 5, 6, 11, 13, 14, 15, 16, 17, 18)
MINUTES_STAT_ID = '40'
SINGLE_PERIOD_SPLIT = 5

# A DROP record can land a day or two before the roster change shows up in the
# snapshots (waivers process overnight), so look back this far for one.
DROP_LOOKBACK_PERIODS = 2
# Accept → roster change takes the league's review window (1–2 days here, but
# longer when owners vote); search this far ahead for the matching move.
TRADE_EXECUTION_WINDOW = 6
# How soon after an uneven trade a no-drop pickup counts as filling the spot.
OPEN_SPOT_WINDOW_DAYS = 3
# Released players are listed only when the new team got some real use out of them.
MIN_RELEASED_GAMES = 5

STATUS_TTL_SECONDS = 5 * 60
FETCH_CONCURRENCY = 6
FETCH_RETRIES = 2


# ---------------------------------------------------------------------------
# Parsing ESPN payloads into compact per-day snapshots
# ---------------------------------------------------------------------------

@dataclass
class DaySnapshot:
    """Who owned whom on one scoring period, and each rostered player's box line
    for it. box[pid] is {} when his NBA team played but he didn't (DNP/injured);
    a pid missing from box means his team had no game that day."""
    owners: dict[int, int] = field(default_factory=dict)
    names: dict[int, str] = field(default_factory=dict)
    box: dict[int, dict[str, float]] = field(default_factory=dict)


def parse_roster_snapshot(api_data: dict, period: int) -> DaySnapshot:
    snap = DaySnapshot()
    for team in api_data.get('teams', []):
        team_id = team.get('id')
        for entry in (team.get('roster') or {}).get('entries', []):
            pid = entry.get('playerId')
            player = (entry.get('playerPoolEntry') or {}).get('player') or {}
            if pid is None or team_id is None:
                continue
            snap.owners[pid] = team_id
            if player.get('fullName'):
                snap.names[pid] = player['fullName']
            for stat in player.get('stats') or []:
                if (stat.get('statSourceId') == 0
                        and stat.get('statSplitTypeId') == SINGLE_PERIOD_SPLIT
                        and stat.get('scoringPeriodId') == period):
                    raw = stat.get('stats') or {}
                    if float(raw.get(MINUTES_STAT_ID, 0) or 0) > 0:
                        snap.box[pid] = {
                            STAT_ID_TO_CATEGORY[sid]: float(raw.get(str(sid), 0) or 0)
                            for sid in BOX_STAT_IDS
                        }
                    else:
                        snap.box[pid] = {}
    return snap


def parse_teams(api_data: dict) -> list[ActivityTeam]:
    return sorted(
        (
            ActivityTeam(team_id=t['id'], name=t.get('name') or f"Team {t['id']}", abbrev=t.get('abbrev') or str(t['id']))
            for t in api_data.get('teams', []) if 'id' in t
        ),
        key=lambda t: t.team_id,
    )


# ---------------------------------------------------------------------------
# Building the activity view (pure; unit-tested against trimmed real data)
# ---------------------------------------------------------------------------

@dataclass
class _Stint:
    pid: int
    team: int
    start: int
    end: int = 0
    exit_to: Optional[int] = None  # 0 = released, team id = traded, None = still there


def _ms_to_dt(ms: Optional[int]) -> Optional[datetime]:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc) if ms else None


class _Builder:
    def __init__(
        self,
        snapshots: dict[int, DaySnapshot],
        transactions: list[dict],
        season_start: date,
        names: dict[int, str],
        season_over: bool,
    ):
        self.snaps = snapshots
        self.periods = sorted(snapshots)
        self.txs = transactions
        self.season_start = season_start
        self.season_over = season_over
        self.names = dict(names)
        for p in self.periods:
            self.names.update(snapshots[p].names)
        self.drops = self._drop_events()
        self.stints = self._stints()
        self.stints_by_pid: dict[int, list[_Stint]] = defaultdict(list)
        for s in self.stints:
            self.stints_by_pid[s.pid].append(s)
        self.executed_trade_ids: set[str] = set()

    # -- helpers ----------------------------------------------------------
    def day(self, period: int) -> date:
        return self.season_start + timedelta(days=period - 1)

    def player(self, pid: int) -> ActivityPlayer:
        return ActivityPlayer(player_id=pid, name=self.names.get(pid, f'Player {pid}'))

    def _executed(self, tx: dict) -> bool:
        # TRADE_ACCEPT records come back without a status; the roster diff is
        # what proves the trade went through, so they are judged there instead.
        return tx.get('status') == 'EXECUTED' or tx.get('type') == 'TRADE_ACCEPT'

    def _drop_events(self) -> set[tuple[int, int, int]]:
        return {
            (item['playerId'], item['fromTeamId'], tx.get('scoringPeriodId', 0))
            for tx in self.txs if self._executed(tx)
            for item in tx.get('items') or [] if item.get('type') == 'DROP'
        }

    def _is_drop(self, pid: int, team: int, period: int) -> bool:
        return any((pid, team, q) in self.drops for q in range(period - DROP_LOOKBACK_PERIODS, period + 1))

    def _stints(self) -> list[_Stint]:
        open_: dict[int, _Stint] = {}
        done: list[_Stint] = []
        prev: dict[int, int] = {}
        for p in self.periods:
            owners = self.snaps[p].owners
            for pid in set(prev) | set(owners):
                team = owners.get(pid, 0)
                cur = open_.get(pid)
                if cur and cur.team != team:
                    cur.end = p - 1
                    cur.exit_to = 0 if (team == 0 or self._is_drop(pid, cur.team, p)) else team
                    done.append(open_.pop(pid))
                if team and pid not in open_:
                    open_[pid] = _Stint(pid=pid, team=team, start=p)
            prev = owners
        last = self.periods[-1] if self.periods else 0
        for s in open_.values():
            s.end = last
            done.append(s)
        return sorted(done, key=lambda s: (s.pid, s.start))

    def stint_model(self, s: _Stint, exit_trade_id: Optional[str] = None) -> PlayerStint:
        totals: dict[str, float] = defaultdict(float)
        games = team_games = 0
        for p in range(s.start, s.end + 1):
            snap = self.snaps.get(p)
            if snap is None or s.pid not in snap.box:
                continue
            team_games += 1
            line = snap.box[s.pid]
            if line:
                games += 1
                for k, v in line.items():
                    totals[k] += v
        if s.exit_to is None:
            exit_ = 'season_end' if self.season_over else 'on_roster'
        elif s.exit_to == 0:
            exit_ = 'released'
        else:
            exit_ = 'traded'
        picked_up = None
        if exit_ == 'released':
            nxt = self._next_stint(s)
            if nxt is not None and nxt.team != s.team:
                picked_up = PickedUpAfter(team_id=nxt.team, date=self.day(nxt.start), games_played=self._games(nxt))
        return PlayerStint(
            player_id=s.pid,
            name=self.names.get(s.pid, f'Player {s.pid}'),
            team_id=s.team,
            start=self.day(s.start),
            end=self.day(s.end),
            days=s.end - s.start + 1,
            games_played=games,
            team_games=team_games,
            totals={k: round(v, 1) for k, v in totals.items()},
            exit=exit_,
            exit_trade_id=exit_trade_id,
            picked_up_after=picked_up,
        )

    def _games(self, s: _Stint) -> int:
        return sum(1 for p in range(s.start, s.end + 1) if self.snaps.get(p) and self.snaps[p].box.get(s.pid))

    def _next_stint(self, s: _Stint) -> Optional[_Stint]:
        later = [x for x in self.stints_by_pid[s.pid] if x.start > s.end]
        return later[0] if later else None

    def _stint_starting(self, pid: int, team: int, period: int) -> Optional[_Stint]:
        return next((s for s in self.stints_by_pid[pid] if s.team == team and s.start == period), None)

    # -- trades -------------------------------------------------------------
    def trades(self) -> list[dict]:
        moves: dict[tuple[int, frozenset], list[tuple[int, int, int]]] = defaultdict(list)
        for i in range(1, len(self.periods)):
            p, q = self.periods[i - 1], self.periods[i]
            a, b = self.snaps[p].owners, self.snaps[q].owners
            for pid in set(a) & set(b):
                fa, fb = a[pid], b[pid]
                if fa != fb and not self._is_drop(pid, fa, q):
                    moves[(q, frozenset((fa, fb)))].append((pid, fa, fb))

        # An accept that drew a veto (including the accepting owner withdrawing
        # it) usually never executed, so accepts without one claim roster moves
        # first; a vetoed accept only explains a move nothing else does.
        vetoed = {tx.get('relatedTransactionId') for tx in self.txs if tx.get('type') == 'TRADE_VETO'}
        accepts = sorted(
            (tx for tx in self.txs
             if tx.get('type') == 'TRADE_ACCEPT' and tx.get('scoringPeriodId', 0) > 0),
            key=lambda tx: (tx.get('relatedTransactionId') in vetoed, tx.get('proposedDate', 0)),
        )
        used: set = set()
        trades = []
        for acc in accepts:
            team, pa = acc.get('teamId'), acc['scoringPeriodId']
            cands = [k for k in moves if k not in used and team in k[1] and pa <= k[0] <= pa + TRADE_EXECUTION_WINDOW]
            if not cands:
                continue  # vetoed or otherwise never executed
            # The accept names only its own team, so when that team accepted two
            # trades in the same window, prefer the move whose extra incoming
            # players match the releases the accept made room with.
            released = sum(1 for i in acc.get('items') or [] if i.get('type') == 'DROP')

            def fit(k: tuple[int, frozenset]) -> tuple[int, int]:
                net_in = sum(1 if to == team else -1 for _, _, to in moves[k])
                return k[0], abs(net_in - released)

            key = min(cands, key=fit)
            used.add(key)
            self.executed_trade_ids.add(acc.get('relatedTransactionId') or acc['id'])
            trades.append({
                'id': acc.get('relatedTransactionId') or acc['id'],
                'period': key[0], 'teams': sorted(key[1]), 'moves': moves[key],
                'accepted_at': _ms_to_dt(acc.get('proposedDate')),
                'released': [i['playerId'] for i in acc.get('items') or [] if i.get('type') == 'DROP'],
            })
        for key, mv in moves.items():
            if key not in used:
                a, b = sorted(key[1])
                trades.append({'id': f'{key[0]}-{a}-{b}', 'period': key[0], 'teams': [a, b], 'moves': mv,
                               'accepted_at': None, 'released': []})
        trades.sort(key=lambda t: (t['period'], t['teams']))
        return trades

    def trade_models(self, raw: list[dict]) -> list[Trade]:
        by_move = {(pid, t['period']): t['id'] for t in raw for pid, _, _ in t['moves']}
        out = []
        for t in raw:
            sides = []
            for team in t['teams']:
                received = []
                for pid, _, to in sorted(t['moves'], key=lambda m: self.names.get(m[0], '')):
                    if to != team:
                        continue
                    s = self._stint_starting(pid, team, t['period'])
                    if s is None:
                        continue
                    exit_id = by_move.get((pid, s.end + 1)) if s.exit_to else None
                    received.append(self.stint_model(s, exit_id))
                sides.append(TradeSide(team_id=team, received=received))
            out.append(Trade(
                id=t['id'],
                date=self.day(t['period']),
                accepted_at=t['accepted_at'],
                sides=sides,
                released_for_trade=[self.player(pid) for pid in t['released']],
                open_roster_spot=self._open_spot(t, sides),
            ))
        return out

    def _open_spot(self, t: dict, sides: list[TradeSide]) -> Optional[OpenRosterSpot]:
        counts = {s.team_id: len(s.received) for s in sides}
        if len(set(counts.values())) < 2:
            return None
        short = min(counts, key=counts.get)
        trade_day = self.day(t['period'])
        pickups = sorted(
            (tx for tx in self.txs
             if tx.get('status') == 'EXECUTED' and tx.get('type') in ('FREEAGENT', 'WAIVER')
             and all(i.get('type') == 'ADD' for i in tx.get('items') or [])
             and any(i.get('toTeamId') == short for i in tx.get('items') or [])),
            key=lambda tx: tx.get('processDate') or tx.get('proposedDate') or 0,
        )
        for tx in pickups:
            when = _ms_to_dt(tx.get('processDate') or tx.get('proposedDate'))
            if when is None or not 0 <= (when.date() - trade_day).days <= OPEN_SPOT_WINDOW_DAYS:
                continue
            pid = tx['items'][0]['playerId']
            stint = next((s for s in self.stints_by_pid[pid]
                          if s.team == short and 0 <= s.start - t['period'] <= OPEN_SPOT_WINDOW_DAYS + 1), None)
            if stint:
                return OpenRosterSpot(team_id=short, added_on=when.date(), stint=self.stint_model(stint))
        return None

    # -- feed + released ---------------------------------------------------
    def moves(self, trades: list[Trade]) -> list[ActivityMove]:
        out = []
        for tx in self.txs:
            kind_type = tx.get('type')
            items = [i for i in tx.get('items') or [] if i.get('type') in ('ADD', 'DROP')]
            if not items or not self._executed(tx) or kind_type not in ('FREEAGENT', 'WAIVER', 'ROSTER', 'TRADE_ACCEPT'):
                continue
            adds = [i for i in items if i['type'] == 'ADD']
            drops = [i for i in items if i['type'] == 'DROP']
            if kind_type == 'TRADE_ACCEPT':
                if (tx.get('relatedTransactionId') or tx['id']) not in self.executed_trade_ids:
                    continue  # vetoed: its roster-room drops never happened
                kind = 'trade_drop'
            elif kind_type == 'WAIVER':
                kind = 'waiver'
            else:
                kind = 'add' if adds else 'drop'
            team = adds[0]['toTeamId'] if adds else drops[0]['fromTeamId']
            at = _ms_to_dt(tx.get('processDate') or tx.get('proposedDate'))
            if at is None:
                continue
            out.append(ActivityMove(
                id=tx['id'], kind=kind, at=at, team_id=team,
                added=[self.player(i['playerId']) for i in adds],
                dropped=[self.player(i['playerId']) for i in drops],
            ))
        for t in trades:
            a, b = t.sides
            out.append(ActivityMove(
                id=t.id, kind='trade',
                at=t.accepted_at or datetime.combine(t.date, datetime.min.time(), tzinfo=timezone.utc),
                team_id=a.team_id, other_team_id=b.team_id, trade_id=t.id,
                added=[self.player(s.player_id) for s in a.received],
                dropped=[self.player(s.player_id) for s in b.received],
            ))
        out.sort(key=lambda m: m.at, reverse=True)
        return out

    def released(self) -> list[ReleasedPlayer]:
        best: dict[tuple[int, int], ReleasedPlayer] = {}
        for s in self.stints:
            if s.exit_to != 0:
                continue
            nxt = self._next_stint(s)
            if nxt is None or nxt.team == s.team:
                continue
            stint = self.stint_model(nxt)
            if stint.games_played < MIN_RELEASED_GAMES:
                continue
            key = (s.pid, s.team)
            if key not in best or stint.games_played > best[key].stint.games_played:
                best[key] = ReleasedPlayer(
                    player_id=s.pid, name=self.names.get(s.pid, f'Player {s.pid}'),
                    released_by=s.team, released_on=self.day(s.end + 1),
                    games_before_release=self._games(s), stint=stint,
                )
        return sorted(best.values(), key=lambda r: (-r.stint.games_played, r.name))


def build_league_activity(
    *,
    season_id: int,
    snapshots: dict[int, DaySnapshot],
    transactions: list[dict],
    season_start: date,
    teams: list[ActivityTeam],
    categories: list[str],
    names: Optional[dict[int, str]] = None,
    season_over: bool = False,
) -> LeagueActivity:
    b = _Builder(snapshots, transactions, season_start, names or {}, season_over)
    trades = b.trade_models(b.trades())
    last = b.periods[-1] if b.periods else None
    return LeagueActivity(
        season_id=season_id,
        season_over=season_over,
        latest_date=b.day(last) if last else None,
        categories=categories,
        teams=teams,
        moves=b.moves(trades),
        trades=trades,
        released=b.released(),
        last_updated=datetime.now(timezone.utc),
    )


# ---------------------------------------------------------------------------
# Fetching + caching
# ---------------------------------------------------------------------------

class _ActivityCache:
    """Process-wide. Days before the latest scoring period are immutable, so their
    snapshots and transactions are kept for the life of the process; the latest
    day is re-fetched whenever the league status is (every STATUS_TTL_SECONDS)."""

    def __init__(self):
        self.snapshots: dict[tuple[int, int], DaySnapshot] = {}
        self.transactions: dict[tuple[int, int], list[dict]] = {}
        self.status: Optional[dict] = None
        self.status_at = 0.0
        self.result: Optional[LeagueActivity] = None
        self.result_key: Optional[tuple] = None
        self.lock = asyncio.Lock()

    def clear(self) -> None:
        self.__init__()


_cache = _ActivityCache()


class LeagueActivityService:
    def __init__(self, season_id: Optional[int] = None, league_id: Optional[int] = None):
        self.season_id = season_id or settings.season_id
        self.league_id = league_id or settings.league_id
        self.url = ESPN_LEAGUE_URL.format(season=self.season_id, league=self.league_id)
        self._client: Optional[httpx.AsyncClient] = None

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(30.0, connect=10.0),
                limits=httpx.Limits(max_keepalive_connections=FETCH_CONCURRENCY, max_connections=FETCH_CONCURRENCY * 2),
                verify=shared_ssl_context(),
            )
        return self._client

    async def _get(self, params: list[tuple[str, str]]) -> dict:
        # A cold build is a few hundred requests; one dropped connection
        # shouldn't sink it, so transport errors get a couple of retries.
        for attempt in range(FETCH_RETRIES + 1):
            try:
                response = await self._http().get(self.url, params=params)
                break
            except httpx.TransportError:
                if attempt == FETCH_RETRIES:
                    raise
                await asyncio.sleep(0.5 * 2 ** attempt)
        response.raise_for_status()
        return response.json()

    async def _status(self) -> dict:
        if _cache.status is not None and time.monotonic() - _cache.status_at < STATUS_TTL_SECONDS:
            return _cache.status
        _cache.status = await self._get([('view', 'mSettings'), ('view', 'mTeam')])
        _cache.status_at = time.monotonic()
        return _cache.status

    async def _fetch_day(self, period: int, refresh: bool) -> None:
        key = (self.season_id, period)
        if refresh or key not in _cache.snapshots:
            data = await self._get([('view', 'mRoster'), ('scoringPeriodId', str(period))])
            _cache.snapshots[key] = parse_roster_snapshot(data, period)
        if refresh or key not in _cache.transactions:
            # Without scoringPeriodId ESPN returns only the current day's
            # transactions for a finished season, so every day is asked for.
            data = await self._get([('view', 'mTransactions2'), ('scoringPeriodId', str(period))])
            _cache.transactions[key] = data.get('transactions', [])

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
                status_data = await self._status()
                status = status_data.get('status', {})
                first = status.get('firstScoringPeriod', 1) or 1
                latest = status.get('latestScoringPeriod') or status_data.get('scoringPeriodId') or first
                final = status.get('finalScoringPeriod') or latest
                result_key = (self.season_id, latest, _cache.status_at)
                if _cache.result is not None and _cache.result_key == result_key:
                    return _cache.result

                sem = asyncio.Semaphore(FETCH_CONCURRENCY)

                async def fetch(p: int) -> None:
                    async with sem:
                        await self._fetch_day(p, refresh=(p == latest))

                await asyncio.gather(*(fetch(p) for p in range(first, latest + 1)))
            except (httpx.HTTPError, ValueError) as e:
                logger.error(f"League activity: ESPN fetch failed: {type(e).__name__}: {e}")
                if _cache.result is not None:
                    return _cache.result
                raise DataSourceError("Error fetching league activity from ESPN API") from e

            try:
                names = await DataProvider().get_players_directory()
            except Exception as e:  # names only fill gaps the snapshots leave
                logger.warning(f"League activity: players directory unavailable: {type(e).__name__}: {e}")
                names = {}
            snapshots = {p: _cache.snapshots[(self.season_id, p)] for p in range(first, latest + 1)}
            transactions = [tx for p in range(first, latest + 1) for tx in _cache.transactions[(self.season_id, p)]]
            # The same transaction can be returned for more than one day.
            transactions = list({tx['id']: tx for tx in transactions if 'id' in tx}.values())
            result = build_league_activity(
                season_id=self.season_id,
                snapshots=snapshots,
                transactions=transactions,
                season_start=settings.season_start,
                teams=parse_teams(status_data),
                categories=DataTransformer().resolve_ranking_categories(status_data),
                names=names,
                season_over=latest > final,
            )
            _cache.result, _cache.result_key = result, result_key
            logger.info(
                f"League activity built: {len(result.moves)} moves, {len(result.trades)} trades "
                f"over scoring periods {first}-{latest}"
            )
            return result


_service: Optional[LeagueActivityService] = None


def get_league_activity_service() -> LeagueActivityService:
    """One instance, so its HTTP connection pool is shared across requests."""
    global _service
    if _service is None:
        _service = LeagueActivityService()
    return _service
