"""Current-roster bio pull: PLAYER_ID -> height/weight/position for all 30 teams.

Height and weight feed the bio features for players missing from the frozen
combine artifact (i.e. rookies who entered the league after the freeze);
wingspan/reach have no ESPN source and stay NaN for them by design.
"""

from __future__ import annotations

import logging

import pandas as pd

from . import client
from .teams import TEAM_IDS

logger = logging.getLogger(__name__)


def fetch_rosters() -> pd.DataFrame:
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
                "HEIGHT_IN": pd.to_numeric(a.get("height"), errors="coerce"),
                "WEIGHT_LB": pd.to_numeric(a.get("weight"), errors="coerce"),
            })
    logger.info(f"ESPN rosters: {len(rows)} players across {len(TEAM_IDS)} teams")
    return pd.DataFrame(rows).drop_duplicates("PLAYER_ID").reset_index(drop=True)
