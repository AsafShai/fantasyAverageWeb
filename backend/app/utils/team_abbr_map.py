"""Team identity for the app layer — a thin adapter over the canonical ESPN
team table in model_stats_inference.espn.teams.

Everything is ESPN-native: numeric team ids 1-30 (shared by ESPN's site and
fantasy APIs), canonical abbreviations in the fantasy dialect the app displays
(NYK/GSW/PHL…). ``canonical_abbr``/``team_id_for_abbr`` absorb the site-API
dialect (NY/GS/PHI…) at parse boundaries.
"""

from model_stats_inference.espn.teams import (  # noqa: F401
    ABBR_TO_TEAM_ID,
    SITE_ABBR_TO_TEAM_ID,
    TEAM_ID_TO_ABBR,
    TEAM_ID_TO_NAME,
    TEAM_IDS,
    team_id_for_abbr,
)


def canonical_abbr(abbr: str) -> str:
    """Any dialect ('NY' or 'NYK') -> canonical abbreviation ('NYK').
    Unknown strings pass through unchanged."""
    team_id = team_id_for_abbr(abbr)
    return TEAM_ID_TO_ABBR[team_id] if team_id is not None else abbr
