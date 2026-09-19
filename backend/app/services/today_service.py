import asyncio
import logging
import time
from datetime import date
from typing import Any, Optional

from app.config import settings
from app.models import NightlyRun, RankMover, TeamRosterHealth, TodayHub
from app.services.data_provider import DataProvider
from app.services.db_service import DBService
from app.services.nba_matchup_service import NbaMatchupService
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

AVAILABLE = 'available'
PROBABLE = 'probable'
QUESTIONABLE = 'questionable'
DOUBTFUL = 'doubtful'
OUT = 'out'

STATUS_BUCKETS = (AVAILABLE, PROBABLE, QUESTIONABLE, DOUBTFUL, OUT)

# "Game Time Decision" is the NBA report's own wording for Questionable.
_STATUS_ALIASES = {'game time decision': QUESTIONABLE, 'gtd': QUESTIONABLE}

_CACHE_TTL_S = 300
_hub_cache: dict[str, Any] = {'ts': None, 'value': None}


def clear_today_hub_cache() -> None:
    _hub_cache.update({'ts': None, 'value': None})


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
    logger.warning(f'Unknown injury status {status!r} — counted as questionable')
    return QUESTIONABLE


class TodayService:
    """Composes the Dashboard's "what changed since yesterday" hub.

    Every part is fail-open: a source that raises contributes its empty value
    rather than failing the whole hub, because the three panels are unrelated
    and a dead injury feed should not hide the rank movers."""

    def __init__(self) -> None:
        self.db_service = DBService()
        self.data_provider = DataProvider()
        self.matchup_service = NbaMatchupService()

    async def get_today_hub(self) -> TodayHub:
        cached_ts = _hub_cache.get('ts')
        if cached_ts is not None and time.monotonic() - cached_ts < _CACHE_TTL_S:
            return _hub_cache['value']

        movers, tonight, nightly = await asyncio.gather(
            self._safe(self._get_movers(), []),
            self._safe(self._get_tonight(), (None, 0, [])),
            self._safe(self._get_last_nightly(), None),
        )
        slate_date, games_count, roster_health = tonight

        hub = TodayHub(
            slate_date=slate_date,
            games_count=games_count,
            movers=movers,
            roster_health=roster_health,
            last_nightly=nightly,
        )
        _hub_cache.update({'ts': time.monotonic(), 'value': hub})
        return hub

    @staticmethod
    async def _safe(coro, fallback):
        try:
            return await coro
        except Exception as e:
            logger.warning(f'Today hub part failed, serving empty: {e}')
            return fallback

    async def _get_movers(self) -> list[RankMover]:
        rows = await self.db_service.get_latest_two_periods_rankings(
            settings.league_id, settings.season_id
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

        movers: list[RankMover] = []
        for team_id, latest in by_period[latest_period].items():
            previous = by_period[previous_period].get(team_id)
            if previous is None:
                continue
            for category, value in latest.items():
                before = previous.get(category)
                if before is None or value is None:
                    continue
                delta = round(float(value) - float(before), 2)
                if delta == 0:
                    continue
                movers.append(RankMover(
                    team_id=team_id,
                    team_name=names.get(team_id, str(team_id)),
                    category=category,
                    delta=delta,
                ))

        movers.sort(key=lambda m: (-abs(m.delta), m.team_name, m.category))
        return movers

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

    async def _get_tonight(self) -> tuple[Optional[date], int, list[TeamRosterHealth]]:
        games, players_df = await asyncio.gather(
            self.matchup_service.get_games_today(),
            self.data_provider.get_players_df(0),
        )
        resolved = self.matchup_service.get_schedule_date()
        slate_date = date.fromisoformat(resolved) if resolved else None
        injuries = self._injury_lookup()
        health = self.build_roster_health(players_df, set(games.keys()), injuries)
        return slate_date, len(games), health

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
        if players_df is None or players_df.empty:
            return []

        accumulators: dict[int, dict] = {}
        for _, row in players_df.iterrows():
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
        run = await self.db_service.get_latest_model_nightly_run()
        if not run or run.get('game_date') is None:
            return None
        return NightlyRun(game_date=run['game_date'], rows=int(run.get('num_rows') or 0))
