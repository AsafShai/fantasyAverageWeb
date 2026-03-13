import logging
from datetime import date, timedelta
from typing import Optional
import asyncpg
import pandas as pd
from app.config import settings

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
                for _, row in rankings_df.iterrows():
                    await conn.execute(
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
                        scoring_period_id,
                        snap_date,
                        int(row['team_id']),
                        str(row['team_name']),
                        int(row['FG%']),
                        int(row['FT%']),
                        int(row['3PM']),
                        int(row['REB']),
                        int(row['AST']),
                        int(row['STL']),
                        int(row['BLK']),
                        int(row['PTS']),
                        int(row['TOTAL_POINTS']),
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
                for _, row in rankings_totals_df.iterrows():
                    await conn.execute(
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
                        scoring_period_id,
                        snap_date,
                        int(row['team_id']),
                        str(row['team_name']),
                        int(row['FG%']),
                        int(row['FT%']),
                        int(row['3PM']),
                        int(row['REB']),
                        int(row['AST']),
                        int(row['STL']),
                        int(row['BLK']),
                        int(row['PTS']),
                        int(row['TOTAL_POINTS']),
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
                for _, row in totals_df.iterrows():
                    fgm = int(row['FGM'])
                    fga = int(row['FGA'])
                    ftm = int(row['FTM'])
                    fta = int(row['FTA'])
                    fg_pct = round(fgm / fga, 4) if fga > 0 else 0.0
                    ft_pct = round(ftm / fta, 4) if fta > 0 else 0.0
                    await conn.execute(
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
                        scoring_period_id,
                        snap_date,
                        int(row['team_id']),
                        str(row['team_name']),
                        int(row['GP']),
                        fgm, fga, fg_pct,
                        ftm, fta, ft_pct,
                        int(row['3PM']),
                        int(row['REB']),
                        int(row['AST']),
                        int(row['STL']),
                        int(row['BLK']),
                        int(row['PTS']),
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

    async def close(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None


def get_db_service() -> DBService:
    return DBService()
