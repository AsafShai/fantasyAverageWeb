"""Filter / sort / page a cached ADP player list for the HTTP API."""

from __future__ import annotations

from functools import cmp_to_key
from typing import Optional

from app.models.adp import AdpIndexPlayer, AdpPlayer, AdpResponse

SORT_KEYS = (
    "blend",
    "spread",
    "name",
    "team",
    "espn",
    "fantrax",
    "sleeper",
    "yahoo",
    "ranking_blend",
    "ranking_spread",
)
_SITE_KEYS = ("espn", "fantrax", "sleeper", "yahoo")
_IDS_CAP = 120


def team_abbrs(players: list[AdpPlayer]) -> list[str]:
    return sorted({p.team_abbr for p in players if p.team_abbr})


def to_index_player(p: AdpPlayer) -> AdpIndexPlayer:
    return AdpIndexPlayer(
        id=p.id,
        espn_id=p.espn_id,
        name=p.name,
        team_abbr=p.team_abbr,
        positions=list(p.positions),
        fringe=p.fringe,
        blend=p.blend,
        blend_rank=p.blend_rank,
        ranking_blend=p.ranking_blend,
        ranking_blend_rank=p.ranking_blend_rank,
    )


def filter_players(
    players: list[AdpPlayer],
    *,
    q: str = "",
    team: str = "",
    positions: Optional[list[str]] = None,
    ranked_only: bool = True,
    metric: str = "adp",
    include_fringe: bool = False,
) -> list[AdpPlayer]:
    needle = q.strip().lower()
    team_key = team.strip().upper()
    pos = [p.strip().upper() for p in (positions or []) if p.strip()]
    out: list[AdpPlayer] = []
    # metric="any" keeps a player the other blend covers -- the pre-draft board's pool must
    # not change when the user flips the order.
    blend_attrs = ("blend", "ranking_blend") if metric == "any" else (
        ("blend",) if metric == "adp" else ("ranking_blend",)
    )
    for p in players:
        if ranked_only and all(getattr(p, attr) is None for attr in blend_attrs):
            continue
        if p.fringe and not include_fringe:
            continue
        if needle and needle not in p.name.lower() and needle not in (p.team_abbr or "").lower():
            continue
        if team_key and (p.team_abbr or "").upper() != team_key:
            continue
        if pos and not any(slot in p.positions for slot in pos):
            continue
        out.append(p)
    return out


def _sort_value(p: AdpPlayer, key: str, metric: str = "adp"):
    """Value behind a sort key, resolved through the active metric.

    `blend`, `spread`, and the per-site keys all mean the rankings flavour when the caller
    is on the Rankings view -- the client keeps one set of column keys either way.
    """
    if key == "name":
        return p.name.lower()
    if key == "team":
        abbr = (p.team_abbr or "").lower()
        return abbr or None
    if key in ("blend", "ranking_blend"):
        return p.ranking_blend if (metric == "rank" or key == "ranking_blend") else p.blend
    if key in ("spread", "ranking_spread"):
        return p.ranking_spread if (metric == "rank" or key == "ranking_spread") else p.spread
    if key in _SITE_KEYS:
        site = getattr(p, key)
        return site.ranking if metric == "rank" else site.adp
    return None


def sort_players(
    players: list[AdpPlayer], sort: str, sort_dir: str, metric: str = "adp"
) -> list[AdpPlayer]:
    key = sort if sort in SORT_KEYS else "blend"
    direction = -1 if sort_dir == "desc" else 1
    # Ties fall back to the other metric before the name. Both kinds of tie are common: ESPN
    # parks hundreds of undrafted players just under 140, and deeper still nobody reports an
    # ADP at all. Ordering either group alphabetically buries the players every ranking list
    # rates highly, so the other blend breaks the tie instead.
    other = "ranking_blend" if metric == "adp" else "blend"
    fallback = other if key not in ("name", "team") else None

    def tiebreak(a: AdpPlayer, b: AdpPlayer) -> int:
        if fallback is not None:
            av = getattr(a, fallback)
            bv = getattr(b, fallback)
            if av is not None or bv is not None:
                if av is None:
                    return 1
                if bv is None:
                    return -1
                if av != bv:
                    return -1 if av < bv else 1
        return (a.name.lower() > b.name.lower()) - (a.name.lower() < b.name.lower())

    def cmp(a: AdpPlayer, b: AdpPlayer) -> int:
        av = _sort_value(a, key, metric)
        bv = _sort_value(b, key, metric)
        if av is None and bv is None:
            return tiebreak(a, b)
        if av is None:
            return 1
        if bv is None:
            return -1
        if av < bv:
            return -direction
        if av > bv:
            return direction
        return tiebreak(a, b)

    return sorted(players, key=cmp_to_key(cmp))


def _page_slice(items: list, page: int, page_size: int) -> tuple[list, int, int, int, int]:
    total = len(items)
    size = max(1, page_size)
    total_pages = max(1, (total + size - 1) // size) if total else 1
    safe_page = min(max(1, page), total_pages)
    start = (safe_page - 1) * size
    return items[start : start + size], total, safe_page, total_pages, start


def paginate_players(
    players: list[AdpPlayer],
    *,
    page: int = 1,
    page_size: int = 50,
    sort: str = "blend",
    sort_dir: str = "asc",
    q: str = "",
    team: str = "",
    positions: Optional[list[str]] = None,
    ranked_only: bool = True,
    ids: Optional[list[str]] = None,
    metric: str = "adp",
    include_fringe: bool = False,
) -> tuple[list[AdpPlayer], int, int, int, int]:
    if ids is not None:
        wanted = [i.strip() for i in ids if i and i.strip()][:_IDS_CAP]
        by_id = {p.id: p for p in players}
        page_players = [by_id[i] for i in wanted if i in by_id]
        return page_players, len(page_players), 1, 1, 0

    filtered = filter_players(
        players,
        q=q,
        team=team,
        positions=positions,
        ranked_only=ranked_only,
        metric=metric,
        include_fringe=include_fringe,
    )
    ordered = sort_players(filtered, sort, sort_dir, metric)
    return _page_slice(ordered, page, page_size)


def paginated_response(
    base: AdpResponse,
    *,
    page: int = 1,
    page_size: int = 50,
    sort: str = "blend",
    sort_dir: str = "asc",
    q: str = "",
    team: str = "",
    positions: Optional[list[str]] = None,
    ranked_only: bool = True,
    ids: Optional[list[str]] = None,
    metric: str = "adp",
    include_fringe: bool = False,
) -> AdpResponse:
    page_players, total, safe_page, total_pages, offset = paginate_players(
        base.players,
        page=page,
        page_size=page_size,
        sort=sort,
        sort_dir=sort_dir,
        q=q,
        team=team,
        positions=positions,
        ranked_only=ranked_only,
        ids=ids,
        metric=metric,
        include_fringe=include_fringe,
    )
    return base.model_copy(
        update={
            "players": page_players,
            "teams": team_abbrs(base.players),
            "total": total,
            "page": safe_page,
            "page_size": page_size,
            "total_pages": total_pages,
            "offset": offset,
        }
    )
