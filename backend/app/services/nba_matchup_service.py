import logging
from datetime import datetime, timedelta

import httpx
import pandas as pd
from nba_api.stats.endpoints import leaguedashteamstats

from app.config import settings
from app.utils.team_abbr_map import nba_to_espn


def _season_str(season_id: int) -> str:
    return f'{season_id - 1}-{str(season_id)[2:]}'


_STAT_COLS: dict[str, str] = {
    'pts': 'OPP_PTS',
    'reb': 'OPP_REB',
    'ast': 'OPP_AST',
    'stl': 'OPP_STL',
    'blk': 'OPP_BLK',
    'three_pm': 'OPP_FG3M',
    'fg_pct': 'OPP_FG_PCT',
}


class NbaMatchupService:
    def __init__(self) -> None:
        self.logger = logging.getLogger(__name__)
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(30.0))
        self._def_cache: dict = {
            'ranks': None,
            'values': None,
            'league_avg_values': None,
            'pace': None,
            'ts': None,
        }
        self._schedule_cache: dict = {'data': None, 'ts': None}

    def _fetch_nba_stats(self) -> tuple[pd.DataFrame, pd.DataFrame]:
        season = _season_str(settings.season_id)
        opp_df = leaguedashteamstats.LeagueDashTeamStats(
            measure_type_detailed_defense='Opponent',
            per_mode_detailed='PerGame',
            season=season,
            season_type_all_star='Regular Season',
            league_id_nullable='00',
        ).get_data_frames()[0]
        adv_df = leaguedashteamstats.LeagueDashTeamStats(
            measure_type_detailed_defense='Advanced',
            per_mode_detailed='PerGame',
            season=season,
            season_type_all_star='Regular Season',
            league_id_nullable='00',
        ).get_data_frames()[0]
        return opp_df, adv_df

    def _def_cache_valid(self) -> bool:
        return (
            self._def_cache['ts'] is not None
            and datetime.now() - self._def_cache['ts'] < timedelta(minutes=5)
        )

    def _ensure_def_cache(self) -> None:
        if self._def_cache_valid() and self._def_cache['ranks'] is not None:
            return
        opp_df, adv_df = self._fetch_nba_stats()
        self._def_cache.update({
            'ranks': self._build_ranks(opp_df),
            'values': self._build_values(opp_df),
            'league_avg_values': self._build_league_avg_values(opp_df),
            'pace': self._build_pace(adv_df),
            'ts': datetime.now(),
        })

    def get_all_def_data(self) -> dict:
        self._ensure_def_cache()
        return {
            'ranks': self._def_cache['ranks'],
            'values': self._def_cache['values'],
            'league_avg_values': self._def_cache['league_avg_values'],
            'pace': self._def_cache['pace'],
        }

    def _build_ranks(self, opp_df: pd.DataFrame) -> dict[str, dict[str, int]]:
        ranks: dict[str, dict[str, int]] = {}
        for stat_key, col in _STAT_COLS.items():
            if col not in opp_df.columns:
                continue
            # ascending → lowest value = rank 1, highest = rank 30 (best matchup)
            sorted_df = opp_df.sort_values(col, ascending=True).reset_index(drop=True)
            for rank, (_, row) in enumerate(sorted_df.iterrows(), start=1):
                espn = nba_to_espn(row['TEAM_ABBREVIATION'])
                if espn not in ranks:
                    ranks[espn] = {}
                ranks[espn][stat_key] = rank
        return ranks

    def _build_values(self, opp_df: pd.DataFrame) -> dict[str, dict[str, float]]:
        values: dict[str, dict[str, float]] = {}
        for stat_key, col in _STAT_COLS.items():
            if col not in opp_df.columns:
                continue
            for _, row in opp_df.iterrows():
                espn = nba_to_espn(row['TEAM_ABBREVIATION'])
                if espn not in values:
                    values[espn] = {}
                raw = float(row[col])
                values[espn][stat_key] = round(raw, 3) if stat_key == 'fg_pct' else round(raw, 1)
        return values

    def _build_league_avg_values(self, opp_df: pd.DataFrame) -> dict[str, float]:
        avgs: dict[str, float] = {}
        for stat_key, col in _STAT_COLS.items():
            if col in opp_df.columns:
                raw = float(opp_df[col].mean())
                avgs[stat_key] = round(raw, 3) if stat_key == 'fg_pct' else round(raw, 1)
        return avgs

    def _build_pace(self, adv_df: pd.DataFrame) -> dict[str, float]:
        if 'PACE' not in adv_df.columns:
            return {}
        return {
            nba_to_espn(row['TEAM_ABBREVIATION']): float(row['PACE'])
            for _, row in adv_df.iterrows()
        }

    def get_pace_badge(self, team_pace: float, league_avg_pace: float) -> str:
        diff = team_pace - league_avg_pace
        if diff > 2.0:
            return 'Fast'
        if diff < -2.0:
            return 'Slow'
        return 'Average'

    async def get_games_today(self, date: str | None = None) -> dict[str, str]:
        # Skip cache when a specific date is requested (testing only)
        if date is None and (
            self._schedule_cache['ts'] is not None
            and datetime.now() - self._schedule_cache['ts'] < timedelta(minutes=5)
        ):
            return self._schedule_cache['data']

        url = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard'
        if date:
            url = f'{url}?dates={date}'
        response = await self._client.get(url)
        response.raise_for_status()
        data = response.json()

        games: dict[str, str] = {}
        for event in data.get('events', []):
            competitors = event.get('competitions', [{}])[0].get('competitors', [])
            if len(competitors) == 2:
                a = competitors[0]['team']['abbreviation']
                b = competitors[1]['team']['abbreviation']
                games[a] = b
                games[b] = a

        if date is None:
            self._schedule_cache.update({'data': games, 'ts': datetime.now()})
        return games

    async def close(self) -> None:
        await self._client.aclose()
