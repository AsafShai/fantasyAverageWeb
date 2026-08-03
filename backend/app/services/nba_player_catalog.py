"""Load and cache the static NBA players JSON bundle."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Optional

from app.models.nba_player_models import NbaPlayerBio

logger = logging.getLogger(__name__)

_JSON_PATH = Path(__file__).resolve().parents[2] / "data" / "nba-players-2025-26.json"

_by_id: Optional[dict[int, NbaPlayerBio]] = None


def parse_espn_athlete_id(player_id: str | int) -> int:
    """Accept bare ESPN ids or 'espn-{id}' forms."""
    raw = str(player_id).strip()
    if raw.lower().startswith("espn-"):
        raw = raw.split("-", 1)[1]
    return int(raw)


def _bio_from_raw(raw: dict) -> NbaPlayerBio:
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


def _load_catalog() -> dict[int, NbaPlayerBio]:
    global _by_id
    if _by_id is not None:
        return _by_id
    if not _JSON_PATH.exists():
        logger.error("NBA players JSON missing at %s", _JSON_PATH)
        _by_id = {}
        return _by_id
    payload = json.loads(_JSON_PATH.read_text(encoding="utf-8"))
    catalog: dict[int, NbaPlayerBio] = {}
    for raw in payload.get("players") or []:
        try:
            espn_id = parse_espn_athlete_id(raw["id"])
        except (KeyError, ValueError, TypeError):
            continue
        catalog[espn_id] = _bio_from_raw(raw)
    _by_id = catalog
    logger.info("Loaded %d NBA players from %s", len(catalog), _JSON_PATH)
    return _by_id


def get_player_bio(player_id: str | int) -> Optional[NbaPlayerBio]:
    try:
        espn_id = parse_espn_athlete_id(player_id)
    except (ValueError, TypeError):
        return None
    return _load_catalog().get(espn_id)
