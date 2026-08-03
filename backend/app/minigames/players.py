"""Load NBA roster bundle and shared pick/filter helpers."""

from __future__ import annotations

import json
import logging
import random
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

_JSON_PATH = Path(__file__).resolve().parents[2] / "data" / "nba-players-2025-26.json"
_bundle: Optional[dict[str, Any]] = None


def load_bundle() -> dict[str, Any]:
    global _bundle
    if _bundle is not None:
        return _bundle
    if not _JSON_PATH.exists():
        logger.error("NBA players JSON missing at %s", _JSON_PATH)
        _bundle = {"seasonLabel": "", "source": "", "updatedAt": "", "players": []}
        return _bundle
    _bundle = json.loads(_JSON_PATH.read_text(encoding="utf-8"))
    return _bundle


def get_players() -> list[dict[str, Any]]:
    return list(load_bundle().get("players") or [])


def find_player_by_id(players: list[dict[str, Any]], player_id: str) -> Optional[dict[str, Any]]:
    for p in players:
        if p.get("id") == player_id:
            return p
    return None


def pick_random_player(
    players: list[dict[str, Any]], exclude_id: Optional[str] = None
) -> Optional[dict[str, Any]]:
    if not players:
        return None
    pool = (
        [p for p in players if p.get("id") != exclude_id]
        if exclude_id and len(players) > 1
        else players
    )
    use = pool if pool else players
    return random.choice(use)


def build_nba_team_options(players: list[dict[str, Any]]) -> list[dict[str, str]]:
    mapping: dict[str, str] = {}
    for p in players:
        abbr = p.get("teamAbbr")
        label = p.get("team")
        if abbr and label and abbr not in mapping:
            mapping[abbr] = label
    return sorted(
        [{"abbr": abbr, "label": label} for abbr, label in mapping.items()],
        key=lambda x: x["label"],
    )


def players_with_photos(players: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        p
        for p in players
        if p.get("photoUrl") is not None and str(p.get("photoUrl")).strip()
    ]


def pick_random_player_with_photo(
    players: list[dict[str, Any]], exclude_id: Optional[str] = None
) -> Optional[dict[str, Any]]:
    with_photos = players_with_photos(players)
    if not with_photos:
        return None
    return pick_random_player(with_photos, exclude_id=exclude_id)
