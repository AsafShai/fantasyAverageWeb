"""Join live ADP payloads with NBA bios and compute Blend ranks."""

from __future__ import annotations

import asyncio
import logging
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.models.adp import AdpIndexResponse, AdpPlayer, AdpResponse, LastYearStats, SiteAdp
from app.models.nba_player_models import NbaPlayerBio
from app.models.player import StatTimePeriod
from app.config import settings
from app.services import nba_player_catalog
from app.services.adp_fetch import fetch_espn_projection_map, fetch_live_adp_payload
from app.services.adp_query import filter_players, paginated_response, team_abbrs, to_index_player
from app.services.db_service import DBService
from app.services.player_service import espn_season_string, get_season_anchor_date
from app.utils.name_matching import (
    clean_fantasy_scraped_name,
    fantasy_name_keys,
    lookup_catalog_espn_id,
)

logger = logging.getLogger(__name__)

SITES = ("espn", "fantrax", "sleeper")
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
_last_year_cache: Optional[tuple[str, dict[int, LastYearStats]]] = None
_last_year_cached_at: Optional[datetime] = None
_last_year_lock = asyncio.Lock()
_projection_cache: Optional[tuple[str, dict[int, LastYearStats]]] = None
_projection_cached_at: Optional[datetime] = None
_projection_lock = asyncio.Lock()


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
    adp: dict[str, Optional[float]], sites: Optional[tuple[str, ...]] = None
) -> Optional[float]:
    """Mean of non-null ADPs among `sites` (defaults to every site)."""
    keys = sites or SITES
    vals = [adp[site] for site in keys if adp.get(site) is not None]
    if not vals:
        return None
    return round(sum(vals) / len(vals), 2)


def compute_spread(
    adp: dict[str, Optional[float]], sites: Optional[tuple[str, ...]] = None
) -> Optional[float]:
    keys = sites or SITES
    vals = [adp[site] for site in keys if adp.get(site) is not None]
    if len(vals) < 2:
        return None
    return round(max(vals) - min(vals), 2)


def apply_visible_sites(
    players: list[AdpPlayer], sites: Optional[tuple[str, ...]]
) -> list[AdpPlayer]:
    """Recompute blend / spread / blend_rank from a site subset. Cached rows stay intact."""
    if not sites or set(sites) == set(SITES):
        return players
    blends: list[Optional[float]] = []
    spreads: list[Optional[float]] = []
    for p in players:
        adp = {site: getattr(p, site).adp for site in SITES}
        blends.append(compute_blend(adp, sites))
        spreads.append(compute_spread(adp, sites))
    ranks = assign_ranks(blends)
    return [
        p.model_copy(update={"blend": blend, "spread": spread, "blend_rank": rank})
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
            }
        )

    blends = [compute_blend(r["adp"]) for r in rows]
    spreads = [compute_spread(r["adp"]) for r in rows]
    blend_ranks = assign_ranks(blends)
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
                espn=SiteAdp(adp=row["adp"]["espn"], rank=site_ranks["espn"][i]),
                fantrax=SiteAdp(adp=row["adp"]["fantrax"], rank=site_ranks["fantrax"][i]),
                sleeper=SiteAdp(adp=row["adp"]["sleeper"], rank=site_ranks["sleeper"][i]),
                blend=blends[i],
                blend_rank=blend_ranks[i],
                spread=spreads[i],
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
    return AdpResponse(
        season_label=str(payload.get("seasonLabel") or payload.get("season_label") or "2025-26"),
        updated_at=str(payload.get("updatedAt") or payload.get("updated_at") or ""),
        sources={str(k): str(v) for k, v in sources.items()},
        players=players,
    )


def reset_adp_cache() -> None:
    global _cached, _cached_at, _last_year_cache, _last_year_cached_at
    global _projection_cache, _projection_cached_at
    _cached = None
    _cached_at = None
    _last_year_cache = None
    _last_year_cached_at = None
    _projection_cache = None
    _projection_cached_at = None


def _num(value, default: float = 0.0) -> float:
    try:
        x = float(value)
    except (TypeError, ValueError):
        return default
    if x != x:
        return default
    return x


def last_year_from_agg_row(row) -> Optional[LastYearStats]:
    data = dict(row) if not isinstance(row, dict) else row
    gp = int(_num(data.get("gp")))
    if gp <= 0:
        return None

    def per(key: str) -> float:
        return round(_num(data.get(key)) / gp, 1)

    return LastYearStats(
        gp=gp,
        fg_pct=round(_num(data.get("fg_pct")), 4),
        ft_pct=round(_num(data.get("ft_pct")), 4),
        ppg=per("pts"),
        rpg=per("reb"),
        apg=per("ast"),
        spg=per("stl"),
        bpg=per("blk"),
        three_pm=per("three_pm"),
    )


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


async def load_last_year_stats() -> tuple[str, dict[int, LastYearStats]]:
    """Per-game averages from the current app season (same window as the Players table)."""
    global _last_year_cache, _last_year_cached_at
    season = espn_season_string(settings.season_id)
    now = datetime.now(timezone.utc)
    cached = _last_year_cache
    if cached is not None and cached[0] == season and _cache_fresh(_last_year_cached_at, now):
        return cached
    async with _last_year_lock:
        now = datetime.now(timezone.utc)
        cached = _last_year_cache
        if cached is not None and cached[0] == season and _cache_fresh(_last_year_cached_at, now):
            return cached
        try:
            db = DBService()
            anchor = await get_season_anchor_date(season, db)
            start, end = StatTimePeriod.resolve_window(
                StatTimePeriod.SEASON, None, None, settings.season_start, today=anchor
            )
            df, _, _ = await db.aggregate_player_games(start, end, season)
        except Exception:
            logger.exception("Last-year stats load failed")
            if cached is not None and cached[0] == season:
                return cached
            return (season, {})
        if df is None:
            logger.warning("Last-year aggregate returned no frame; not caching empty result")
            if cached is not None and cached[0] == season:
                return cached
            return (season, {})
        by_id: dict[int, LastYearStats] = {}
        if not df.empty:
            for _, row in df.iterrows():
                try:
                    espn_id = int(row["player_id"])
                except (TypeError, ValueError, KeyError):
                    continue
                stats = last_year_from_agg_row(row)
                if stats is not None:
                    by_id[espn_id] = stats
        _last_year_cache = (season, by_id)
        _last_year_cached_at = now
        logger.info("Loaded last-year stats for %d players (%s)", len(by_id), season)
        return _last_year_cache


async def load_espn_projections() -> tuple[str, dict[int, LastYearStats]]:
    """Next-season ESPN projections; falls back to this season's projection split if needed."""
    global _projection_cache, _projection_cached_at
    next_id = settings.season_id + 1
    next_label = espn_season_string(next_id)
    now = datetime.now(timezone.utc)
    if _projection_cache is not None and _cache_fresh(_projection_cached_at, now):
        return _projection_cache

    async def _fetch(season_id: int) -> dict[int, LastYearStats]:
        raw = await fetch_espn_projection_map(season_id)
        return {espn_id: LastYearStats(**row) for espn_id, row in raw.items()}

    async with _projection_lock:
        now = datetime.now(timezone.utc)
        if _projection_cache is not None and _cache_fresh(_projection_cached_at, now):
            return _projection_cache
        by_id: dict[int, LastYearStats] = {}
        label = next_label
        try:
            by_id = await _fetch(next_id)
            if not by_id:
                by_id = await _fetch(settings.season_id)
                if by_id:
                    label = espn_season_string(settings.season_id)
        except Exception:
            logger.exception("ESPN projection fetch failed")
            if _projection_cache is not None:
                return _projection_cache
            return (next_label, {})
        if not by_id:
            logger.warning("ESPN projection fetch returned empty; not caching")
            if _projection_cache is not None:
                return _projection_cache
            return (label, {})
        _projection_cache = (label, by_id)
        _projection_cached_at = now
        logger.info("Loaded ESPN projections for %d players (%s)", len(by_id), label)
        return _projection_cache


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
) -> AdpResponse:
    base = await get_adp_response()
    # ids fetches (rankings hydrate) always keep the all-sites Blend.
    if ids is None:
        subset = apply_visible_sites(base.players, parse_sites(sites))
        if subset is not base.players:
            base = base.model_copy(update={"players": subset})
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
    )
    (last_season, last_by_id), (proj_season, proj_by_id) = await asyncio.gather(
        load_last_year_stats(),
        load_espn_projections(),
    )
    out = sliced.model_copy(update={"last_year_season": last_season, "projection_season": proj_season})
    if last_by_id:
        out = apply_last_year_stats(out, last_by_id, last_season)
    if proj_by_id:
        out = apply_projection_stats(out, proj_by_id, proj_season)
    return out


async def get_adp_index_response(*, ranked_only: bool = True) -> AdpIndexResponse:
    base = await get_adp_response()
    players = filter_players(base.players, ranked_only=ranked_only)
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
            payload = await fetch_live_adp_payload()
            response = build_adp_response(payload)
            _cached = response
            _cached_at = now
            return response
        except Exception:
            if _cached is not None:
                logger.exception("Live ADP refresh failed; serving previous snapshot")
                return _cached
            raise
