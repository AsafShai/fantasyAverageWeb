"""NBA roster catalog for minigames, ADP bios, and /api/nba-players lookups."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from app.models.nba_player_models import NbaPlayerBio
from app.services.db_service import DBService

logger = logging.getLogger(__name__)

DEFAULT_SOURCE = "ESPN roster API (nba players refresh)"
DEFAULT_SEASON = "2025-26"

_by_id: Optional[dict[int, NbaPlayerBio]] = None
_meta: Optional[dict[str, Any]] = None
_players_raw: Optional[list[dict[str, Any]]] = None


def parse_espn_athlete_id(player_id: str | int) -> int:
    """Accept bare ESPN ids or 'espn-{id}' forms."""
    raw = str(player_id).strip()
    if raw.lower().startswith("espn-"):
        raw = raw.split("-", 1)[1]
    return int(raw)


def _bio_from_raw(raw: dict[str, Any]) -> NbaPlayerBio:
    return NbaPlayerBio(
        id=raw["id"],
        display_name=raw["displayName"],
        team=raw["team"],
        team_abbr=raw["teamAbbr"],
        conference=raw["conference"],
        division=raw["division"],
        position=raw["position"],
        photo_url=raw.get("photoUrl"),
        height=raw.get("height"),
        nationality=raw.get("nationality"),
        age=raw.get("age"),
        jersey_number=raw.get("jerseyNumber"),
    )


def _row_to_raw(row: Any) -> dict[str, Any]:
    return {
        "id": row["player_id"],
        "displayName": row["display_name"],
        "team": row["team"],
        "teamAbbr": row["team_abbr"],
        "conference": row["conference"],
        "division": row["division"],
        "position": row["position"],
        "photoUrl": row["photo_url"],
        "height": row["height"],
        "nationality": row["nationality"],
        "age": row["age"],
        "jerseyNumber": row["jersey_number"],
    }


def _raw_to_insert_args(raw: dict[str, Any]) -> tuple[Any, ...]:
    return (
        raw["id"],
        raw["displayName"],
        raw["team"],
        raw["teamAbbr"],
        raw["conference"],
        raw["division"],
        raw["position"],
        raw.get("photoUrl"),
        raw.get("height"),
        raw.get("nationality"),
        raw.get("age"),
        raw.get("jerseyNumber"),
    )


def _apply_cache(meta: dict[str, Any], players: list[dict[str, Any]]) -> None:
    global _by_id, _meta, _players_raw
    catalog: dict[int, NbaPlayerBio] = {}
    for raw in players:
        try:
            espn_id = parse_espn_athlete_id(raw["id"])
        except (KeyError, ValueError, TypeError):
            continue
        catalog[espn_id] = _bio_from_raw(raw)
    _by_id = catalog
    _meta = meta
    _players_raw = players
    logger.info("Loaded %d NBA players from database (updated %s)", len(catalog), meta.get("updatedAt"))


def reset_catalog_cache() -> None:
    global _by_id, _meta, _players_raw
    _by_id = None
    _meta = None
    _players_raw = None


def _load_catalog() -> dict[int, NbaPlayerBio]:
    if _by_id is None:
        return {}
    return _by_id


def get_player_bio(player_id: str | int) -> Optional[NbaPlayerBio]:
    try:
        espn_id = parse_espn_athlete_id(player_id)
    except (ValueError, TypeError):
        return None
    return _load_catalog().get(espn_id)


def list_all_bios() -> dict[int, NbaPlayerBio]:
    return dict(_load_catalog())


def get_players_list() -> list[dict[str, Any]]:
    return list(_players_raw or [])


def get_bundle_dict() -> dict[str, Any]:
    meta = _meta or {
        "seasonLabel": DEFAULT_SEASON,
        "source": DEFAULT_SOURCE,
        "updatedAt": "",
    }
    return {
        "seasonLabel": meta.get("seasonLabel", DEFAULT_SEASON),
        "source": meta.get("source", DEFAULT_SOURCE),
        "updatedAt": meta.get("updatedAt", ""),
        "players": get_players_list(),
    }


async def warm_cache() -> int:
    """Load catalog from Postgres into memory. Returns player count."""
    db = DBService()
    pool = await db._get_pool()
    if pool is None:
        logger.warning("NBA player catalog: database unavailable; cache empty")
        reset_catalog_cache()
        return 0
    try:
        async with pool.acquire() as conn:
            meta_row = await conn.fetchrow(
                "SELECT season_label, source, updated_at FROM nba_player_catalog_meta WHERE id = 1"
            )
            rows = await conn.fetch(
                """
                SELECT player_id, display_name, team, team_abbr, conference, division,
                       position, photo_url, height, nationality, age, jersey_number
                FROM nba_player_catalog
                ORDER BY display_name
                """
            )
    except Exception as e:
        logger.error("Failed to load NBA player catalog from database: %s", e)
        reset_catalog_cache()
        return 0

    if meta_row is None or not rows:
        reset_catalog_cache()
        return 0

    updated_at = meta_row["updated_at"]
    if isinstance(updated_at, datetime):
        updated_at = updated_at.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    meta = {
        "seasonLabel": meta_row["season_label"],
        "source": meta_row["source"],
        "updatedAt": updated_at,
    }
    players = [_row_to_raw(r) for r in rows]
    _apply_cache(meta, players)
    return len(players)


async def load_previous_players_by_id() -> dict[str, dict[str, Any]]:
    db = DBService()
    pool = await db._get_pool()
    if pool is None:
        return {}
    try:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT player_id, display_name, team, team_abbr, conference, division,
                       position, photo_url, height, nationality, age, jersey_number
                FROM nba_player_catalog
                """
            )
    except Exception as e:
        logger.warning("Could not load prior NBA catalog for merge: %s", e)
        return {}
    return {r["player_id"]: _row_to_raw(r) for r in rows}


async def replace_all(
    players: list[dict[str, Any]],
    *,
    season_label: str = DEFAULT_SEASON,
    source: str = DEFAULT_SOURCE,
) -> int:
    """Replace the full catalog in Postgres and reload the in-memory cache."""
    db = DBService()
    pool = await db._get_pool()
    if pool is None:
        raise RuntimeError("database unavailable; cannot persist NBA player catalog")

    updated_at = datetime.now(timezone.utc)
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("DELETE FROM nba_player_catalog")
            await conn.execute(
                """
                INSERT INTO nba_player_catalog_meta (id, season_label, source, updated_at)
                VALUES (1, $1, $2, $3)
                ON CONFLICT (id) DO UPDATE SET
                    season_label = EXCLUDED.season_label,
                    source = EXCLUDED.source,
                    updated_at = EXCLUDED.updated_at
                """,
                season_label,
                source,
                updated_at,
            )
            if players:
                await conn.executemany(
                    """
                    INSERT INTO nba_player_catalog (
                        player_id, display_name, team, team_abbr, conference, division,
                        position, photo_url, height, nationality, age, jersey_number
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                    """,
                    [_raw_to_insert_args(p) for p in players],
                )

    count = await warm_cache()
    logger.info("Persisted %d NBA players to database", count)
    return count


async def get_minigame_bundle() -> dict[str, Any]:
    if _players_raw is None:
        await warm_cache()
    return get_bundle_dict()
