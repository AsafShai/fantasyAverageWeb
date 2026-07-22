import logging
from datetime import date, timedelta
from typing import Optional
import asyncpg
import pandas as pd
from app.config import settings
from app.models.injury_models import InjuryRecord
from model_stats_inference.research import config as rconfig

logger = logging.getLogger(__name__)

_SEASON_START = settings.season_start

_RANKINGS_COL_MAP = {
    'FG%': 'rk_fg_pct',
    'FT%': 'rk_ft_pct',
    '3PM': 'rk_three_pm',
    'REB': 'rk_reb',
    'AST': 'rk_ast',
    'STL': 'rk_stl',
    'BLK': 'rk_blk',
    'PTS': 'rk_pts',
}


class DBService:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._pool: Optional[asyncpg.Pool] = None
        return cls._instance

    async def _get_pool(self) -> Optional[asyncpg.Pool]:
        if not settings.database_url:
            return None
        if self._pool is None:
            try:
                self._pool = await asyncpg.create_pool(
                    settings.database_url,
                    min_size=1,
                    max_size=5,
                )
            except Exception as e:
                logger.error(f"Failed to create DB connection pool: {e}")
                return None
        return self._pool

    async def get_db_max_scoring_period(self, table: str) -> int:
        pool = await self._get_pool()
        if pool is None:
            return 0
        try:
            async with pool.acquire() as conn:
                row = await conn.fetchrow(f"SELECT COALESCE(MAX(scoring_period_id), 0) AS max_period FROM {table}")
                return row['max_period']
        except Exception as e:
            logger.error(f"Failed to query max scoring_period_id from {table}: {e}")
            return 0

    async def upsert_rankings_averages(self, scoring_period_id: int, rankings_df: pd.DataFrame) -> None:
        pool = await self._get_pool()
        if pool is None:
            return
        snap_date = _SEASON_START + timedelta(days=scoring_period_id - 1)
        try:
            async with pool.acquire() as conn:
                await conn.executemany(
                    """
                    INSERT INTO team_rankings_averages
                        (scoring_period_id, date, team_id, team_name,
                         rk_fg_pct, rk_ft_pct, rk_three_pm, rk_reb,
                         rk_ast, rk_stl, rk_blk, rk_pts, rk_total)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
                    ON CONFLICT (scoring_period_id, team_id) DO UPDATE SET
                        team_name   = EXCLUDED.team_name,
                        rk_fg_pct   = EXCLUDED.rk_fg_pct,
                        rk_ft_pct   = EXCLUDED.rk_ft_pct,
                        rk_three_pm = EXCLUDED.rk_three_pm,
                        rk_reb      = EXCLUDED.rk_reb,
                        rk_ast      = EXCLUDED.rk_ast,
                        rk_stl      = EXCLUDED.rk_stl,
                        rk_blk      = EXCLUDED.rk_blk,
                        rk_pts      = EXCLUDED.rk_pts,
                        rk_total    = EXCLUDED.rk_total
                    """,
                    [
                        (
                            scoring_period_id, snap_date,
                            int(row['team_id']), str(row['team_name']),
                            int(row['FG%']), int(row['FT%']), int(row['3PM']),
                            int(row['REB']), int(row['AST']), int(row['STL']),
                            int(row['BLK']), int(row['PTS']), int(row['TOTAL_POINTS']),
                        )
                        for _, row in rankings_df.iterrows()
                    ],
                )
            logger.info(f"Upserted team_rankings_averages for scoring_period_id={scoring_period_id}")
        except Exception as e:
            logger.error(f"Failed to upsert team_rankings_averages: {e}")

    async def upsert_rankings_totals(self, scoring_period_id: int, rankings_totals_df: pd.DataFrame) -> None:
        pool = await self._get_pool()
        if pool is None:
            return
        snap_date = _SEASON_START + timedelta(days=scoring_period_id - 1)
        try:
            async with pool.acquire() as conn:
                await conn.executemany(
                    """
                    INSERT INTO team_rankings_totals
                        (scoring_period_id, date, team_id, team_name,
                         rk_fg_pct, rk_ft_pct, rk_three_pm, rk_reb,
                         rk_ast, rk_stl, rk_blk, rk_pts, rk_total)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
                    ON CONFLICT (scoring_period_id, team_id) DO UPDATE SET
                        team_name   = EXCLUDED.team_name,
                        rk_fg_pct   = EXCLUDED.rk_fg_pct,
                        rk_ft_pct   = EXCLUDED.rk_ft_pct,
                        rk_three_pm = EXCLUDED.rk_three_pm,
                        rk_reb      = EXCLUDED.rk_reb,
                        rk_ast      = EXCLUDED.rk_ast,
                        rk_stl      = EXCLUDED.rk_stl,
                        rk_blk      = EXCLUDED.rk_blk,
                        rk_pts      = EXCLUDED.rk_pts,
                        rk_total    = EXCLUDED.rk_total
                    """,
                    [
                        (
                            scoring_period_id, snap_date,
                            int(row['team_id']), str(row['team_name']),
                            int(row['FG%']), int(row['FT%']), int(row['3PM']),
                            int(row['REB']), int(row['AST']), int(row['STL']),
                            int(row['BLK']), int(row['PTS']), int(row['TOTAL_POINTS']),
                        )
                        for _, row in rankings_totals_df.iterrows()
                    ],
                )
            logger.info(f"Upserted team_rankings_totals for scoring_period_id={scoring_period_id}")
        except Exception as e:
            logger.error(f"Failed to upsert team_rankings_totals: {e}")

    async def upsert_daily_snapshot(self, scoring_period_id: int, totals_df: pd.DataFrame) -> None:
        pool = await self._get_pool()
        if pool is None:
            return
        snap_date = _SEASON_START + timedelta(days=scoring_period_id - 1)
        try:
            async with pool.acquire() as conn:
                rows = []
                for _, row in totals_df.iterrows():
                    fgm = int(row['FGM'])
                    fga = int(row['FGA'])
                    ftm = int(row['FTM'])
                    fta = int(row['FTA'])
                    rows.append((
                        scoring_period_id, snap_date,
                        int(row['team_id']), str(row['team_name']),
                        int(row['GP']),
                        fgm, fga, round(fgm / fga, 4) if fga > 0 else 0.0,
                        ftm, fta, round(ftm / fta, 4) if fta > 0 else 0.0,
                        int(row['3PM']), int(row['REB']), int(row['AST']),
                        int(row['STL']), int(row['BLK']), int(row['PTS']),
                    ))
                await conn.executemany(
                    """
                    INSERT INTO team_daily_snapshot
                        (scoring_period_id, date, team_id, team_name,
                         gp, fgm, fga, fg_pct, ftm, fta, ft_pct,
                         three_pm, reb, ast, stl, blk, pts)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
                    ON CONFLICT (scoring_period_id, team_id) DO UPDATE SET
                        team_name = EXCLUDED.team_name,
                        gp        = EXCLUDED.gp,
                        fgm       = EXCLUDED.fgm,
                        fga       = EXCLUDED.fga,
                        fg_pct    = EXCLUDED.fg_pct,
                        ftm       = EXCLUDED.ftm,
                        fta       = EXCLUDED.fta,
                        ft_pct    = EXCLUDED.ft_pct,
                        three_pm  = EXCLUDED.three_pm,
                        reb       = EXCLUDED.reb,
                        ast       = EXCLUDED.ast,
                        stl       = EXCLUDED.stl,
                        blk       = EXCLUDED.blk,
                        pts       = EXCLUDED.pts
                    """,
                    rows,
                )
            logger.info(f"Upserted team_daily_snapshot for scoring_period_id={scoring_period_id}")
        except Exception as e:
            logger.error(f"Failed to upsert team_daily_snapshot: {e}")

    async def get_latest_snapshot(self):
        """
        Returns (date, rows) where rows is a list of dicts with team totals.
        Returns (None, []) if DB unavailable or empty.
        """
        pool = await self._get_pool()
        if pool is None:
            return None, []
        try:
            async with pool.acquire() as conn:
                max_row = await conn.fetchrow(
                    "SELECT COALESCE(MAX(scoring_period_id), 0) AS max_period FROM team_daily_snapshot"
                )
                max_period = max_row['max_period']
                if max_period == 0:
                    return None, []
                rows = await conn.fetch(
                    """
                    SELECT team_id, team_name, gp, fgm, fga, fg_pct, ftm, fta, ft_pct,
                           three_pm, reb, ast, stl, blk, pts, date
                    FROM team_daily_snapshot
                    WHERE scoring_period_id = $1
                    """,
                    max_period
                )
                if not rows:
                    return None, []
                snap_date = rows[0]['date']
                return snap_date, [dict(r) for r in rows]
        except Exception as e:
            logger.error(f"Failed to fetch latest snapshot: {e}")
            return None, []

    async def get_rankings_over_time(self, table: str, team_ids: list[int] | None) -> list[dict]:
        pool = await self._get_pool()
        if pool is None:
            return []
        try:
            async with pool.acquire() as conn:
                if team_ids:
                    rows = await conn.fetch(
                        f"""
                        SELECT date, team_id, team_name,
                               rk_fg_pct, rk_ft_pct, rk_three_pm, rk_reb,
                               rk_ast, rk_stl, rk_blk, rk_pts, rk_total
                        FROM {table}
                        WHERE team_id = ANY($1)
                        ORDER BY date, team_id
                        """,
                        team_ids,
                    )
                else:
                    rows = await conn.fetch(
                        f"""
                        SELECT date, team_id, team_name,
                               rk_fg_pct, rk_ft_pct, rk_three_pm, rk_reb,
                               rk_ast, rk_stl, rk_blk, rk_pts, rk_total
                        FROM {table}
                        ORDER BY date, team_id
                        """
                    )
                return [dict(r) for r in rows]
        except Exception as e:
            logger.error(f"Failed to fetch rankings over time from {table}: {e}")
            return []

    async def get_snapshot_over_time(self, team_ids: list[int] | None) -> list[dict]:
        pool = await self._get_pool()
        if pool is None:
            return []
        cutoff = _SEASON_START + timedelta(days=10)
        try:
            async with pool.acquire() as conn:
                if team_ids:
                    rows = await conn.fetch(
                        """
                        SELECT date, team_id, team_name,
                               fg_pct, ft_pct, three_pm, reb, ast, stl, blk, pts
                        FROM team_daily_snapshot
                        WHERE date >= $1 AND team_id = ANY($2)
                        ORDER BY date, team_id
                        """,
                        cutoff, team_ids,
                    )
                else:
                    rows = await conn.fetch(
                        """
                        SELECT date, team_id, team_name,
                               fg_pct, ft_pct, three_pm, reb, ast, stl, blk, pts
                        FROM team_daily_snapshot
                        WHERE date >= $1
                        ORDER BY date, team_id
                        """,
                        cutoff,
                    )
                return [dict(r) for r in rows]
        except Exception as e:
            logger.error(f"Failed to fetch snapshot over time: {e}")
            return []

    async def get_averages_over_time(self, team_ids: list[int] | None) -> list[dict]:
        pool = await self._get_pool()
        if pool is None:
            return []
        _base = """
            SELECT date, team_id, team_name,
                   fg_pct,
                   ft_pct,
                   ROUND((three_pm::numeric / NULLIF(gp, 0)), 4) AS three_pm,
                   ROUND((reb::numeric    / NULLIF(gp, 0)), 4) AS reb,
                   ROUND((ast::numeric    / NULLIF(gp, 0)), 4) AS ast,
                   ROUND((stl::numeric    / NULLIF(gp, 0)), 4) AS stl,
                   ROUND((blk::numeric    / NULLIF(gp, 0)), 4) AS blk,
                   ROUND((pts::numeric    / NULLIF(gp, 0)), 4) AS pts
            FROM team_daily_snapshot
            WHERE date >= $1
        """
        try:
            async with pool.acquire() as conn:
                cutoff = _SEASON_START + timedelta(days=10)
                if team_ids:
                    rows = await conn.fetch(_base + " AND team_id = ANY($2) ORDER BY date, team_id", cutoff, team_ids)
                else:
                    rows = await conn.fetch(_base + " ORDER BY date, team_id", cutoff)
                return [dict(r) for r in rows]
        except Exception as e:
            logger.error(f"Failed to fetch averages over time: {e}")
            return []

    async def get_snapshots_for_date_range(self, start_date: date, end_date: date):
        """
        Returns (actual_end_date, actual_start_date, rows_end, rows_start) for delta calculation.
        - actual_end_date: closest date <= end_date in DB
        - actual_start_date: closest date >= start_date in DB (None if no data at or after start)
        - rows_start is empty list if no snapshot >= start_date exists (treat as zeros)
        - Returns (None, None, [], []) if no end snapshot found
        """
        pool = await self._get_pool()
        if pool is None:
            return None, None, [], []
        try:
            async with pool.acquire() as conn:
                end_row = await conn.fetchrow(
                    "SELECT MAX(date) AS d FROM team_daily_snapshot WHERE date <= $1", end_date
                )
                actual_end_date = end_row['d'] if end_row else None
                if actual_end_date is None:
                    return None, None, [], []

                start_row = await conn.fetchrow(
                    "SELECT MIN(date) AS d FROM team_daily_snapshot WHERE date >= $1", start_date
                )
                actual_start_date = start_row['d'] if start_row else None

                rows_end = await conn.fetch(
                    """
                    SELECT team_id, team_name, gp, fgm, fga, fg_pct, ftm, fta, ft_pct,
                           three_pm, reb, ast, stl, blk, pts
                    FROM team_daily_snapshot WHERE date = $1
                    """,
                    actual_end_date
                )

                rows_start = []
                if actual_start_date is not None:
                    rows_start = await conn.fetch(
                        """
                        SELECT team_id, team_name, gp, fgm, fga, fg_pct, ftm, fta, ft_pct,
                               three_pm, reb, ast, stl, blk, pts
                        FROM team_daily_snapshot WHERE date = $1
                        """,
                        actual_start_date
                    )

                return actual_end_date, actual_start_date, [dict(r) for r in rows_end], [dict(r) for r in rows_start]
        except Exception as e:
            logger.error(f"Failed to fetch snapshots for date range: {e}")
            return None, None, [], []

    async def upsert_estimator_prediction(self, df: pd.DataFrame) -> None:
        pool = await self._get_pool()
        if pool is None:
            return
        try:
            async with pool.acquire() as conn:
                async with conn.transaction():
                    await conn.execute("DELETE FROM estimator_prediction")
                    for _, row in df.iterrows():
                        await conn.execute(
                            """
                            INSERT INTO estimator_prediction (
                                team_id, team_name, as_of_date, projected_total_gp,
                                estimated_final_fg_pct, estimated_final_ft_pct, estimated_final_three_pm,
                                estimated_final_reb, estimated_final_ast, estimated_final_stl,
                                estimated_final_blk, estimated_final_pts,
                                variance_fg_pct, variance_ft_pct, variance_three_pm,
                                variance_reb, variance_ast, variance_stl, variance_blk, variance_pts,
                                nba_avg_pace
                            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
                            ON CONFLICT (team_id) DO UPDATE SET
                                team_name = EXCLUDED.team_name,
                                as_of_date = EXCLUDED.as_of_date,
                                projected_total_gp = EXCLUDED.projected_total_gp,
                                estimated_final_fg_pct = EXCLUDED.estimated_final_fg_pct,
                                estimated_final_ft_pct = EXCLUDED.estimated_final_ft_pct,
                                estimated_final_three_pm = EXCLUDED.estimated_final_three_pm,
                                estimated_final_reb = EXCLUDED.estimated_final_reb,
                                estimated_final_ast = EXCLUDED.estimated_final_ast,
                                estimated_final_stl = EXCLUDED.estimated_final_stl,
                                estimated_final_blk = EXCLUDED.estimated_final_blk,
                                estimated_final_pts = EXCLUDED.estimated_final_pts,
                                variance_fg_pct = EXCLUDED.variance_fg_pct,
                                variance_ft_pct = EXCLUDED.variance_ft_pct,
                                variance_three_pm = EXCLUDED.variance_three_pm,
                                variance_reb = EXCLUDED.variance_reb,
                                variance_ast = EXCLUDED.variance_ast,
                                variance_stl = EXCLUDED.variance_stl,
                                variance_blk = EXCLUDED.variance_blk,
                                variance_pts = EXCLUDED.variance_pts,
                                nba_avg_pace = EXCLUDED.nba_avg_pace
                            """,
                            int(row['team_id']),
                            str(row['team_name']),
                            row['as_of_date'],
                            float(row['projected_total_gp']),
                            float(row['estimated_final_fg_pct']),
                            float(row['estimated_final_ft_pct']),
                            float(row['estimated_final_three_pm']),
                            float(row['estimated_final_reb']),
                            float(row['estimated_final_ast']),
                            float(row['estimated_final_stl']),
                            float(row['estimated_final_blk']),
                            float(row['estimated_final_pts']),
                            float(row['variance_fg_pct']),
                            float(row['variance_ft_pct']),
                            float(row['variance_three_pm']),
                            float(row['variance_reb']),
                            float(row['variance_ast']),
                            float(row['variance_stl']),
                            float(row['variance_blk']),
                            float(row['variance_pts']),
                            float(row['nba_avg_pace']),
                        )
            logger.info("Upserted estimator_prediction")
        except Exception as e:
            logger.error(f"Failed to upsert estimator_prediction: {e}")

    async def upsert_estimator_ranking(self, df: pd.DataFrame) -> None:
        pool = await self._get_pool()
        if pool is None:
            return
        try:
            async with pool.acquire() as conn:
                async with conn.transaction():
                    await conn.execute("DELETE FROM estimator_ranking")
                    for _, row in df.iterrows():
                        await conn.execute(
                            """
                            INSERT INTO estimator_ranking (
                                team_id, team_name, rank, total_expected_pts,
                                expected_pts_fg_pct, expected_pts_ft_pct, expected_pts_three_pm,
                                expected_pts_reb, expected_pts_ast, expected_pts_stl,
                                expected_pts_blk, expected_pts_pts, projected_total_gp
                            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
                            ON CONFLICT (team_id) DO UPDATE SET
                                team_name = EXCLUDED.team_name,
                                rank = EXCLUDED.rank,
                                total_expected_pts = EXCLUDED.total_expected_pts,
                                expected_pts_fg_pct = EXCLUDED.expected_pts_fg_pct,
                                expected_pts_ft_pct = EXCLUDED.expected_pts_ft_pct,
                                expected_pts_three_pm = EXCLUDED.expected_pts_three_pm,
                                expected_pts_reb = EXCLUDED.expected_pts_reb,
                                expected_pts_ast = EXCLUDED.expected_pts_ast,
                                expected_pts_stl = EXCLUDED.expected_pts_stl,
                                expected_pts_blk = EXCLUDED.expected_pts_blk,
                                expected_pts_pts = EXCLUDED.expected_pts_pts,
                                projected_total_gp = EXCLUDED.projected_total_gp
                            """,
                            int(row['team_id']),
                            str(row['team_name']),
                            int(row['rank']),
                            float(row['total_expected_pts']),
                            float(row['expected_pts_fg_pct']),
                            float(row['expected_pts_ft_pct']),
                            float(row['expected_pts_three_pm']),
                            float(row['expected_pts_reb']),
                            float(row['expected_pts_ast']),
                            float(row['expected_pts_stl']),
                            float(row['expected_pts_blk']),
                            float(row['expected_pts_pts']),
                            float(row['projected_total_gp']),
                        )
            logger.info("Upserted estimator_ranking")
        except Exception as e:
            logger.error(f"Failed to upsert estimator_ranking: {e}")

    async def upsert_estimator_rank_probability(self, df: pd.DataFrame) -> None:
        pool = await self._get_pool()
        if pool is None:
            return
        try:
            async with pool.acquire() as conn:
                async with conn.transaction():
                    await conn.execute("DELETE FROM estimator_rank_probability")
                    await conn.executemany(
                        """
                        INSERT INTO estimator_rank_probability (team_id, team_name, rank, prob)
                        VALUES ($1, $2, $3, $4)
                        """,
                        [
                            (int(row['team_id']), str(row['team_name']), int(row['rank']), float(row['prob']))
                            for _, row in df.iterrows()
                        ],
                    )
            logger.info("Upserted estimator_rank_probability")
        except Exception as e:
            logger.error(f"Failed to upsert estimator_rank_probability: {e}")

    async def get_estimator_latest(self) -> dict:
        pool = await self._get_pool()
        if pool is None:
            return {}
        try:
            async with pool.acquire() as conn:
                predictions = await conn.fetch(
                    "SELECT * FROM estimator_prediction ORDER BY team_id"
                )
                rankings = await conn.fetch(
                    "SELECT * FROM estimator_ranking ORDER BY rank"
                )
                rank_probs = await conn.fetch(
                    "SELECT * FROM estimator_rank_probability ORDER BY team_id, rank"
                )
                return {
                    "predictions": [dict(r) for r in predictions],
                    "rankings": [dict(r) for r in rankings],
                    "rank_probabilities": [dict(r) for r in rank_probs],
                }
        except Exception as e:
            logger.error(f"Failed to fetch estimator latest: {e}")
            return {}

    async def estimator_has_data(self) -> bool:
        pool = await self._get_pool()
        if pool is None:
            return False
        try:
            async with pool.acquire() as conn:
                count = await conn.fetchval("SELECT COUNT(*) FROM estimator_ranking")
                return (count or 0) > 0
        except Exception as e:
            logger.error(f"Failed to check estimator data: {e}")
            return False

    async def upsert_injury_status(self, record: InjuryRecord) -> None:
        pool = await self._get_pool()
        if pool is None:
            return
        try:
            async with pool.acquire() as conn:
                await conn.execute(
                    """
                    INSERT INTO player_injury_status (team, player, status, injury_reason, last_updated)
                    VALUES ($1, $2, $3, $4, NOW())
                    ON CONFLICT (team, player) DO UPDATE SET
                        status        = EXCLUDED.status,
                        injury_reason = EXCLUDED.injury_reason,
                        last_updated  = NOW()
                    WHERE player_injury_status.status IS DISTINCT FROM EXCLUDED.status
                       OR player_injury_status.injury_reason IS DISTINCT FROM EXCLUDED.injury_reason
                    """,
                    record.team, record.player, record.status, record.injury,
                )
        except Exception as e:
            logger.error(f"Failed to upsert injury status for {record.team}|{record.player}: {e}")

    async def delete_injury_status(self, team: str, player: str) -> None:
        pool = await self._get_pool()
        if pool is None:
            return
        try:
            async with pool.acquire() as conn:
                await conn.execute(
                    "DELETE FROM player_injury_status WHERE team = $1 AND player = $2",
                    team, player,
                )
        except Exception as e:
            logger.error(f"Failed to delete injury status for {team}|{player}: {e}")

    async def get_injury_statuses_for_teams(self, teams: list[str]) -> list[dict]:
        pool = await self._get_pool()
        if pool is None:
            return []
        try:
            async with pool.acquire() as conn:
                rows = await conn.fetch(
                    "SELECT team, player, status, injury_reason FROM player_injury_status WHERE team = ANY($1)",
                    teams,
                )
                return [dict(r) for r in rows]
        except Exception as e:
            logger.error(f"Failed to fetch injury statuses for teams: {e}")
            return []

    async def load_all_injury_statuses(self) -> list[dict]:
        pool = await self._get_pool()
        if pool is None:
            return []
        try:
            async with pool.acquire() as conn:
                rows = await conn.fetch(
                    "SELECT team, player, status, injury_reason, last_updated FROM player_injury_status"
                )
                return [dict(r) for r in rows]
        except Exception as e:
            logger.error(f"Failed to load all injury statuses: {e}")
            return []

    # --- nightly model pipeline (feature-store rows / eval results / runs) ---

    async def fs_counts(self) -> tuple[int, int]:
        """(player rows, team rows) in the feature-store tables; (0, 0) on failure."""
        pool = await self._get_pool()
        if pool is None:
            return 0, 0
        try:
            async with pool.acquire() as conn:
                p = await conn.fetchval("SELECT COUNT(*) FROM fs_player_games")
                t = await conn.fetchval("SELECT COUNT(*) FROM fs_team_games")
                return int(p or 0), int(t or 0)
        except Exception as e:
            logger.error(f"Failed to count feature-store rows: {e}")
            return 0, 0

    async def get_team_defense_aggregates(self, season: str) -> list[dict]:
        """Season-to-date opponent ("allowed") per-game averages + pace proxy per
        team, self-joined from fs_team_games (the opponent is the other team of
        each game). Feeds the matchup page's defensive ranks — previously NBA's
        precomputed Opponent/Advanced tables, now derived from our own store.

        ``pace`` is the possession proxy (FGA + 0.44·FTA + TOV, both teams
        averaged) — a few possessions above NBA's official PACE (no offensive-
        rebound term) but rank/badge-equivalent."""
        pool = await self._get_pool()
        if pool is None:
            return []
        try:
            async with pool.acquire() as conn:
                rows = await conn.fetch(
                    """
                    SELECT a.team_id,
                           COUNT(*)                                      AS gp,
                           AVG(b.pts)                                    AS opp_pts,
                           AVG(b.reb)                                    AS opp_reb,
                           AVG(b.ast)                                    AS opp_ast,
                           AVG(b.stl)                                    AS opp_stl,
                           AVG(b.blk)                                    AS opp_blk,
                           AVG(b.fg3m)                                   AS opp_fg3m,
                           SUM(b.fg_pct * b.fga) / NULLIF(SUM(b.fga), 0) AS opp_fg_pct,
                           AVG((a.fga + 0.44 * a.fta + a.tov)
                             + (b.fga + 0.44 * b.fta + b.tov)) / 2       AS pace
                    FROM fs_team_games a
                    JOIN fs_team_games b ON b.game_id = a.game_id AND b.team_id <> a.team_id
                    WHERE a.season = $1
                    GROUP BY a.team_id
                    """,
                    season,
                )
                return [dict(r) for r in rows]
        except Exception as e:
            logger.error(f"Failed to aggregate team defense for {season}: {e}")
            return []

    async def get_last5_minutes(self) -> dict[int, float]:
        """player_id -> plain average minutes over his last 5 appearances,
        UNGATED (sub-MIN_MINUTES games count — the slider default should show
        real recent playing time, unlike the feature windows which treat them
        as DNPs)."""
        pool = await self._get_pool()
        if pool is None:
            return {}
        try:
            async with pool.acquire() as conn:
                rows = await conn.fetch(
                    """
                    SELECT player_id, AVG(min) AS avg_min FROM (
                        SELECT player_id, min,
                               ROW_NUMBER() OVER (
                                   PARTITION BY player_id
                                   ORDER BY game_date DESC, game_id DESC
                               ) AS rn
                        FROM fs_player_games
                    ) t WHERE rn <= 5
                    GROUP BY player_id
                    """
                )
                return {int(r["player_id"]): float(r["avg_min"]) for r in rows}
        except Exception as e:
            logger.error(f"Failed to compute last-5 minutes averages: {e}")
            return {}

    async def get_recent_game_dates(self, limit: int = 60) -> list[date]:
        """Most recent distinct game dates in the store, newest first — the
        dates the what-if slate picker can offer without guessing."""
        pool = await self._get_pool()
        if pool is None:
            return []
        try:
            async with pool.acquire() as conn:
                rows = await conn.fetch(
                    "SELECT DISTINCT game_date FROM fs_team_games "
                    "ORDER BY game_date DESC LIMIT $1",
                    limit,
                )
                return [r["game_date"] for r in rows]
        except Exception as e:
            logger.error(f"Failed to list recent game dates: {e}")
            return []

    async def fs_has_date(self, game_date: date) -> Optional[bool]:
        """Whether the store already holds the night's rows. None = DB unavailable
        (the caller must NOT treat that as 'safe to predict')."""
        pool = await self._get_pool()
        if pool is None:
            return None
        try:
            async with pool.acquire() as conn:
                return bool(await conn.fetchval(
                    "SELECT EXISTS (SELECT 1 FROM fs_player_games WHERE game_date = $1)",
                    game_date,
                ))
        except Exception as e:
            logger.error(f"Failed to check fs rows for {game_date}: {e}")
            return None

    async def get_fs_rows_before(self, game_date: date) -> tuple[list[dict], list[dict]]:
        """The model's only read boundary into fs_player_games. The MIN_MINUTES
        gate is enforced here (not at write time): storage keeps every played
        minute for other consumers, but sub-threshold games are DNPs to the
        feature math — same threshold research/training filters on."""
        pool = await self._get_pool()
        if pool is None:
            return [], []
        try:
            async with pool.acquire() as conn:
                players = await conn.fetch(
                    "SELECT * FROM fs_player_games WHERE game_date < $1 AND min >= $2",
                    game_date, rconfig.MIN_MINUTES,
                )
                teams = await conn.fetch(
                    "SELECT * FROM fs_team_games WHERE game_date < $1", game_date
                )
                return [dict(r) for r in players], [dict(r) for r in teams]
        except Exception as e:
            logger.error(f"Failed to fetch fs rows before {game_date}: {e}")
            return [], []

    async def aggregate_player_games(
        self, start: date, end: date, season: str
    ) -> tuple[pd.DataFrame, Optional[date], Optional[date]]:
        """Per-player totals over [start, end] inclusive, for the dynamic
        time-range player stats feature. Returns (df, actual_start, actual_end)
        where the actual dates are the real game_date coverage found in the
        window (None if no rows at all). Percentages are SUM(makes)/SUM(attempts),
        never a mean of per-game ratios; gp is COUNT(*)."""
        pool = await self._get_pool()
        if pool is None:
            return pd.DataFrame(), None, None
        try:
            async with pool.acquire() as conn:
                coverage = await conn.fetchrow(
                    """
                    SELECT MIN(game_date) AS start_date, MAX(game_date) AS end_date
                    FROM fs_player_games
                    WHERE season = $1 AND game_date BETWEEN $2 AND $3 AND min > 0
                    """,
                    season, start, end,
                )
                actual_start = coverage['start_date'] if coverage else None
                actual_end = coverage['end_date'] if coverage else None

                rows = await conn.fetch(
                    """
                    SELECT
                        player_id,
                        (array_agg(player_name ORDER BY game_date DESC))[1] AS player_name,
                        COUNT(*) AS gp,
                        SUM(pts) AS pts,
                        SUM(reb) AS reb,
                        SUM(ast) AS ast,
                        SUM(stl) AS stl,
                        SUM(blk) AS blk,
                        SUM(fgm) AS fgm,
                        SUM(fga) AS fga,
                        SUM(ftm) AS ftm,
                        SUM(fta) AS fta,
                        SUM(fg3m) AS three_pm,
                        SUM(min) AS min,
                        COALESCE(SUM(fgm) / NULLIF(SUM(fga), 0), 0.0) AS fg_pct,
                        COALESCE(SUM(ftm) / NULLIF(SUM(fta), 0), 0.0) AS ft_pct
                    FROM fs_player_games
                    WHERE season = $1 AND game_date BETWEEN $2 AND $3 AND min > 0
                    GROUP BY player_id
                    """,
                    season, start, end,
                )
                return pd.DataFrame([dict(r) for r in rows]), actual_start, actual_end
        except Exception as e:
            logger.error(f"Failed to aggregate player games for {start}..{end} ({season}): {e}")
            return pd.DataFrame(), None, None

    async def get_latest_game_date(self, season: str) -> Optional[date]:
        """Most recent game_date with real box scores this season, or None if
        none exist yet. Used as the anchor for last_7/15/30 instead of real
        calendar today, so those windows stay meaningful once the season ends
        (real today would otherwise land in a dead offseason stretch)."""
        pool = await self._get_pool()
        if pool is None:
            return None
        try:
            async with pool.acquire() as conn:
                row = await conn.fetchrow(
                    "SELECT MAX(game_date) AS d FROM fs_player_games WHERE season = $1 AND min > 0",
                    season,
                )
                return row['d'] if row else None
        except Exception as e:
            logger.error(f"Failed to fetch latest game date for season {season}: {e}")
            return None

    async def aggregate_shooting_by_player(
        self, seasons: list[str], start: Optional[date] = None, end: Optional[date] = None
    ) -> pd.DataFrame:
        """Per-player FG/FT/3P makes+attempts summed across `seasons` (a single
        season for a current-season aggregate, two prior seasons for a
        regression baseline), optionally bounded to [start, end]. Percentages
        are SUM(makes)/SUM(attempts), never a mean of per-game ratios."""
        pool = await self._get_pool()
        if pool is None:
            return pd.DataFrame()
        try:
            async with pool.acquire() as conn:
                rows = await conn.fetch(
                    """
                    SELECT
                        player_id,
                        (array_agg(player_name ORDER BY game_date DESC))[1] AS player_name,
                        COUNT(*) AS gp,
                        SUM(fgm) AS fgm,
                        SUM(fga) AS fga,
                        COALESCE(SUM(fgm) / NULLIF(SUM(fga), 0), 0.0) AS fg_pct,
                        SUM(ftm) AS ftm,
                        SUM(fta) AS fta,
                        COALESCE(SUM(ftm) / NULLIF(SUM(fta), 0), 0.0) AS ft_pct,
                        SUM(fg3m) AS fg3m,
                        SUM(fg3a) AS fg3a,
                        COALESCE(SUM(fg3m) / NULLIF(SUM(fg3a), 0), 0.0) AS fg3_pct,
                        SUM(min) AS min
                    FROM fs_player_games
                    WHERE season = ANY($1::text[]) AND min > 0
                      AND ($2::date IS NULL OR game_date >= $2)
                      AND ($3::date IS NULL OR game_date <= $3)
                    GROUP BY player_id
                    """,
                    seasons, start, end,
                )
                return pd.DataFrame([dict(r) for r in rows])
        except Exception as e:
            logger.error(f"Failed to aggregate shooting for seasons {seasons}: {e}")
            return pd.DataFrame()

    async def get_usage_components(self, season: str, start: date, end: date) -> pd.DataFrame:
        """Per-game rows with everything USG% needs: player FGA/FTA/TOV/MIN plus
        that game's team FGA/FTA/TOV (fs_team_games) and team total MIN
        (fs_team_games has no min column — derived via SUM(fs_player_games.min)
        grouped by team_id+game_id). USG% itself is computed per game in Python
        (never from summed totals) then averaged over whatever window the
        caller wants (season, last-5, etc) from this same row set."""
        pool = await self._get_pool()
        if pool is None:
            return pd.DataFrame()
        try:
            async with pool.acquire() as conn:
                rows = await conn.fetch(
                    """
                    SELECT
                        p.player_id,
                        p.player_name,
                        p.game_id,
                        p.game_date,
                        p.min AS p_min,
                        p.fga AS p_fga,
                        p.fta AS p_fta,
                        p.tov AS p_tov,
                        t.fga AS t_fga,
                        t.fta AS t_fta,
                        t.tov AS t_tov,
                        tm.team_min AS t_min
                    FROM fs_player_games p
                    JOIN fs_team_games t
                        ON t.team_id = p.team_id AND t.game_id = p.game_id
                    JOIN (
                        SELECT team_id, game_id, SUM(min) AS team_min
                        FROM fs_player_games
                        WHERE season = $1 AND game_date BETWEEN $2 AND $3
                        GROUP BY team_id, game_id
                    ) tm ON tm.team_id = p.team_id AND tm.game_id = p.game_id
                    WHERE p.season = $1 AND p.game_date BETWEEN $2 AND $3 AND p.min > 0
                    """,
                    season, start, end,
                )
                return pd.DataFrame([dict(r) for r in rows])
        except Exception as e:
            logger.error(f"Failed to fetch usage components for {start}..{end} ({season}): {e}")
            return pd.DataFrame()

    async def get_games_since(self, since_date: date) -> dict[int, int]:
        """player_id -> distinct games played with game_date >= since_date
        (any season) — trailing-window recency count (e.g. games in the last
        15 days) used to filter out currently inactive/injured players
        regardless of season-total GP."""
        pool = await self._get_pool()
        if pool is None:
            return {}
        try:
            async with pool.acquire() as conn:
                rows = await conn.fetch(
                    """
                    SELECT player_id, COUNT(DISTINCT game_id) AS g
                    FROM fs_player_games
                    WHERE game_date >= $1 AND min > 0
                    GROUP BY player_id
                    """,
                    since_date,
                )
                return {int(r["player_id"]): int(r["g"]) for r in rows}
        except Exception as e:
            logger.error(f"Failed to count games since {since_date}: {e}")
            return {}

    async def insert_fs_rows(self, player_rows: list[tuple], team_rows: list[tuple]) -> bool:
        """Append raw game rows. Tuple order must match the column lists below.
        ON CONFLICT DO NOTHING makes re-runs of the same night no-ops."""
        pool = await self._get_pool()
        if pool is None:
            return False
        player_cols = (
            "player_id, game_id, season, game_date, player_name, team_id, matchup, position, "
            "min, pts, reb, oreb, dreb, ast, fg3m, fg3a, stl, blk, tov, fgm, fga, ftm, fta, pf, plus_minus"
        )
        team_cols = (
            "team_id, game_id, season, game_date, team_name, matchup, "
            "pts, reb, ast, stl, blk, fg3m, fg_pct, fga, fta, tov"
        )
        try:
            async with pool.acquire() as conn:
                async with conn.transaction():
                    if player_rows:
                        await conn.executemany(
                            f"INSERT INTO fs_player_games ({player_cols}) VALUES "
                            f"({', '.join(f'${i + 1}' for i in range(25))}) "
                            "ON CONFLICT (player_id, game_id) DO NOTHING",
                            player_rows,
                        )
                    if team_rows:
                        await conn.executemany(
                            f"INSERT INTO fs_team_games ({team_cols}) VALUES "
                            f"({', '.join(f'${i + 1}' for i in range(16))}) "
                            "ON CONFLICT (team_id, game_id) DO NOTHING",
                            team_rows,
                        )
            logger.info(f"Inserted {len(player_rows)} player / {len(team_rows)} team fs rows")
            return True
        except Exception as e:
            logger.error(f"Failed to insert fs rows: {e}")
            return False

    async def truncate_fs_tables(self) -> bool:
        """Wipe the raw-row store AND derived vectors (forced re-bootstrap starts clean)."""
        pool = await self._get_pool()
        if pool is None:
            return False
        try:
            async with pool.acquire() as conn:
                await conn.execute(
                    "TRUNCATE fs_player_games, fs_team_games, "
                    "fs_player_vectors, fs_team_allowed_vectors, fs_team_own_vectors"
                )
            logger.info("Truncated feature-store + vector tables")
            return True
        except Exception as e:
            logger.error(f"Failed to truncate feature-store tables: {e}")
            return False

    async def upsert_feature_vectors(
        self, player_rows: list[tuple], team_allowed_rows: list[tuple], team_own_rows: list[tuple]
    ) -> bool:
        """Upsert the materialized 'as of now' vectors. player_rows tuple order:
        (player_id, player_name, team_id, position, last_game_date, games_count,
         eligible, features_json). team rows: (team_id, features_json)."""
        pool = await self._get_pool()
        if pool is None:
            return False
        try:
            async with pool.acquire() as conn:
                async with conn.transaction():
                    if player_rows:
                        await conn.executemany(
                            """
                            INSERT INTO fs_player_vectors
                                (player_id, player_name, team_id, position,
                                 last_game_date, games_count, eligible, features, updated_at)
                            VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb, NOW())
                            ON CONFLICT (player_id) DO UPDATE SET
                                player_name    = EXCLUDED.player_name,
                                team_id        = EXCLUDED.team_id,
                                position       = EXCLUDED.position,
                                last_game_date = EXCLUDED.last_game_date,
                                games_count    = EXCLUDED.games_count,
                                eligible       = EXCLUDED.eligible,
                                features       = EXCLUDED.features,
                                updated_at     = NOW()
                            """,
                            player_rows,
                        )
                    for table, rows in (
                        ("fs_team_allowed_vectors", team_allowed_rows),
                        ("fs_team_own_vectors", team_own_rows),
                    ):
                        if rows:
                            await conn.executemany(
                                f"""
                                INSERT INTO {table} (team_id, features, updated_at)
                                VALUES ($1, $2::jsonb, NOW())
                                ON CONFLICT (team_id) DO UPDATE SET
                                    features   = EXCLUDED.features,
                                    updated_at = NOW()
                                """,
                                rows,
                            )
            logger.info(
                f"Upserted {len(player_rows)} player + {len(team_allowed_rows)} team feature vectors"
            )
            return True
        except Exception as e:
            logger.error(f"Failed to upsert feature vectors: {e}")
            return False

    async def load_feature_vectors(self) -> tuple[list[dict], list[dict], list[dict]]:
        """(player_vectors, team_allowed_vectors, team_own_vectors) rows for serving."""
        pool = await self._get_pool()
        if pool is None:
            return [], [], []
        try:
            async with pool.acquire() as conn:
                pv = await conn.fetch("SELECT * FROM fs_player_vectors")
                tav = await conn.fetch("SELECT * FROM fs_team_allowed_vectors")
                tov = await conn.fetch("SELECT * FROM fs_team_own_vectors")
                return [dict(r) for r in pv], [dict(r) for r in tav], [dict(r) for r in tov]
        except Exception as e:
            logger.error(f"Failed to load feature vectors: {e}")
            return [], [], []

    async def get_model_nightly_run(self, game_date: date) -> Optional[dict]:
        pool = await self._get_pool()
        if pool is None:
            return None
        try:
            async with pool.acquire() as conn:
                row = await conn.fetchrow(
                    "SELECT * FROM model_nightly_runs WHERE game_date = $1", game_date
                )
                return dict(row) if row else None
        except Exception as e:
            logger.error(f"Failed to fetch model nightly run for {game_date}: {e}")
            return None

    async def upsert_model_nightly_run(
        self, game_date: date, status: str, num_games: int, num_rows: int
    ) -> bool:
        pool = await self._get_pool()
        if pool is None:
            return False
        try:
            async with pool.acquire() as conn:
                await conn.execute(
                    """
                    INSERT INTO model_nightly_runs (game_date, status, num_games, num_rows, ran_at)
                    VALUES ($1, $2, $3, $4, NOW())
                    ON CONFLICT (game_date) DO UPDATE SET
                        status    = EXCLUDED.status,
                        num_games = EXCLUDED.num_games,
                        num_rows  = EXCLUDED.num_rows,
                        ran_at    = NOW()
                    """,
                    game_date, status, num_games, num_rows,
                )
            logger.info(f"Marked model nightly run {game_date} as '{status}'")
            return True
        except Exception as e:
            logger.error(f"Failed to upsert model nightly run for {game_date}: {e}")
            return False

    async def insert_model_eval_rows(self, rows: list[tuple]) -> bool:
        """Upsert predicted-vs-actual rows. Tuple order must match the columns below."""
        pool = await self._get_pool()
        if pool is None:
            return False
        stats = ["pts", "reb", "ast", "fg3m", "stl", "blk", "fgm", "fga", "ftm", "fta"]
        cols = (
            ["game_id", "player_id", "game_date", "player_name", "team_id",
             "opponent_team_id", "is_home", "minutes", "eligible", "reason"]
            + [f"pred_{s}" for s in stats]
            + [f"actual_{s}" for s in stats]
        )
        updates = ",\n".join(f"{c} = EXCLUDED.{c}" for c in cols if c not in ("game_id", "player_id"))
        try:
            async with pool.acquire() as conn:
                await conn.executemany(
                    f"INSERT INTO model_eval_results ({', '.join(cols)}) VALUES "
                    f"({', '.join(f'${i + 1}' for i in range(len(cols)))}) "
                    f"ON CONFLICT (game_id, player_id) DO UPDATE SET {updates}",
                    rows,
                )
            logger.info(f"Upserted {len(rows)} model eval rows")
            return True
        except Exception as e:
            logger.error(f"Failed to insert model eval rows: {e}")
            return False

    async def get_model_eval_for_date(self, game_date: date) -> list[dict]:
        pool = await self._get_pool()
        if pool is None:
            return []
        try:
            async with pool.acquire() as conn:
                rows = await conn.fetch(
                    "SELECT * FROM model_eval_results WHERE game_date = $1 ORDER BY player_id",
                    game_date,
                )
                return [dict(r) for r in rows]
        except Exception as e:
            logger.error(f"Failed to fetch model eval rows for {game_date}: {e}")
            return []

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None


def get_db_service() -> DBService:
    return DBService()
