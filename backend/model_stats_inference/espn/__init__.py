"""ESPN site-API data layer — the pipeline's only game-data source.

Replaces nba_api/stats.nba.com (which blocks datacenter IPs, see
github.com/swar/nba_api#652). IDs everywhere are ESPN-native: athlete ids for
players, team ids 1-30, event ids for games.
"""

from .client import EspnUnavailableError  # noqa: F401
from .games import (  # noqa: F401
    DayFetch,
    fetch_day,
    fetch_seasons,
    season_for,
)
from .rosters import fetch_rosters  # noqa: F401
from .teams import (  # noqa: F401
    ABBR_TO_TEAM_ID,
    SITE_ABBR_TO_TEAM_ID,
    TEAM_ID_TO_ABBR,
    TEAM_ID_TO_NAME,
    TEAM_IDS,
    team_id_for_abbr,
)
