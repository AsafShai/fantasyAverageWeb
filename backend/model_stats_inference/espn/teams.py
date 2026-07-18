"""The 30 NBA teams in ESPN's ID space — the canonical team table.

ESPN uses one numeric team-id space across its products (site API and fantasy
API agree), but two abbreviation dialects:

  - ``site``    : what site.api.espn.com scoreboards/boxscores return (NY, GS, SA…)
  - ``fantasy`` : what the fantasy API / PRO_TEAM_MAP uses (NYK, GSW, SAS…) —
                  this is also the dialect the app displays, so it is the
                  canonical abbreviation everywhere outside site-API parsing.

Static by construction (franchise moves are once-a-decade events), so this is a
hardcoded table rather than an API call.
"""

from __future__ import annotations

# (espn_id, site_abbr, fantasy_abbr, name)
_TEAMS: list[tuple[int, str, str, str]] = [
    (1, "ATL", "ATL", "Atlanta Hawks"),
    (2, "BOS", "BOS", "Boston Celtics"),
    (3, "NO", "NOP", "New Orleans Pelicans"),
    (4, "CHI", "CHI", "Chicago Bulls"),
    (5, "CLE", "CLE", "Cleveland Cavaliers"),
    (6, "DAL", "DAL", "Dallas Mavericks"),
    (7, "DEN", "DEN", "Denver Nuggets"),
    (8, "DET", "DET", "Detroit Pistons"),
    (9, "GS", "GSW", "Golden State Warriors"),
    (10, "HOU", "HOU", "Houston Rockets"),
    (11, "IND", "IND", "Indiana Pacers"),
    (12, "LAC", "LAC", "LA Clippers"),
    (13, "LAL", "LAL", "Los Angeles Lakers"),
    (14, "MIA", "MIA", "Miami Heat"),
    (15, "MIL", "MIL", "Milwaukee Bucks"),
    (16, "MIN", "MIN", "Minnesota Timberwolves"),
    (17, "BKN", "BKN", "Brooklyn Nets"),
    (18, "NY", "NYK", "New York Knicks"),
    (19, "ORL", "ORL", "Orlando Magic"),
    (20, "PHI", "PHL", "Philadelphia 76ers"),
    (21, "PHX", "PHO", "Phoenix Suns"),
    (22, "POR", "POR", "Portland Trail Blazers"),
    (23, "SAC", "SAC", "Sacramento Kings"),
    (24, "SA", "SAS", "San Antonio Spurs"),
    (25, "OKC", "OKC", "Oklahoma City Thunder"),
    (26, "UTAH", "UTA", "Utah Jazz"),
    (27, "WSH", "WAS", "Washington Wizards"),
    (28, "TOR", "TOR", "Toronto Raptors"),
    (29, "MEM", "MEM", "Memphis Grizzlies"),
    (30, "CHA", "CHA", "Charlotte Hornets"),
]

TEAM_IDS: frozenset[int] = frozenset(t[0] for t in _TEAMS)

TEAM_ID_TO_ABBR: dict[int, str] = {t[0]: t[2] for t in _TEAMS}   # canonical (fantasy)
TEAM_ID_TO_NAME: dict[int, str] = {t[0]: t[3] for t in _TEAMS}
SITE_ABBR_TO_TEAM_ID: dict[str, int] = {t[1]: t[0] for t in _TEAMS}
ABBR_TO_TEAM_ID: dict[str, int] = {t[2]: t[0] for t in _TEAMS}   # canonical (fantasy)


def team_id_for_abbr(abbr: str) -> int | None:
    """Resolve either abbreviation dialect to the ESPN team id."""
    return ABBR_TO_TEAM_ID.get(abbr) or SITE_ABBR_TO_TEAM_ID.get(abbr)
