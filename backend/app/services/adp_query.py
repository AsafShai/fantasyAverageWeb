"""Filter / sort / page a cached ADP player list for the HTTP API."""

from __future__ import annotations

from functools import cmp_to_key
from typing import Optional

from app.models.adp import AdpIndexPlayer, AdpPlayer, AdpResponse

SORT_KEYS = ("blend", "spread", "name", "team", "espn", "fantrax", "sleeper")
BOARD_SIZES = {12}
BOARD_ROUNDS = 15
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
        blend=p.blend,
        blend_rank=p.blend_rank,
    )


def filter_players(
    players: list[AdpPlayer],
    *,
    q: str = "",
    team: str = "",
    positions: Optional[list[str]] = None,
    ranked_only: bool = True,
) -> list[AdpPlayer]:
    needle = q.strip().lower()
    team_key = team.strip().upper()
    pos = [p.strip().upper() for p in (positions or []) if p.strip()]
    out: list[AdpPlayer] = []
    for p in players:
        if ranked_only and p.blend is None:
            continue
        if needle and needle not in p.name.lower() and needle not in (p.team_abbr or "").lower():
            continue
        if team_key and (p.team_abbr or "").upper() != team_key:
            continue
        if pos and not any(slot in p.positions for slot in pos):
            continue
        out.append(p)
    return out


def _sort_value(p: AdpPlayer, key: str):
    if key == "name":
        return p.name.lower()
    if key == "team":
        abbr = (p.team_abbr or "").lower()
        return abbr or None
    if key == "blend":
        return p.blend
    if key == "spread":
        return p.spread
    site = getattr(p, key, None)
    return getattr(site, "adp", None) if site is not None else None


def sort_players(players: list[AdpPlayer], sort: str, sort_dir: str) -> list[AdpPlayer]:
    key = sort if sort in SORT_KEYS else "blend"
    direction = -1 if sort_dir == "desc" else 1

    def cmp(a: AdpPlayer, b: AdpPlayer) -> int:
        av = _sort_value(a, key)
        bv = _sort_value(b, key)
        if av is None and bv is None:
            return (a.name.lower() > b.name.lower()) - (a.name.lower() < b.name.lower())
        if av is None:
            return 1
        if bv is None:
            return -1
        if av < bv:
            return -direction
        if av > bv:
            return direction
        return (a.name.lower() > b.name.lower()) - (a.name.lower() < b.name.lower())

    return sorted(players, key=cmp_to_key(cmp))


def is_three_rr_reverse(round_index: int) -> bool:
    """3RR: R2 and R3 are reverse; from R3 onward the board snakes."""
    if round_index <= 0:
        return False
    if round_index == 1:
        return True
    return round_index % 2 == 0


def three_rr_rounds(players: list[AdpPlayer], teams: int) -> list[list[AdpPlayer]]:
    rounds: list[list[AdpPlayer]] = []
    for i in range(0, len(players), teams):
        chunk = players[i : i + teams]
        rounds.append(list(reversed(chunk)) if is_three_rr_reverse(len(rounds)) else list(chunk))
    return rounds


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
    board: int = 0,
    ids: Optional[list[str]] = None,
) -> tuple[list[AdpPlayer], int, int, int, int]:
    if ids is not None:
        wanted = [i.strip() for i in ids if i and i.strip()][:_IDS_CAP]
        by_id = {p.id: p for p in players}
        page_players = [by_id[i] for i in wanted if i in by_id]
        return page_players, len(page_players), 1, 1, 0

    filtered = filter_players(
        players, q=q, team=team, positions=positions, ranked_only=ranked_only
    )
    if board in BOARD_SIZES:
        draftable = [p for p in filtered if p.blend is not None]
        ordered = sort_players(draftable, "blend", "asc")[: board * BOARD_ROUNDS]
        rounds = three_rr_rounds(ordered, board)
        rounds_per_page = max(1, round(page_size / board))
        paged_rounds, _round_total, safe_page, total_pages, start_round = _page_slice(
            rounds, page, rounds_per_page
        )
        flat = [p for rnd in paged_rounds for p in rnd]
        offset = sum(len(rnd) for rnd in rounds[:start_round])
        return flat, len(ordered), safe_page, total_pages, offset

    ordered = sort_players(filtered, sort, sort_dir)
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
    board: int = 0,
    ids: Optional[list[str]] = None,
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
        board=board,
        ids=ids,
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
