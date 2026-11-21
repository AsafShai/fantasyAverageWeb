import asyncio
import logging
import time
from datetime import date
from typing import Any, Optional

from app.config import settings
from app.models import NightlyRun, RankChanges, RankMover, TeamRosterHealth, TodayHub, with_live
from app.services.data_provider import DataProvider
from app.services.db_service import DBService
from app.services.nba_matchup_service import get_shared_matchup_service
from app.services.rank_moves import changes_between, movers_between
from app.services import tonight_changes
from app.utils import category_storage
from app.utils.category_storage import TOTAL_KEY
from app.utils.name_matching import normalize_player_name

logger = logging.getLogger(__name__)

_RANK_COLUMNS = {
    'FG%': 'rk_fg_pct',
    'FT%': 'rk_ft_pct',
    '3PM': 'rk_three_pm',
    'REB': 'rk_reb',
    'AST': 'rk_ast',
    'STL': 'rk_stl',
    'BLK': 'rk_blk',
    'PTS': 'rk_pts',
}

# team_daily_snapshot columns of the counting stats (the percentages are ratios).
_STAT_COLUMNS = {
    '3PM': 'three_pm',
    'REB': 'reb',
    'AST': 'ast',
    'STL': 'stl',
    'BLK': 'blk',
    'PTS': 'pts',
}

AVAILABLE = 'available'
PROBABLE = 'probable'
QUESTIONABLE = 'questionable'
DOUBTFUL = 'doubtful'
OUT = 'out'

STATUS_BUCKETS = (AVAILABLE, PROBABLE, QUESTIONABLE, DOUBTFUL, OUT)

# "Game Time Decision" is the NBA report's own wording for Questionable.
_STATUS_ALIASES = {'game time decision': QUESTIONABLE, 'gtd': QUESTIONABLE}

_CACHE_TTL_S = 300
# 'inputs' = (players_df, teams playing) the cached roster_health was built from,
# kept so an injury report can recount just that panel.
_hub_cache: dict[str, Any] = {'ts': None, 'value': None, 'inputs': None}
# Bumped on every injury-report change so a hub composed across a report (from
# the pre-report injury store) is never cached.
_injury_generation = 0


# Results of the hub's and the Rankings table's DB reads, one entry per query.
# The tables they read change once a day (the standings sync, the nightly
# run), and each read wakes the scale-to-zero database for at least five
# minutes, so page views reuse them until a write bumps
# DataProvider.rankings_writes, the nightly clears them, or an hour passes.
_DB_READ_TTL_S = 3600
_db_reads: dict[Any, tuple[float, int, Any]] = {}


def _rankings_writes() -> int:
    return getattr(DataProvider(), 'rankings_writes', 0)


async def _cached_db_read(key, read, keep=bool):
    """read()'s result, reused while fresh. A result ``keep`` rejects is not
    stored: the DB helpers return an empty value on failure, and that must not
    stick for an hour."""
    writes = _rankings_writes()
    hit = _db_reads.get(key)
    if hit is not None and hit[1] == writes and time.monotonic() - hit[0] < _DB_READ_TTL_S:
        return hit[2]
    value = await read()
    if keep(value):
        _db_reads[key] = (time.monotonic(), writes, value)
    return value


def clear_today_hub_cache() -> None:
    _hub_cache.update({'ts': None, 'value': None, 'inputs': None})
    _db_reads.clear()


def refresh_roster_health() -> None:
    """Recount the cached hub's roster health from the current injury store after
    an injury report changed it. Only roster_health changes and the hub keeps its
    age; the other panels follow the normal cache rules."""
    global _injury_generation
    _injury_generation += 1
    hub, inputs = _hub_cache.get('value'), _hub_cache.get('inputs')
    if hub is None or inputs is None:
        return
    players_df, teams_playing = inputs
    health = TodayService.build_roster_health(players_df, teams_playing, TodayService._injury_lookup())
    _hub_cache['value'] = hub.model_copy(update={'roster_health': health})


def classify_status(status: str) -> str:
    """One of the five report statuses, never a collapsed bucket.

    An unrecognized label lands in Questionable and is logged by name: a new
    ESPN/NBA wording should surface in the logs rather than disappear into
    Available."""
    normalized = status.strip().lower()
    if normalized in STATUS_BUCKETS:
        return normalized
    alias = _STATUS_ALIASES.get(normalized)
    if alias is not None:
        return alias
    logger.warning(f'Unknown injury status {status!r} - counted as questionable')
    return QUESTIONABLE


class TodayService:
    """Composes the Dashboard's "what changed since yesterday" hub.

    Every part is fail-open: a source that raises contributes its empty value
    rather than failing the whole hub, because the three panels are unrelated
    and a dead injury feed should not hide the rank movers."""

    def __init__(self) -> None:
        self._tonight_inputs = None
        self.db_service = DBService()
        self.data_provider = DataProvider()
        self.matchup_service = get_shared_matchup_service()

    async def get_today_hub(self) -> TodayHub:
        """The hub, plus tonight's movers and the ``live`` block while
        LIVE_STANDINGS_ENABLED is on. Tonight is added after the 5-minute hub
        cache: it moves with every game that goes final."""
        hub = await self._composed_hub()
        provider = DataProvider()
        try:
            state = await provider.get_live_state(include_finals=True)
        except Exception as e:
            logger.warning(f'Today hub live state failed, serving official: {type(e).__name__}: {e}')
            return hub
        if state is not None and state.active:
            movers = await tonight_changes.tonight_movers(provider)
            if movers is None:
                return hub
            hub = hub.model_copy(update={'tonight_movers': movers})
        return with_live(hub, state)

    async def _composed_hub(self) -> TodayHub:
        cached_ts = _hub_cache.get('ts')
        if cached_ts is not None and time.monotonic() - cached_ts < _CACHE_TTL_S:
            return _hub_cache['value']

        injury_generation = _injury_generation
        self._tonight_inputs = None
        movers, tonight, nightly = await asyncio.gather(
            self._safe('movers', self._get_movers(), []),
            self._safe('tonight', self._get_tonight(), (None, 0, [])),
            self._safe('last_nightly', self._get_last_nightly(), None),
        )
        slate_date, games_count, roster_health = tonight

        hub = TodayHub(
            slate_date=slate_date,
            games_count=games_count,
            movers=movers,
            roster_health=roster_health,
            last_nightly=nightly,
        )
        if injury_generation == _injury_generation:
            _hub_cache.update({'ts': time.monotonic(), 'value': hub, 'inputs': self._tonight_inputs})
        return hub

    @staticmethod
    async def _safe(part, coro, fallback):
        try:
            return await coro
        except Exception as e:
            logger.warning(f'Today hub part {part!r} failed, serving empty: {type(e).__name__}: {e}', exc_info=True)
            return fallback

    async def _get_movers(self) -> list[RankMover]:
        rows = await _cached_db_read(
            ('two_periods', 'team_rankings_averages'),
            lambda: self.db_service.get_latest_two_periods_rankings(settings.league_id, settings.season_id),
        )
        return self.build_movers(rows)

    @staticmethod
    def build_movers(rows: list[dict]) -> list[RankMover]:
        """rk_* columns hold roto POINTS (higher is better), not places, so a
        positive delta is always an improvement — including rk_total, which is
        the points sum."""
        periods = sorted({int(r['scoring_period_id']) for r in rows})
        if len(periods) < 2:
            return []
        previous_period, latest_period = periods[-2], periods[-1]

        by_period: dict[int, dict[int, dict]] = {previous_period: {}, latest_period: {}}
        names: dict[int, str] = {}
        for row in rows:
            period = int(row['scoring_period_id'])
            if period not in by_period:
                continue
            team_id = int(row['team_id'])
            by_period[period][team_id] = TodayService._categories_of(row)
            names[team_id] = str(row['team_name'])

        return movers_between(by_period[previous_period], by_period[latest_period], names)

    async def get_rank_changes(self, mode: str = 'averages', settled: bool = False) -> RankChanges:
        """Each team's move in places, roto points and games played, for the
        Rankings table: between the two latest stored scoring periods, or,
        while tonight is live, tonight against this morning's official
        standings (plan decision 7). With LIVE_STANDINGS_ENABLED off the
        response is exactly as before. ``settled`` is the daily recap's: the
        moves of the night the nightly job recorded (_settled_rank_changes)."""
        if settled:
            return await self._settled_rank_changes(mode)
        provider = DataProvider()
        state = await provider.get_live_state(include_finals=True)
        if state is not None and state.active:
            tonight = await tonight_changes.tonight_rank_changes(provider, mode, state.period)
            if tonight is not None:
                return with_live(tonight, state)
            # Labelled "tonight" by the block, so no block on last night's moves.
            return await self._stored_rank_changes(mode)
        return with_live(await self._stored_rank_changes(mode), state)

    async def _settled_rank_changes(self, mode: str) -> RankChanges:
        """The moves of the newest night in the nightly ledger: the daily
        recap's night, never a slate in progress.

        Stored periods once ESPN has rolled that night over. Before then the
        stored periods end the night before, so while the live overlay is that
        night with every game final, its moves come from it (official
        standings through the night before against the same plus the night);
        and in the minutes after the rollover, before anything wrote the new
        snapshot, the snapshot is synced first. Failing both it is the stored
        periods, as before."""
        provider = DataProvider()
        night = None
        try:
            run = await self._latest_nightly_run()
            night = run.get('game_date') if run else None
            if isinstance(night, str):
                night = date.fromisoformat(night)
        except Exception as e:
            logger.warning(f"Settled rank changes: nightly ledger unavailable: {type(e).__name__}: {e}")
        if night is not None:
            state = await provider.get_live_state(include_finals=True)
            if tonight_changes.is_finished_night(state, night):
                moves = await tonight_changes.tonight_rank_changes(provider, mode, state.period)
                if moves is not None:
                    return moves
        changes = await self._stored_rank_changes(mode)
        if night is not None and (changes.latest_period or 0) < tonight_changes.period_of(night):
            if await provider.sync_db_now():
                changes = await self._stored_rank_changes(mode)
        return changes

    async def _latest_nightly_run(self) -> Optional[dict]:
        return await _cached_db_read('nightly_run', self.db_service.get_latest_model_nightly_run)

    async def _stored_rank_changes(self, mode: str) -> RankChanges:
        return await _cached_db_read(
            ('rank_changes', mode), lambda: self._read_rank_changes(mode),
            keep=lambda changes: changes.latest_period is not None,
        )

    async def _read_rank_changes(self, mode: str) -> RankChanges:
        table = 'team_rankings_totals' if mode == 'totals' else 'team_rankings_averages'
        rows = await self.db_service.get_latest_two_periods_rankings(
            settings.league_id, settings.season_id, table
        )
        periods = sorted({int(r['scoring_period_id']) for r in rows})
        snapshot_rows = await self.db_service.get_team_snapshots_for_periods(
            periods, settings.league_id, settings.season_id
        )
        return self.build_rank_changes(rows, snapshot_rows, with_stats=mode == 'totals')

    @staticmethod
    def build_rank_changes(rows: list[dict], snapshot_rows: list[dict],
                           with_stats: bool = False) -> RankChanges:
        """rows: rankings rows of the two latest periods (rk_* are roto points);
        snapshot_rows: team_daily_snapshot rows of the same periods (games
        played, and with ``with_stats`` the raw totals the counting stats
        added are diffed from). Places are standard competition ranks by
        total points, so a tie shares the higher place."""
        periods = sorted({int(r['scoring_period_id']) for r in rows})
        if len(periods) < 2:
            return RankChanges()
        previous_period, latest_period = periods[-2], periods[-1]

        by_period: dict[int, dict[int, dict]] = {previous_period: {}, latest_period: {}}
        names: dict[int, str] = {}
        for row in rows:
            period = int(row['scoring_period_id'])
            if period not in by_period:
                continue
            team_id = int(row['team_id'])
            by_period[period][team_id] = TodayService._categories_of(row)
            names[team_id] = str(row['team_name'])

        gp: dict[int, dict[int, int]] = {previous_period: {}, latest_period: {}}
        stats: dict[int, dict[int, dict[str, float]]] = {previous_period: {}, latest_period: {}}
        for r in snapshot_rows:
            period = int(r['scoring_period_id'])
            if period not in gp:
                continue
            team_id = int(r['team_id'])
            if r.get('gp') is not None:
                gp[period][team_id] = int(r['gp'])
            if with_stats:
                scored = by_period[period].get(team_id, {})
                stats[period][team_id] = {
                    cat: value for cat, value in TodayService._stats_of(r).items() if cat in scored
                }

        teams = changes_between(
            by_period[previous_period], by_period[latest_period], names,
            gp[previous_period], gp[latest_period],
            stats[previous_period] if with_stats else None,
            stats[latest_period] if with_stats else None,
        )
        return RankChanges(previous_period=previous_period, latest_period=latest_period, teams=teams)

    @staticmethod
    def _categories_of(row: dict) -> dict[str, Optional[float]]:
        fixed = {cat: row.get(col) for cat, col in _RANK_COLUMNS.items()}
        stored = category_storage.loads(row.get('ranks'))
        total = row.get('rk_total')
        if stored:
            total = stored.pop(TOTAL_KEY, total)
            fixed = category_storage.merge_categories(fixed, stored)
        merged: dict[str, Optional[float]] = {
            cat: (None if value is None else float(value)) for cat, value in fixed.items()
        }
        merged[TOTAL_KEY] = None if total is None else float(total)
        return merged

    @staticmethod
    def _stats_of(row: dict) -> dict[str, float]:
        """Raw season totals of a team_daily_snapshot row, by category."""
        fixed = {cat: row.get(col) for cat, col in _STAT_COLUMNS.items()}
        merged = category_storage.merge_categories(fixed, row.get('stats'))
        return {cat: float(value) for cat, value in merged.items() if value is not None}

    async def _get_tonight(self) -> tuple[Optional[date], int, list[TeamRosterHealth]]:
        games, players_df = await asyncio.gather(
            self.matchup_service.get_games_today(),
            self.data_provider.get_players_df(0),
        )
        resolved = self.matchup_service.get_schedule_date()
        slate_date = date.fromisoformat(resolved) if resolved else None
        injuries = self._injury_lookup()
        teams_playing = set(games.keys())
        health = self.build_roster_health(players_df, teams_playing, injuries)
        self._tonight_inputs = (players_df, teams_playing)
        # `games` is keyed per team (both sides of each matchup), so halve it.
        return slate_date, len(games) // 2, health

    @staticmethod
    def _injury_lookup() -> dict[str, str]:
        from app.services.injury_service import injury_store

        return {
            normalize_player_name(record.player): classify_status(record.status)
            for record in injury_store.values()
        }

    @staticmethod
    def build_roster_health(
        players_df, teams_playing: set[str], injuries: dict[str, str]
    ) -> list[TeamRosterHealth]:
        """Every fantasy team gets a row, every night — including a team with
        nobody on tonight's slate, which rows out at all zeros rather than
        vanishing. Counts themselves are still only over rostered players who
        have a game tonight; a player whose NBA team is idle is in no column
        at all, so the five counts sum to games_tonight."""
        if players_df is None or players_df.is_empty():
            return []

        accumulators: dict[int, dict] = {}
        for row in players_df.iter_rows(named=True):
            fantasy_name = row.get('fantasy_team_name')
            team_id = row.get('team_id')
            if not fantasy_name or team_id is None or int(team_id) <= 0:
                continue

            entry = accumulators.setdefault(int(team_id), {
                'team_name': str(fantasy_name),
                'available_tonight': 0, 'probable': 0,
                'questionable': 0, 'doubtful': 0, 'out': 0,
            })

            if str(row.get('Pro Team', '')) not in teams_playing:
                continue

            bucket = injuries.get(normalize_player_name(str(row.get('Name', ''))), AVAILABLE)
            entry['available_tonight' if bucket == AVAILABLE else bucket] += 1

        health = [
            TeamRosterHealth(
                team_id=team_id,
                games_tonight=(
                    entry['available_tonight'] + entry['probable']
                    + entry['questionable'] + entry['doubtful'] + entry['out']
                ),
                **entry,
            )
            for team_id, entry in accumulators.items()
        ]
        health.sort(key=lambda t: (-t.out, -t.doubtful, -t.questionable, t.team_name))
        return health

    async def _get_last_nightly(self) -> Optional[NightlyRun]:
        run = await self._latest_nightly_run()
        if not run or run.get('game_date') is None:
            return None
        return NightlyRun(
            game_date=run['game_date'],
            rows=int(run.get('num_rows') or 0),
            status=str(run.get('status') or ''),
        )
