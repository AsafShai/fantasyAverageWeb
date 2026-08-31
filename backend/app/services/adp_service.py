"""Join live ADP payloads with NBA bios and compute Blend ranks."""

from __future__ import annotations

import asyncio
import logging
import re
import unicodedata
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from app.models.adp import (
    AdpIndexResponse,
    AdpPlayer,
    AdpResponse,
    LastYearStats,
    ProviderMeta,
    SiteAdp,
)
from app.models.nba_player_models import NbaPlayerBio
from app.config import settings
from app.services import adp_cache, nba_player_catalog
from app.services.adp_fetch import fetch_espn_stat_splits_map, fetch_live_adp_payload
from app.services.adp_query import (
    filter_players,
    paginated_response,
    sort_players,
    team_abbrs,
    to_index_player,
)
from app.services.player_service import espn_season_string
from app.utils.name_matching import (
    clean_fantasy_scraped_name,
    fantasy_name_keys,
    lookup_catalog_espn_id,
)

logger = logging.getLogger(__name__)

SITES = ("espn", "fantrax", "sleeper", "yahoo")
METRICS = ("adp", "rank")
# Which AdpPlayer fields each metric owns. ADP and rankings live on different scales
# (picks 1-130 vs list positions 1-832), so their blends are computed separately and
# never averaged together.
_METRIC_FIELDS = {
    "adp": ("blend", "blend_rank", "spread"),
    "rank": ("ranking_blend", "ranking_blend_rank", "ranking_spread"),
}
_CACHE_TTL = timedelta(minutes=30)

_SUFFIX_RE = re.compile(r"\b(jr|sr|ii|iii|iv|v)\.?$", re.IGNORECASE)
_CATALOG_POS = {
    "point guard": ["PG"],
    "shooting guard": ["SG"],
    "small forward": ["SF"],
    "power forward": ["PF"],
    "center": ["C"],
    "guard": ["PG", "SG"],
    "forward": ["SF", "PF"],
}

_cached: Optional[AdpResponse] = None
_cached_at: Optional[datetime] = None
_refresh_lock = asyncio.Lock()
# (actual_label, actual_by_espn_id, projection_label, projection_by_espn_id) -- both splits
# come from one ESPN request (see fetch_espn_stat_splits), so one cache entry covers both.
_espn_stats_cache: Optional[tuple[str, dict[int, LastYearStats], str, dict[int, LastYearStats]]] = None
_espn_stats_cached_at: Optional[datetime] = None
_espn_stats_lock = asyncio.Lock()
# Recomputed site-subset blends keyed by the live player-list identity + site params.
_blend_cache: dict[tuple[int, Optional[str], Optional[str]], list[AdpPlayer]] = {}


def _cache_fresh(cached_at: Optional[datetime], now: Optional[datetime] = None) -> bool:
    if cached_at is None:
        return False
    stamp = now or datetime.now(timezone.utc)
    return stamp - cached_at < _CACHE_TTL


def normalize_player_name(name: str) -> str:
    """Lowercase, strip accents/punctuation/suffixes for fuzzy matching."""
    if not name or not isinstance(name, str):
        return ""
    cleaned = clean_fantasy_scraped_name(name)
    if not cleaned:
        return ""
    s = unicodedata.normalize("NFKD", cleaned)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower().replace(".", "").replace("'", "").replace("-", " ")
    s = re.sub(r"[^a-z0-9 ]", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    s = _SUFFIX_RE.sub("", s).strip()
    return s


def parse_metric(raw: Optional[str]) -> str:
    """`adp` unless the caller explicitly asks for `rank`."""
    return "rank" if (raw or "").strip().lower() in {"rank", "ranking", "rankings"} else "adp"


def parse_sites(raw: Optional[str]) -> Optional[tuple[str, ...]]:
    """Known site keys from a comma list. Empty or unknown-only → None (all sites)."""
    if not raw:
        return None
    wanted: list[str] = []
    seen: set[str] = set()
    for part in raw.split(","):
        key = part.strip().lower()
        if key in SITES and key not in seen:
            wanted.append(key)
            seen.add(key)
    return tuple(wanted) if wanted else None


def compute_blend(
    values: dict[str, Optional[float]], sites: Optional[tuple[str, ...]] = None
) -> Optional[float]:
    """Mean of the non-null values among `sites` (defaults to every site).

    A single listing site is still a Blend of one -- Spread is what signals that it is
    unaveraged.
    """
    keys = sites or SITES
    vals = [values[site] for site in keys if values.get(site) is not None]
    if not vals:
        return None
    return round(sum(vals) / len(vals), 2)


def compute_spread(
    values: dict[str, Optional[float]], sites: Optional[tuple[str, ...]] = None
) -> Optional[float]:
    keys = sites or SITES
    vals = [values[site] for site in keys if values.get(site) is not None]
    if len(vals) < 2:
        return None
    return round(max(vals) - min(vals), 2)


def _metric_values(player: AdpPlayer, metric: str) -> dict[str, Optional[float]]:
    attr = "adp" if metric == "adp" else "ranking"
    return {site: getattr(getattr(player, site), attr) for site in SITES}


def apply_visible_sites(
    players: list[AdpPlayer], sites: Optional[tuple[str, ...]], metric: str = "adp"
) -> list[AdpPlayer]:
    """Recompute one metric's blend / spread / blend rank from a site subset.

    The other metric's fields are left exactly as built, so a caller can narrow the ADP
    blend without disturbing the rankings blend the same row carries.
    """
    if not sites or set(sites) == set(SITES):
        return players
    blend_field, rank_field, spread_field = _METRIC_FIELDS[metric]
    blends: list[Optional[float]] = []
    spreads: list[Optional[float]] = []
    for p in players:
        values = _metric_values(p, metric)
        blends.append(compute_blend(values, sites))
        spreads.append(compute_spread(values, sites))
    ranks = assign_ranks(blends)
    return [
        p.model_copy(update={blend_field: blend, spread_field: spread, rank_field: rank})
        for p, blend, spread, rank in zip(players, blends, spreads, ranks)
    ]


def assign_ranks(values: list[Optional[float]]) -> list[Optional[int]]:
    """Rank by ascending ADP. None sorts last and stays unranked."""
    indexed = [(i, v) for i, v in enumerate(values) if v is not None]
    indexed.sort(key=lambda pair: pair[1])
    ranks: list[Optional[int]] = [None] * len(values)
    for order, (i, _v) in enumerate(indexed, start=1):
        ranks[i] = order
    return ranks


def _positions_from_catalog(bio: Optional[NbaPlayerBio]) -> list[str]:
    if bio is None or not bio.position:
        return []
    return list(_CATALOG_POS.get(bio.position.strip().lower(), []))


def _coerce_ranking(raw) -> Optional[int]:
    val = _coerce_adp(raw)
    return int(round(val)) if val is not None else None


def _coerce_adp(raw) -> Optional[float]:
    if raw is None:
        return None
    try:
        val = float(raw)
    except (TypeError, ValueError):
        return None
    if val != val or val <= 0:  # NaN or non-positive
        return None
    return round(val, 2)


def _player_id(espn_id: Optional[int], name: str) -> str:
    if espn_id is not None:
        return str(espn_id)
    key = normalize_player_name(name) or name.lower().strip()
    return f"name:{key}"


def _name_index(bios: dict[int, NbaPlayerBio]) -> dict[str, int]:
    index: dict[str, int] = {}
    for espn_id, bio in bios.items():
        key = normalize_player_name(bio.display_name)
        if key and key not in index:
            index[key] = espn_id
    return index


def _index_name_keys(by_name: dict[str, dict], key: str, row: dict) -> None:
    for alias_key in fantasy_name_keys(key):
        by_name[alias_key] = row


def _lookup_existing(
    merged_by_id: dict[int, dict],
    merged_by_name: dict[str, dict],
    espn_id: Optional[int],
    key: str,
) -> Optional[dict]:
    if espn_id is not None:
        existing = merged_by_id.get(espn_id)
        if existing is not None:
            return existing
    if not key:
        return None
    for alias_key in fantasy_name_keys(key):
        existing = merged_by_name.get(alias_key)
        if existing is None:
            continue
        if (
            espn_id is not None
            and existing.get("espn_id") is not None
            and existing["espn_id"] != espn_id
        ):
            continue
        return existing
    return None


def _merge_adp_into(dest: dict, incoming: dict) -> None:
    for site in SITES:
        if dest["adp"][site] is None and incoming["adp"][site] is not None:
            dest["adp"][site] = incoming["adp"][site]
        if dest["ranking"][site] is None and incoming["ranking"][site] is not None:
            dest["ranking"][site] = incoming["ranking"][site]
    if not dest["positions"] and incoming["positions"]:
        dest["positions"] = list(incoming["positions"])
    incoming_has_bio = incoming["bio"] is not None
    dest_has_bio = dest["bio"] is not None
    if incoming_has_bio and not dest_has_bio:
        dest["bio"] = incoming["bio"]
        dest["name"] = incoming["name"]
        dest["espn_id"] = incoming["espn_id"] or dest["espn_id"]
        if incoming["positions"]:
            dest["positions"] = list(incoming["positions"])
    elif incoming["espn_id"] is not None and dest["espn_id"] is None:
        dest["espn_id"] = incoming["espn_id"]
        if incoming_has_bio:
            dest["bio"] = incoming["bio"]
            dest["name"] = incoming["name"]
            if incoming["positions"] and not dest["positions"]:
                dest["positions"] = list(incoming["positions"])
    elif dest["bio"] is None and incoming["name"] and (
        not dest["name"] or len(incoming["name"]) > len(dest["name"])
    ):
        dest["name"] = incoming["name"]


def _upsert_adp_row(
    merged_by_id: dict[int, dict],
    merged_by_name: dict[str, dict],
    row: dict,
) -> None:
    key = normalize_player_name(row["name"])
    existing = _lookup_existing(merged_by_id, merged_by_name, row["espn_id"], key)
    if existing is None:
        if row["espn_id"] is not None:
            merged_by_id[row["espn_id"]] = row
        if key:
            _index_name_keys(merged_by_name, key, row)
        return
    _merge_adp_into(existing, row)
    if existing["espn_id"] is not None:
        merged_by_id[existing["espn_id"]] = existing
    existing_key = normalize_player_name(existing["name"])
    if existing_key:
        _index_name_keys(merged_by_name, existing_key, existing)
    if key:
        _index_name_keys(merged_by_name, key, existing)


def _unique_merged_rows(
    merged_by_id: dict[int, dict],
    merged_by_name: dict[str, dict],
) -> list[dict]:
    rows: list[dict] = []
    seen: set[int] = set()
    for row in list(merged_by_id.values()) + list(merged_by_name.values()):
        ident = id(row)
        if ident in seen:
            continue
        seen.add(ident)
        rows.append(row)
    return rows


def build_adp_response(
    payload: dict,
    bios_by_id: Optional[dict[int, NbaPlayerBio]] = None,
) -> AdpResponse:
    bios = bios_by_id if bios_by_id is not None else nba_player_catalog.list_all_bios()
    names = _name_index(bios)

    raw_players = payload.get("players") if isinstance(payload, dict) else None
    if not isinstance(raw_players, list):
        raw_players = []

    merged_by_id: dict[int, dict] = {}
    merged_by_name: dict[str, dict] = {}

    for raw in raw_players:
        if not isinstance(raw, dict):
            continue
        name = raw.get("name") or raw.get("displayName") or ""
        if not isinstance(name, str) or not name.strip():
            continue
        name = clean_fantasy_scraped_name(name.strip())
        if not name:
            continue

        espn_id = raw.get("espn_id")
        if espn_id is not None:
            try:
                espn_id = int(espn_id)
            except (TypeError, ValueError):
                espn_id = None
        if espn_id is None:
            espn_id = lookup_catalog_espn_id(normalize_player_name(name), names)

        adp_raw = raw.get("adp") if isinstance(raw.get("adp"), dict) else {}
        adp = {site: _coerce_adp(adp_raw.get(site)) for site in SITES}
        ranking_raw = raw.get("ranking") if isinstance(raw.get("ranking"), dict) else {}
        ranking = {site: _coerce_ranking(ranking_raw.get(site)) for site in SITES}

        stored_pos = raw.get("positions")
        positions: list[str] = []
        if isinstance(stored_pos, list):
            positions = [str(p).strip().upper() for p in stored_pos if str(p).strip()]

        bio = bios.get(espn_id) if espn_id is not None else None
        if not positions:
            positions = _positions_from_catalog(bio)

        display_name = bio.display_name if bio else name
        _upsert_adp_row(
            merged_by_id,
            merged_by_name,
            {
                "espn_id": espn_id,
                "name": display_name,
                "bio": bio,
                "positions": positions,
                "adp": adp,
                "ranking": ranking,
            },
        )

    rows = _unique_merged_rows(merged_by_id, merged_by_name)
    used_ids = {row["espn_id"] for row in rows if row["espn_id"] is not None}

    # Catalog-only sleepers so pre-draft rankings can still order them.
    for espn_id, bio in bios.items():
        if espn_id in used_ids:
            continue
        rows.append(
            {
                "espn_id": espn_id,
                "name": bio.display_name,
                "bio": bio,
                "positions": _positions_from_catalog(bio),
                "adp": {site: None for site in SITES},
                "ranking": {site: None for site in SITES},
            }
        )

    blends = [compute_blend(r["adp"]) for r in rows]
    spreads = [compute_spread(r["adp"]) for r in rows]
    blend_ranks = assign_ranks(blends)
    ranking_blends = [compute_blend(r["ranking"]) for r in rows]
    ranking_spreads = [compute_spread(r["ranking"]) for r in rows]
    ranking_blend_ranks = assign_ranks(ranking_blends)
    site_ranks = {site: assign_ranks([r["adp"][site] for r in rows]) for site in SITES}

    players: list[AdpPlayer] = []
    for i, row in enumerate(rows):
        bio: Optional[NbaPlayerBio] = row["bio"]
        espn_id = row["espn_id"]
        players.append(
            AdpPlayer(
                id=_player_id(espn_id, row["name"]),
                espn_id=espn_id,
                name=row["name"],
                team=bio.team if bio else None,
                team_abbr=bio.team_abbr if bio else None,
                photo_url=bio.photo_url if bio else None,
                positions=row["positions"],
                **{
                    site: SiteAdp(
                        adp=row["adp"][site],
                        rank=site_ranks[site][i],
                        ranking=row["ranking"][site],
                    )
                    for site in SITES
                },
                blend=blends[i],
                blend_rank=blend_ranks[i],
                spread=spreads[i],
                ranking_blend=ranking_blends[i],
                ranking_blend_rank=ranking_blend_ranks[i],
                ranking_spread=ranking_spreads[i],
            )
        )

    players.sort(
        key=lambda p: (
            p.blend_rank is None,
            p.blend_rank if p.blend_rank is not None else 10_000,
            p.name.lower(),
        )
    )

    sources = payload.get("sources") if isinstance(payload.get("sources"), dict) else {}
    raw_providers = payload.get("providers") if isinstance(payload.get("providers"), list) else []
    providers = [ProviderMeta(**meta) for meta in raw_providers if isinstance(meta, dict)]
    return AdpResponse(
        season_label=str(payload.get("seasonLabel") or payload.get("season_label") or "2025-26"),
        updated_at=str(payload.get("updatedAt") or payload.get("updated_at") or ""),
        sources={str(k): str(v) for k, v in sources.items()},
        providers=providers,
        players=players,
    )


async def refresh_adp_sources(provider: Optional[str] = None) -> list[ProviderMeta]:
    """Drop cached source payloads and rebuild, returning the refreshed provider metas."""
    if provider is not None and provider not in SITES:
        raise ValueError(f"Unknown provider '{provider}'")
    global _cached, _cached_at
    await adp_cache.invalidate(provider)
    async with _refresh_lock:
        _cached = None
        _cached_at = None
    return (await get_adp_response()).providers


CURATED_RANK_SITES = ("espn", "yahoo")


def mark_fringe(
    response: AdpResponse, actuals_by_espn_id: dict[int, LastYearStats]
) -> AdpResponse:
    """Flag players who are out of the league rather than merely undrafted.

    Three signals have to agree before a player is called fringe, because each one alone
    has a false positive: rookies have no games, free agents have no team mid-summer, and
    the deepest source (Sleeper, 829 players) lists G-League and overseas players a curated
    list would not. Anyone with last-season games, a current NBA team, a real ADP, or a spot
    on ESPN's or Yahoo's own list is kept.

    Measured 2026-08-25: 264 of 942 ranked players match, none shallower than Sleeper #201,
    and none of them played a game last season.
    """
    players = []
    for p in response.players:
        played = p.espn_id in actuals_by_espn_id and actuals_by_espn_id[p.espn_id].gp > 0
        curated = any(getattr(p, site).ranking is not None for site in CURATED_RANK_SITES)
        drafted = any(getattr(p, site).adp is not None for site in SITES)
        players.append(
            p.model_copy(
                update={"fringe": not (played or curated or drafted or bool(p.team_abbr))}
            )
        )
    return response.model_copy(update={"players": players})


def reset_adp_cache() -> None:
    global _cached, _cached_at, _espn_stats_cache, _espn_stats_cached_at
    _cached = None
    _cached_at = None
    _espn_stats_cache = None
    _espn_stats_cached_at = None
    _blend_cache.clear()
    adp_cache.reset_provider_cache()



def apply_last_year_stats(
    response: AdpResponse,
    by_espn_id: dict[int, LastYearStats],
    last_year_season: Optional[str] = None,
) -> AdpResponse:
    players = [
        p.model_copy(update={"last_year": by_espn_id.get(p.espn_id) if p.espn_id is not None else None})
        for p in response.players
    ]
    return response.model_copy(update={"players": players, "last_year_season": last_year_season})


def apply_projection_stats(
    response: AdpResponse,
    by_espn_id: dict[int, LastYearStats],
    projection_season: Optional[str] = None,
) -> AdpResponse:
    players = [
        p.model_copy(update={"projection": by_espn_id.get(p.espn_id) if p.espn_id is not None else None})
        for p in response.players
    ]
    return response.model_copy(update={"players": players, "projection_season": projection_season})


def resolve_adp_seasons() -> tuple[str, int, int]:
    """(actual stats season label, actual season's ESPN id, ESPN season_id to project).

    Before the app season tips off there are no games to average, so the draft board
    shows the previous season's actuals. Projections always track the season being
    played or drafted: ESPN only publishes a season once it opens, so season_id + 1
    would leave the toggle blank all year.
    """
    proj_id = settings.season_id
    started = date.today() >= settings.season_start
    actual_id = proj_id if started else proj_id - 1
    return (espn_season_string(actual_id), actual_id, proj_id)


async def load_espn_stat_splits() -> tuple[str, dict[int, LastYearStats], str, dict[int, LastYearStats]]:
    """(actual season label, actual per-game stats, projection season label, projections).

    Both splits come from a single ESPN request (see fetch_espn_stat_splits) -- there is no
    separate DB read for actuals. Projections stay empty until ESPN publishes them; that
    alone does not block caching the actuals half.
    """
    global _espn_stats_cache, _espn_stats_cached_at
    actual_label, actual_id, proj_id = resolve_adp_seasons()
    proj_label = espn_season_string(proj_id)
    now = datetime.now(timezone.utc)

    def _fresh(entry):
        return (
            entry is not None
            and entry[0] == actual_label
            and entry[2] == proj_label
            and _cache_fresh(_espn_stats_cached_at, now)
        )

    cached = _espn_stats_cache
    if _fresh(cached):
        assert cached is not None
        return cached
    async with _espn_stats_lock:
        now = datetime.now(timezone.utc)
        cached = _espn_stats_cache
        if _fresh(cached):
            assert cached is not None
            return cached
        try:
            raw_actual, raw_proj = await fetch_espn_stat_splits_map(
                actual_season_id=actual_id, proj_season_id=proj_id
            )
        except Exception:
            logger.exception("ESPN stat split fetch failed")
            if cached is not None:
                return cached
            return (actual_label, {}, proj_label, {})
        actual_by_id = {espn_id: LastYearStats(**row) for espn_id, row in raw_actual.items()}
        proj_by_id = {espn_id: LastYearStats(**row) for espn_id, row in raw_proj.items()}
        if not actual_by_id and not proj_by_id:
            logger.warning(
                "ESPN stat splits empty for actual=%s proj=%s; not caching", actual_label, proj_label
            )
            if cached is not None:
                return cached
            return (actual_label, {}, proj_label, {})
        fresh_entry = (actual_label, actual_by_id, proj_label, proj_by_id)
        _espn_stats_cache = fresh_entry
        _espn_stats_cached_at = now
        logger.info(
            "Loaded ESPN stat splits: %d actuals (%s), %d projections (%s)",
            len(actual_by_id),
            actual_label,
            len(proj_by_id),
            proj_label,
        )
        return fresh_entry


async def get_adp_response_enriched(
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
    sites: Optional[str] = None,
    rank_sites: Optional[str] = None,
    metric: str = "adp",
    include_fringe: bool = False,
    include_stats: bool = True,
) -> AdpResponse:
    base = await get_adp_response()
    metric = parse_metric(metric)
    # ids fetches (rankings hydrate) always keep the all-sites Blend.
    if ids is None:
        players = apply_blend_sites(base.players, sites=sites, rank_sites=rank_sites)
        if players is not base.players:
            base = base.model_copy(update={"players": players})
    sliced = paginated_response(
        base,
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
    if not include_stats:
        return sliced
    last_season, last_by_id, proj_season, proj_by_id = await load_espn_stat_splits()
    out = sliced.model_copy(update={"last_year_season": last_season, "projection_season": proj_season})
    if last_by_id:
        out = apply_last_year_stats(out, last_by_id, last_season)
    if proj_by_id:
        out = apply_projection_stats(out, proj_by_id, proj_season)
    return out


def apply_blend_sites(
    players: list[AdpPlayer],
    *,
    sites: Optional[str] = None,
    rank_sites: Optional[str] = None,
) -> list[AdpPlayer]:
    """Narrow each metric's blend to its own selected sites.

    The two selections are independent: the ADP view's checkboxes must never change the
    rankings blend the same rows carry, since the pre-draft board reads both at once to
    show a cross-metric delta.
    """
    key = (id(players), sites, rank_sites)
    cached = _blend_cache.get(key)
    if cached is not None:
        return cached
    out = apply_visible_sites(players, parse_sites(sites), "adp")
    out = apply_visible_sites(out, parse_sites(rank_sites), "rank")
    if len(_blend_cache) >= 24:
        _blend_cache.clear()
    _blend_cache[key] = out
    return out


async def get_adp_index_response(
    *,
    ranked_only: bool = True,
    sites: Optional[str] = None,
    rank_sites: Optional[str] = None,
    metric: str = "adp",
    include_fringe: bool = False,
) -> AdpIndexResponse:
    base = await get_adp_response()
    resolved = parse_metric(metric)
    players = apply_blend_sites(base.players, sites=sites, rank_sites=rank_sites)
    # Board membership is the union of both metrics: switching the order must not drop
    # players off a saved board, so a player ranked by either blend stays in the pool and
    # the sort puts whoever the active blend does not cover at the end.
    players = filter_players(
        players, ranked_only=ranked_only, metric="any", include_fringe=include_fringe
    )
    players = sort_players(players, "blend", "asc", resolved)
    return AdpIndexResponse(
        season_label=base.season_label,
        updated_at=base.updated_at,
        teams=team_abbrs(base.players),
        players=[to_index_player(p) for p in players],
        total=len(players),
    )


async def get_adp_response() -> AdpResponse:
    """Fetch ESPN/Fantrax/Sleeper ADP, cached for 30 minutes.

    If a refresh fails after a successful fetch, the last good response is kept.
    """
    global _cached, _cached_at
    now = datetime.now(timezone.utc)
    cached = _cached
    cached_at = _cached_at
    if cached is not None and cached_at is not None and now - cached_at < _CACHE_TTL:
        return cached
    async with _refresh_lock:
        now = datetime.now(timezone.utc)
        cached = _cached
        cached_at = _cached_at
        if cached is not None and cached_at is not None and now - cached_at < _CACHE_TTL:
            return cached
        try:
            payload, stats = await asyncio.gather(
                fetch_live_adp_payload(),
                load_espn_stat_splits(),
            )
            response = build_adp_response(payload)
            _actual_label, actuals, _proj_label, _proj = stats
            response = mark_fringe(response, actuals)
            _blend_cache.clear()
            _cached = response
            _cached_at = now
            return response
        except Exception:
            if _cached is not None:
                logger.exception("Live ADP refresh failed; serving previous snapshot")
                return _cached
            raise
