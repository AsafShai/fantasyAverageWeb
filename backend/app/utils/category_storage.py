"""Storage of per-category values that have no dedicated DB column.

`team_daily_snapshot` and the two rankings tables carry one column per category
for the historical fixed set. A league scoring anything beyond it (e.g. TO) has
nowhere to put the value, so those extras live in a JSONB column alongside.

Only the extras are ever stored there, never a mirror of the fixed columns: a
value lives in exactly one place, so a column and a JSON key cannot drift apart,
and a league on the fixed categories writes NULL and pays nothing.

The cost of that choice is that reads must combine the two, which is what
`merge_categories` is for. It is deliberately the only place that knows values
come from two sources -- if the JSONB ever becomes the whole story, this is the
one function that changes.
"""
import json
import math
from typing import Dict, Optional, Union

from app.utils.constants import RANKING_CATEGORIES

# Categories with a dedicated column, per table. Anything outside these is an
# "extra" and goes to JSONB.
SNAPSHOT_FIXED_CATEGORIES = frozenset({
    'GP', 'FGM', 'FGA', 'FG%', 'FTM', 'FTA', 'FT%', '3PM',
    'REB', 'AST', 'STL', 'BLK', 'PTS',
})
RANKINGS_FIXED_CATEGORIES = frozenset(RANKING_CATEGORIES)

# Key holding the all-category total in a rankings `ranks` document. rk_total
# cannot carry it: that column means "total over the fixed categories" for every
# row ever written, and re-pointing it would silently change what older rows say.
TOTAL_KEY = 'TOTAL'

_NON_CATEGORY_COLUMNS = frozenset({
    'team_id', 'team_name', 'league_id', 'season_id', 'scoring_period_id',
    'date', 'id', 'created_at', 'RANK', 'TOTAL_POINTS',
})


def json_safe(value) -> Optional[float]:
    """A numpy scalar or NaN turned into something `json.dumps` accepts.

    NaN and infinities are not valid JSON and Postgres rejects the payload
    outright, so they become NULL rather than a token nothing can read back.
    """
    if value is None:
        return None
    try:
        as_float = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(as_float) or math.isinf(as_float):
        return None
    return as_float


def extra_categories(row, fixed: frozenset) -> Optional[Dict[str, float]]:
    """Values in `row` for categories that have no dedicated column.

    Returns None rather than {} when there are none, so the column stays NULL
    instead of storing an empty document on every row of every fixed-category
    league.
    """
    extras = {
        key: json_safe(row[key])
        for key in row.keys()
        if key not in fixed and key not in _NON_CATEGORY_COLUMNS
    }
    extras = {k: v for k, v in extras.items() if v is not None}
    return extras or None


def dumps(payload: Optional[Dict]) -> Optional[str]:
    """Serialize an extras document for a `$n::jsonb` parameter."""
    return None if payload is None else json.dumps(payload)


def loads(stored: Union[str, Dict, None]) -> Dict[str, float]:
    """Read back a stored extras document.

    Tolerates both shapes: asyncpg hands back `str` unless a jsonb codec is
    registered on the connection, and not every pool in this codebase is
    guaranteed to have one.
    """
    if not stored:
        return {}
    if isinstance(stored, str):
        try:
            return json.loads(stored)
        except (ValueError, TypeError):
            return {}
    return dict(stored)


def merge_categories(fixed_values: Dict[str, Optional[float]],
                     stored: Union[str, Dict, None]) -> Dict[str, float]:
    """One category -> value mapping from the fixed columns plus stored extras.

    The single seam between "some categories are columns" and "some are JSON".
    """
    merged = {k: v for k, v in fixed_values.items() if v is not None}
    merged.update(loads(stored))
    return merged
