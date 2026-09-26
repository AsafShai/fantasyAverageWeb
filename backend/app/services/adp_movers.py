"""Biggest ADP / rankings risers and fallers between two stored snapshots.

Two ways to pick what is compared:

* ``range`` -- each site's state on ``from_date`` against its state on ``to_date`` (the
  latest snapshot on or before each day). Suits ADP, which moves every day.
* ``last_update`` -- each site's latest version of the metric against the version just
  before it, whenever that was. Suits rankings, which a site republishes every week or
  two: a fixed 3-day window would usually show nothing.

A snapshot payload is rebuilt through the same assemble/build path as the live board, so
players are matched across sites and dates exactly as the ADP page matches them.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Callable, Optional

from app.models.adp import (
    AdpMover,
    AdpMoversResponse,
    AdpMoversSection,
    AdpPlayer,
    AdpSnapshotHistory,
    AdpTrendResponse,
)
from app.services import adp_snapshots
from app.services.adp_fetch import PROVIDER_CAPABILITIES, PROVIDER_LABELS, assemble_adp_payload
from app.services.adp_service import SITES, build_adp_response, parse_metric, parse_sites
from app.services.adp_snapshots import SnapshotMeta

MODES = ("range", "last_update")
DEFAULT_RANGE_DAYS = 3
DEFAULT_LIMIT = 10
MAX_LIMIT = 50
# Below this a move is rounding noise (ADP is published to one or two decimals).
MIN_DELTA = 0.05
_STATE_CACHE_SIZE = 12
# ESPN parks hundreds of undrafted players just under its 140 sentinel (357 players at
# 139.0-139.99 on 2026-09-26). A slide onto that floor means "went undrafted", so for
# movement it counts as leaving the list, not as a -8 faller crowding out real ones.
ESPN_ADP_FLOOR = 139.5

State = dict[str, AdpPlayer]
PairFn = Callable[[Optional[AdpPlayer], Optional[AdpPlayer]], tuple[Optional[float], Optional[float]]]

_states: dict[tuple[tuple[str, date], ...], State] = {}


def reset_movers_cache() -> None:
    _states.clear()


def today_utc() -> date:
    return datetime.now(timezone.utc).date()


def capable_sites(metric: str) -> tuple[str, ...]:
    cap = "adp" if metric == "adp" else "rankings"
    return tuple(site for site in SITES if PROVIDER_CAPABILITIES.get(site, {}).get(cap))


def resolve_sites(metric: str, raw: Optional[str]) -> tuple[str, ...]:
    """Selected sites that carry `metric`, in canonical order; none valid means all of them."""
    capable = capable_sites(metric)
    wanted = parse_sites(raw) or capable
    chosen = tuple(site for site in capable if site in wanted)
    return chosen or capable


def parse_mode(raw: Optional[str]) -> str:
    return "last_update" if (raw or "").strip().lower() in {"last_update", "update", "latest"} else "range"


def _hash(meta: SnapshotMeta, metric: str) -> str:
    return meta.adp_hash if metric == "adp" else meta.ranking_hash


def change_indices(timeline: list[SnapshotMeta], metric: str) -> list[int]:
    """Positions in `timeline` where `metric` differs from the snapshot before it."""
    return [
        i
        for i in range(1, len(timeline))
        if _hash(timeline[i], metric) != _hash(timeline[i - 1], metric)
    ]


def as_of(timeline: list[SnapshotMeta], day: date) -> Optional[SnapshotMeta]:
    found = None
    for meta in timeline:
        if meta.snapshot_date > day:
            break
        found = meta
    return found


def site_value(player: Optional[AdpPlayer], site: str, metric: str) -> Optional[float]:
    if player is None:
        return None
    block = getattr(player, site)
    value = block.adp if metric == "adp" else block.ranking
    if value is None or (metric == "adp" and site == "espn" and value >= ESPN_ADP_FLOOR):
        return None
    return float(value)


def _mean(values: list[float]) -> Optional[float]:
    return round(sum(values) / len(values), 2) if values else None


def site_pair(site: str, metric: str) -> PairFn:
    def pair(before: Optional[AdpPlayer], after: Optional[AdpPlayer]):
        return site_value(before, site, metric), site_value(after, site, metric)

    return pair


def blend_pair(sites: tuple[str, ...], metric: str) -> PairFn:
    """Blend movement over only the sites that list the player at both ends.

    Averaging each end over whatever sites happen to list him would report a site joining
    or leaving the blend as movement: a 40 on one site plus a new 60 on another is a
    blend "fall" of 10 with nobody having moved.
    """

    def pair(before: Optional[AdpPlayer], after: Optional[AdpPlayer]):
        b = {s: site_value(before, s, metric) for s in sites}
        a = {s: site_value(after, s, metric) for s in sites}
        common = [s for s in sites if b[s] is not None and a[s] is not None]
        if common:
            return _mean([b[s] for s in common]), _mean([a[s] for s in common])  # type: ignore[misc]
        b_any = _mean([v for v in b.values() if v is not None])
        a_any = _mean([v for v in a.values() if v is not None])
        if b_any is not None and a_any is not None:
            return None, None  # listed at both ends, but never by the same site
        return b_any, a_any

    return pair


async def build_state(site_dates: dict[str, date]) -> State:
    """Players keyed by board id, from each site's snapshot on the given day."""
    key = tuple(sorted(site_dates.items()))
    cached = _states.get(key)
    if cached is not None:
        return cached
    fetched = {}
    for site, day in site_dates.items():
        payload = await adp_snapshots.load_payload(site, day)
        if payload:
            fetched[site] = (payload, "")
    if not fetched:
        return {}
    response = build_adp_response(assemble_adp_payload(fetched, season_label=""))
    state = {p.id: p for p in response.players}
    if len(_states) >= _STATE_CACHE_SIZE:
        _states.clear()
    _states[key] = state
    return state


def _mover(player: AdpPlayer, before: Optional[float], after: Optional[float]) -> AdpMover:
    delta = round(before - after, 2) if before is not None and after is not None else None
    return AdpMover(
        id=player.id,
        espn_id=player.espn_id,
        name=player.name,
        team_abbr=player.team_abbr,
        photo_url=player.photo_url,
        positions=player.positions,
        from_value=before,
        to_value=after,
        delta=delta,
    )


def compare_states(
    before_state: State,
    after_state: State,
    pair: PairFn,
    *,
    top: Optional[int],
    limit: int,
) -> dict:
    """Risers / fallers / entered / exited between two states.

    `top` keeps a player only if he was inside it at either end, so the lists are not
    swamped by deep-bench noise (a 230 -> 225 Fantrax move matters to nobody).
    """
    movers: list[AdpMover] = []
    entered: list[AdpMover] = []
    exited: list[AdpMover] = []
    compared = 0

    def within(value: Optional[float]) -> bool:
        return value is not None and (top is None or value <= top)

    for pid in before_state.keys() | after_state.keys():
        b_player = before_state.get(pid)
        a_player = after_state.get(pid)
        before, after = pair(b_player, a_player)
        player = a_player or b_player
        assert player is not None
        if before is not None and after is not None:
            compared += 1
            if abs(before - after) < MIN_DELTA or not (within(before) or within(after)):
                continue
            movers.append(_mover(player, before, after))
        elif after is not None and within(after):
            entered.append(_mover(player, None, after))
        elif before is not None and within(before):
            exited.append(_mover(player, before, None))

    by_name = lambda m: m.name.lower()  # noqa: E731 - stable tiebreak
    risers = sorted((m for m in movers if (m.delta or 0) > 0), key=lambda m: (-(m.delta or 0), by_name(m)))
    fallers = sorted((m for m in movers if (m.delta or 0) < 0), key=lambda m: ((m.delta or 0), by_name(m)))
    entered.sort(key=lambda m: (m.to_value or 0, by_name(m)))
    exited.sort(key=lambda m: (m.from_value or 0, by_name(m)))
    return {
        "compared": compared,
        "risers": risers[:limit],
        "fallers": fallers[:limit],
        "entered": entered[:limit],
        "exited": exited[:limit],
    }


def _timelines(metas: list[SnapshotMeta]) -> dict[str, list[SnapshotMeta]]:
    out: dict[str, list[SnapshotMeta]] = {}
    for meta in metas:
        out.setdefault(meta.provider, []).append(meta)
    for rows in out.values():
        rows.sort(key=lambda m: m.snapshot_date)
    return out


def _history(site: str, timeline: list[SnapshotMeta], metric: str) -> AdpSnapshotHistory:
    return AdpSnapshotHistory(
        key=site,
        label=PROVIDER_LABELS.get(site, site.title()),
        first_date=timeline[0].snapshot_date.isoformat() if timeline else None,
        last_date=timeline[-1].snapshot_date.isoformat() if timeline else None,
        change_dates=[timeline[i].snapshot_date.isoformat() for i in change_indices(timeline, metric)],
    )


def _metric_word(metric: str) -> str:
    return "ADP" if metric == "adp" else "rankings"


def _range_endpoints(
    timeline: list[SnapshotMeta], metric: str, from_day: date, to_day: date
) -> tuple[Optional[SnapshotMeta], Optional[SnapshotMeta], Optional[str]]:
    """(from snapshot, to snapshot, note). A missing endpoint means nothing to compare."""
    after = as_of(timeline, to_day)
    if after is None:
        return None, None, "No history recorded for this period yet."
    before = as_of(timeline, from_day)
    note = None
    if before is None:
        before = timeline[0]
        note = f"History starts {before.snapshot_date.isoformat()}."
    if before.snapshot_date >= after.snapshot_date:
        return None, None, "Only one snapshot in this period so far. Check back tomorrow."
    if _hash(before, metric) == _hash(after, metric):
        return before, after, f"No {_metric_word(metric)} change in this period."
    return before, after, note


async def get_movers(
    *,
    metric: str = "adp",
    sites: Optional[str] = None,
    mode: Optional[str] = None,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    top: Optional[int] = 150,
    limit: int = DEFAULT_LIMIT,
) -> AdpMoversResponse:
    metric = parse_metric(metric)
    resolved_mode = parse_mode(mode)
    chosen = resolve_sites(metric, sites)
    limit = max(1, min(limit, MAX_LIMIT))
    top = top if top and top > 0 else None
    timelines = _timelines(await adp_snapshots.list_snapshots())
    history = [_history(site, timelines.get(site, []), metric) for site in chosen]

    if resolved_mode == "last_update":
        return AdpMoversResponse(
            metric=metric,
            mode=resolved_mode,
            top=top,
            sections=[
                await _last_update_section(site, timelines.get(site, []), metric, top, limit)
                for site in chosen
            ],
            history=history,
        )

    to_day = to_date or today_utc()
    from_day = from_date or (to_day - timedelta(days=DEFAULT_RANGE_DAYS))
    if from_day >= to_day:
        raise ValueError("from_date must be before to_date")

    sections: list[AdpMoversSection] = []
    ends: dict[str, tuple[SnapshotMeta, SnapshotMeta]] = {}
    for site in chosen:
        before, after, note = _range_endpoints(timelines.get(site, []), metric, from_day, to_day)
        section = AdpMoversSection(
            key=site,
            label=PROVIDER_LABELS.get(site, site.title()),
            from_date=before.snapshot_date.isoformat() if before else None,
            to_date=after.snapshot_date.isoformat() if after else None,
            note=note,
        )
        if before is not None and after is not None:
            ends[site] = (before, after)
            if _hash(before, metric) != _hash(after, metric):
                result = compare_states(
                    await build_state({site: before.snapshot_date}),
                    await build_state({site: after.snapshot_date}),
                    site_pair(site, metric),
                    top=top,
                    limit=limit,
                )
                section = section.model_copy(update=result)
        sections.append(section)

    if len(chosen) > 1:
        sections.insert(0, await _blend_section(chosen, ends, metric, top, limit))

    return AdpMoversResponse(
        metric=metric,
        mode=resolved_mode,
        from_date=from_day.isoformat(),
        to_date=to_day.isoformat(),
        top=top,
        sections=sections,
        history=history,
    )


async def _blend_section(
    chosen: tuple[str, ...],
    ends: dict[str, tuple[SnapshotMeta, SnapshotMeta]],
    metric: str,
    top: Optional[int],
    limit: int,
) -> AdpMoversSection:
    label = "Blend"
    if len(ends) < 2:
        return AdpMoversSection(
            key="blend",
            label=label,
            note="Blend needs history from at least two of the selected sites.",
        )
    used = tuple(site for site in chosen if site in ends)
    result = compare_states(
        await build_state({site: ends[site][0].snapshot_date for site in used}),
        await build_state({site: ends[site][1].snapshot_date for site in used}),
        blend_pair(used, metric),
        top=top,
        limit=limit,
    )
    return AdpMoversSection(
        key="blend",
        label=label,
        from_date=min(ends[s][0].snapshot_date for s in used).isoformat(),
        to_date=max(ends[s][1].snapshot_date for s in used).isoformat(),
        note=None if len(used) == len(chosen) else f"Blend of {', '.join(PROVIDER_LABELS[s] for s in used)}.",
        **result,
    )


async def _last_update_section(
    site: str,
    timeline: list[SnapshotMeta],
    metric: str,
    top: Optional[int],
    limit: int,
) -> AdpMoversSection:
    label = PROVIDER_LABELS.get(site, site.title())
    changes = change_indices(timeline, metric)
    if not changes:
        since = f" since {timeline[0].snapshot_date.isoformat()}" if timeline else ""
        return AdpMoversSection(
            key=site,
            label=label,
            note=f"No {_metric_word(metric)} update recorded{since} yet.",
        )
    i = changes[-1]
    before, after = timeline[i - 1], timeline[i]
    result = compare_states(
        await build_state({site: before.snapshot_date}),
        await build_state({site: after.snapshot_date}),
        site_pair(site, metric),
        top=top,
        limit=limit,
    )
    return AdpMoversSection(
        key=site,
        label=label,
        from_date=before.snapshot_date.isoformat(),
        to_date=after.snapshot_date.isoformat(),
        **result,
    )


async def get_trend(
    *,
    metric: str = "adp",
    sites: Optional[str] = None,
    days: int = 7,
) -> AdpTrendResponse:
    """Per-player Blend change over the last `days`, for trend badges on the board."""
    metric = parse_metric(metric)
    chosen = resolve_sites(metric, sites)
    days = max(1, min(days, 60))
    to_day = today_utc()
    from_day = to_day - timedelta(days=days)
    timelines = _timelines(await adp_snapshots.list_snapshots())
    ends: dict[str, tuple[SnapshotMeta, SnapshotMeta]] = {}
    for site in chosen:
        before, after, _note = _range_endpoints(timelines.get(site, []), metric, from_day, to_day)
        if before is not None and after is not None:
            ends[site] = (before, after)
    if not ends:
        return AdpTrendResponse(metric=metric, days=days)
    used = tuple(site for site in chosen if site in ends)
    before_state = await build_state({s: ends[s][0].snapshot_date for s in used})
    after_state = await build_state({s: ends[s][1].snapshot_date for s in used})
    pair = blend_pair(used, metric)
    deltas: dict[str, float] = {}
    for pid in before_state.keys() & after_state.keys():
        before, after = pair(before_state[pid], after_state[pid])
        if before is None or after is None:
            continue
        delta = round(before - after, 1)
        if delta:
            deltas[pid] = delta
    return AdpTrendResponse(
        metric=metric,
        days=days,
        from_date=min(ends[s][0].snapshot_date for s in used).isoformat(),
        to_date=max(ends[s][1].snapshot_date for s in used).isoformat(),
        deltas=deltas,
    )
