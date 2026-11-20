"""Current-roster bio pull: PLAYER_ID -> height/weight/position for all 30 teams.

Height and weight feed the bio features for players missing from the frozen
combine artifact (i.e. rookies who entered the league after the freeze);
wingspan/reach have no ESPN source and stay NaN for them by design.
"""

from __future__ import annotations

import logging

import polars as pl

from . import client
from .teams import TEAM_IDS

logger = logging.getLogger(__name__)


def _number(v) -> float:
    """pd.to_numeric(v, errors="coerce") for one JSON value."""
    try:
        return float(v)
    except (TypeError, ValueError):
        return float("nan")


def fetch_rosters() -> pl.DataFrame:
    """One row per rostered player: PLAYER_ID, PLAYER_NAME, POSITION,
    HEIGHT_IN, WEIGHT_LB (ESPN returns height already in inches)."""
    rows = []
    for tid in sorted(TEAM_IDS):
        data = client.team_roster(tid)
        for a in data.get("athletes", []):
            rows.append({
                "PLAYER_ID": int(a["id"]),
                "PLAYER_NAME": str(a.get("displayName", "")),
                "POSITION": str(a.get("position", {}).get("abbreviation", "")),
                "HEIGHT_IN": _number(a.get("height")),
                "WEIGHT_LB": _number(a.get("weight")),
            })
    logger.info(f"ESPN rosters: {len(rows)} players across {len(TEAM_IDS)} teams")
    schema = {"PLAYER_ID": pl.Int64, "PLAYER_NAME": pl.String, "POSITION": pl.String,
              "HEIGHT_IN": pl.Float64, "WEIGHT_LB": pl.Float64}
    frame = pl.from_dicts(rows, schema=schema) if rows else pl.DataFrame(schema=schema)
    return frame.unique(subset=["PLAYER_ID"], keep="first", maintain_order=True)
