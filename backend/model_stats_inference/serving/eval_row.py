"""Shared eval-row type: one player's predicted-vs-actual line for a game.

Used by the nightly pipeline (scoring the model against real results as they
land) and previously also by the season-replay debug harness.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# Stats we surface (model targets + derived percentages).
DISPLAY_STATS = ["PTS", "REB", "AST", "FG3M", "STL", "BLK", "FGM", "FGA", "FTM", "FTA", "FG_PCT", "FT_PCT"]


@dataclass
class EvalRow:
    player_id: int
    player_name: str
    team_id: int
    opponent_team_id: int
    is_home: bool
    real_minutes: float
    eligible: bool
    reason: str = ""
    game_id: str = ""
    predicted: dict[str, float] = field(default_factory=dict)
    actual: dict[str, float] = field(default_factory=dict)


def _actual_line(row) -> dict[str, float]:
    out = {s: float(row[s]) for s in DISPLAY_STATS if s in row.index and s not in ("FG_PCT", "FT_PCT")}
    out["FG_PCT"] = round(out["FGM"] / out["FGA"], 3) if out.get("FGA") else 0.0
    out["FT_PCT"] = round(out["FTM"] / out["FTA"], 3) if out.get("FTA") else 0.0
    return out
