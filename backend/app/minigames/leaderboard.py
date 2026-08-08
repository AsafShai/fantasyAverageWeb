"""Top-5 leaderboard per minigame (Postgres + in-memory fallback)."""

from __future__ import annotations

import logging
import re
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

from app.minigames import GAME_SLUGS, HINTS_GAMES
from app.services.db_service import DBService

logger = logging.getLogger(__name__)

MAX_NAME_LEN = 24
TOP_N = 5

_NAME_RE = re.compile(r"\s+")


@dataclass
class LeaderboardEntry:
    id: int
    game_slug: str
    display_name: str
    best_streak: int
    hints_used: Optional[int]
    achieved_at: datetime


# In-memory store when DATABASE_URL is unavailable.
_mem_lock = threading.Lock()
_mem_rows: list[LeaderboardEntry] = []
_mem_next_id = 1


def normalize_display_name(raw: str) -> str:
    name = _NAME_RE.sub(" ", (raw or "").strip())
    if not name or len(name) > MAX_NAME_LEN:
        raise ValueError(f"displayName must be 1–{MAX_NAME_LEN} characters")
    return name


def sort_key(row: LeaderboardEntry, game_slug: str):
    """Higher rank first when sorting ascending with this key's reverse… use for sorted(..., reverse=False) with inverted streak."""
    # We sort with custom key that ranks best first when using sorted(..., key=..., reverse=False)
    # Actually: use tuple where smaller = better rank for sorted ascending.
    if game_slug in HINTS_GAMES:
        hints = row.hints_used if row.hints_used is not None else 10**9
        return (-row.best_streak, hints, row.id)
    # Newer achieved_at wins ties → sort by -timestamp
    ts = row.achieved_at.timestamp() if row.achieved_at else 0.0
    return (-row.best_streak, -ts, row.id)


def rank_rows(rows: list[LeaderboardEntry], game_slug: str) -> list[LeaderboardEntry]:
    return sorted(rows, key=lambda r: sort_key(r, game_slug))


def qualifies(
    game_slug: str,
    best_streak: int,
    hints_used: Optional[int],
    current_top: list[LeaderboardEntry],
) -> bool:
    if best_streak <= 0:
        return False
    if len(current_top) < TOP_N:
        return True
    candidate = LeaderboardEntry(
        id=10**12,
        game_slug=game_slug,
        display_name="__candidate__",
        best_streak=best_streak,
        hints_used=hints_used,
        achieved_at=datetime.now(timezone.utc),
    )
    ranked = rank_rows(current_top + [candidate], game_slug)
    # Qualifies if candidate is in top N
    top_ids = {r.id for r in ranked[:TOP_N]}
    return candidate.id in top_ids


def _row_to_api(rank: int, row: LeaderboardEntry, include_hints: bool) -> dict[str, Any]:
    out: dict[str, Any] = {
        "rank": rank,
        "displayName": row.display_name,
        "bestStreak": row.best_streak,
    }
    if include_hints:
        out["hintsUsed"] = row.hints_used
    return out


async def _fetch_from_db(game_slug: str) -> Optional[list[LeaderboardEntry]]:
    db = DBService()
    pool = await db._get_pool()
    if pool is None:
        return None
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT id, game_slug, display_name, best_streak, hints_used, achieved_at
                FROM minigame_leaderboard
                WHERE game_slug = $1
                """,
                game_slug,
            )
        entries = [
            LeaderboardEntry(
                id=int(r["id"]),
                game_slug=r["game_slug"],
                display_name=r["display_name"],
                best_streak=int(r["best_streak"]),
                hints_used=r["hints_used"],
                achieved_at=r["achieved_at"],
            )
            for r in rows
        ]
        return rank_rows(entries, game_slug)
    except Exception as e:
        logger.error("Failed to fetch leaderboard for %s: %s", game_slug, e)
        return None


def _fetch_from_mem(game_slug: str) -> list[LeaderboardEntry]:
    with _mem_lock:
        rows = [r for r in _mem_rows if r.game_slug == game_slug]
    return rank_rows(rows, game_slug)


async def get_top5(game_slug: str) -> list[dict[str, Any]]:
    if game_slug not in GAME_SLUGS:
        raise ValueError("invalid game_slug")
    include_hints = game_slug in HINTS_GAMES
    db_rows = await _fetch_from_db(game_slug)
    rows = db_rows if db_rows is not None else _fetch_from_mem(game_slug)
    return [_row_to_api(i + 1, r, include_hints) for i, r in enumerate(rows[:TOP_N])]


async def check_qualifies(
    game_slug: str, best_streak: int, hints_used: Optional[int] = None
) -> bool:
    if game_slug not in GAME_SLUGS:
        raise ValueError("invalid game_slug")
    db_rows = await _fetch_from_db(game_slug)
    rows = db_rows if db_rows is not None else _fetch_from_mem(game_slug)
    return qualifies(game_slug, best_streak, hints_used, rows[:TOP_N])


async def submit_score(
    game_slug: str,
    display_name: str,
    best_streak: int,
    hints_used: Optional[int] = None,
) -> list[dict[str, Any]]:
    if game_slug not in GAME_SLUGS:
        raise ValueError("invalid game_slug")
    if best_streak <= 0:
        raise ValueError("bestStreak must be positive")
    name = normalize_display_name(display_name)
    if game_slug in HINTS_GAMES:
        if hints_used is None:
            hints_used = 0
        hints_used = max(0, int(hints_used))
    else:
        hints_used = None

    db_rows = await _fetch_from_db(game_slug)
    using_db = db_rows is not None
    current = db_rows if using_db else _fetch_from_mem(game_slug)

    if not qualifies(game_slug, best_streak, hints_used, current[:TOP_N]):
        raise ValueError("score does not qualify for top 5")

    if using_db:
        await _insert_and_trim_db(game_slug, name, best_streak, hints_used)
    else:
        _insert_and_trim_mem(game_slug, name, best_streak, hints_used)

    return await get_top5(game_slug)


async def _insert_and_trim_db(
    game_slug: str, name: str, best_streak: int, hints_used: Optional[int]
) -> None:
    db = DBService()
    pool = await db._get_pool()
    if pool is None:
        raise RuntimeError("database unavailable")
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                INSERT INTO minigame_leaderboard (game_slug, display_name, best_streak, hints_used)
                VALUES ($1, $2, $3, $4)
                """,
                game_slug,
                name,
                best_streak,
                hints_used,
            )
            rows = await conn.fetch(
                """
                SELECT id, game_slug, display_name, best_streak, hints_used, achieved_at
                FROM minigame_leaderboard
                WHERE game_slug = $1
                """,
                game_slug,
            )
            entries = [
                LeaderboardEntry(
                    id=int(r["id"]),
                    game_slug=r["game_slug"],
                    display_name=r["display_name"],
                    best_streak=int(r["best_streak"]),
                    hints_used=r["hints_used"],
                    achieved_at=r["achieved_at"],
                )
                for r in rows
            ]
            keep = {r.id for r in rank_rows(entries, game_slug)[:TOP_N]}
            drop = [r.id for r in entries if r.id not in keep]
            if drop:
                await conn.execute(
                    "DELETE FROM minigame_leaderboard WHERE id = ANY($1::int[])",
                    drop,
                )


def _insert_and_trim_mem(
    game_slug: str, name: str, best_streak: int, hints_used: Optional[int]
) -> None:
    global _mem_next_id
    with _mem_lock:
        entry = LeaderboardEntry(
            id=_mem_next_id,
            game_slug=game_slug,
            display_name=name,
            best_streak=best_streak,
            hints_used=hints_used,
            achieved_at=datetime.now(timezone.utc),
        )
        _mem_next_id += 1
        _mem_rows.append(entry)
        keep_ids = {r.id for r in rank_rows(
            [r for r in _mem_rows if r.game_slug == game_slug], game_slug
        )[:TOP_N]}
        _mem_rows[:] = [
            r for r in _mem_rows
            if r.game_slug != game_slug or r.id in keep_ids
        ]
