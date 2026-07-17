"""Matchup context for the UI: today's schedule (ESPN scoreboard) and each
team's defensive profile (ranks / allowed values / pace).

Defensive aggregates are computed from our own fs_team_games store (season-to-
date self-join in Postgres) instead of NBA's precomputed Opponent/Advanced
tables — one ingestion path, no stats.nba.com dependency. All team keys are
canonical abbreviations (NYK/GSW/PHL…), the dialect the fantasy side and the
UI already speak.
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import httpx

from app.config import settings
from app.services.db_service import DBService
from app.utils.team_abbr_map import TEAM_ID_TO_ABBR, canonical_abbr


def _season_str(season_id: int) -> str:
    return f'{season_id - 1}-{str(season_id)[2:]}'


@dataclass
class GameInfo:
    opponent: str  # canonical abbreviation
    is_home: bool


# stat key served to the UI -> aggregate column from get_team_defense_aggregates
_STAT_COLS: dict[str, str] = {
    'pts': 'opp_pts',
    'reb': 'opp_reb',
    'ast': 'opp_ast',
    'stl': 'opp_stl',
    'blk': 'opp_blk',
    'three_pm': 'opp_fg3m',
    'fg_pct': 'opp_fg_pct',
}


class NbaMatchupService:
    def __init__(self) -> None:
        self.logger = logging.getLogger(__name__)
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(30.0))
        self._db = DBService()
        self._def_cache: dict = {
            'ranks': None,
            'values': None,
            'league_avg_values': None,
            'pace': None,
            'ts': None,
        }
        self._schedule_cache: dict = {'data': None, 'ts': None}

    def _def_cache_valid(self) -> bool:
        return (
            self._def_cache['ts'] is not None
            and datetime.now() - self._def_cache['ts'] < timedelta(minutes=5)
        )

    async def _ensure_def_cache(self) -> None:
        if self._def_cache_valid() and self._def_cache['ranks'] is not None:
            return
        rows = await self._db.get_team_defense_aggregates(_season_str(settings.season_id))
        if not rows:
            self.logger.warning('No team defense aggregates (store empty?) — matchup ranks unavailable')
        self._def_cache.update({
            'ranks': self._build_ranks(rows),
            'values': self._build_values(rows),
            'league_avg_values': self._build_league_avg_values(rows),
            'pace': self._build_pace(rows),
            'ts': datetime.now(),
        })

    async def get_all_def_data(self) -> dict:
        await self._ensure_def_cache()
        return {
            'ranks': self._def_cache['ranks'],
            'values': self._def_cache['values'],
            'league_avg_values': self._def_cache['league_avg_values'],
            'pace': self._def_cache['pace'],
        }

    @staticmethod
    def _team_abbr(row: dict) -> str:
        return TEAM_ID_TO_ABBR.get(int(row['team_id']), str(row['team_id']))

    def _build_ranks(self, rows: list[dict]) -> dict[str, dict[str, int]]:
        ranks: dict[str, dict[str, int]] = {}
        for stat_key, col in _STAT_COLS.items():
            # ascending → lowest value allowed = rank 1, highest = rank 30 (best matchup)
            for rank, row in enumerate(sorted(rows, key=lambda r: float(r[col] or 0)), start=1):
                ranks.setdefault(self._team_abbr(row), {})[stat_key] = rank
        return ranks

    def _build_values(self, rows: list[dict]) -> dict[str, dict[str, float]]:
        values: dict[str, dict[str, float]] = {}
        for row in rows:
            abbr = self._team_abbr(row)
            for stat_key, col in _STAT_COLS.items():
                raw = float(row[col] or 0)
                values.setdefault(abbr, {})[stat_key] = (
                    round(raw, 3) if stat_key == 'fg_pct' else round(raw, 1)
                )
        return values

    def _build_league_avg_values(self, rows: list[dict]) -> dict[str, float]:
        avgs: dict[str, float] = {}
        if not rows:
            return avgs
        for stat_key, col in _STAT_COLS.items():
            raw = sum(float(r[col] or 0) for r in rows) / len(rows)
            avgs[stat_key] = round(raw, 3) if stat_key == 'fg_pct' else round(raw, 1)
        return avgs

    def _build_pace(self, rows: list[dict]) -> dict[str, float]:
        return {self._team_abbr(r): float(r['pace'] or 0) for r in rows}

    def get_pace_badge(self, team_pace: float, league_avg_pace: float) -> str:
        diff = team_pace - league_avg_pace
        if diff > 2.0:
            return 'Fast'
        if diff < -2.0:
            return 'Slow'
        return 'Average'

    async def get_games_today(self, date: str | None = None) -> dict[str, GameInfo]:
        # Skip cache when a specific date is requested (testing only)
        if date is None and (
            self._schedule_cache['ts'] is not None
            and datetime.now() - self._schedule_cache['ts'] < timedelta(minutes=5)
        ):
            return self._schedule_cache['data']

        # Always pin the date: ESPN's dateless scoreboard returns the NEAREST
        # game day (e.g. the season finale all offseason), not "today". "Today"
        # is the US/Eastern date — the NBA game-day convention — so evening
        # games stay "today" for viewers ahead of US time.
        requested = date or datetime.now(ZoneInfo('America/New_York')).strftime('%Y%m%d')
        url = (
            'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard'
            f'?dates={requested}'
        )
        response = await self._client.get(url)
        response.raise_for_status()
        data = response.json()

        games: dict[str, GameInfo] = {}
        for event in data.get('events', []):
            competitors = event.get('competitions', [{}])[0].get('competitors', [])
            if len(competitors) == 2:
                a, b = competitors[0], competitors[1]
                # scoreboard abbreviations are site dialect (NY/GS/…) — normalize
                a_abbr = canonical_abbr(a['team']['abbreviation'])
                b_abbr = canonical_abbr(b['team']['abbreviation'])
                games[a_abbr] = GameInfo(opponent=b_abbr, is_home=a.get('homeAway') == 'home')
                games[b_abbr] = GameInfo(opponent=a_abbr, is_home=b.get('homeAway') == 'home')

        if date is None:
            self._schedule_cache.update({'data': games, 'ts': datetime.now()})
        return games

    async def close(self) -> None:
        await self._client.aclose()
