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
        self._def_cache: dict = {'ranks': None, 'pace': None, 'ts': None}
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

    def get_defensive_ranks(self) -> dict[str, dict[str, int]]:
        if self._def_cache_valid() and self._def_cache['ranks'] is not None:
            return self._def_cache['ranks']
        opp_df, adv_df = self._fetch_nba_stats()
        ranks: dict[str, dict[str, int]] = {}
        for stat_key, col in _STAT_COLS.items():
            if col not in opp_df.columns:
                continue
            # ascending sort → lowest value gets rank 1, highest gets rank N (best matchup)
            sorted_df = opp_df.sort_values(col, ascending=True).reset_index(drop=True)
            for rank, (_, row) in enumerate(sorted_df.iterrows(), start=1):
                espn = nba_to_espn(row['TEAM_ABBREVIATION'])
                if espn not in ranks:
                    ranks[espn] = {}
                ranks[espn][stat_key] = rank
        pace = self._build_pace(adv_df)
        self._def_cache.update({'ranks': ranks, 'pace': pace, 'ts': datetime.now()})
        return ranks

    def get_team_pace(self) -> dict[str, float]:
        if self._def_cache_valid() and self._def_cache['pace'] is not None:
            return self._def_cache['pace']
        _, adv_df = self._fetch_nba_stats()
        pace = self._build_pace(adv_df)
        self._def_cache.update({'pace': pace, 'ts': datetime.now()})
        return pace

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

    async def get_games_today(self) -> dict[str, str]:
        if (
            self._schedule_cache['ts'] is not None
            and datetime.now() - self._schedule_cache['ts'] < timedelta(minutes=5)
        ):
            return self._schedule_cache['data']

        url = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard'
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

        self._schedule_cache.update({'data': games, 'ts': datetime.now()})
        return games

    async def close(self) -> None:
        await self._client.aclose()
