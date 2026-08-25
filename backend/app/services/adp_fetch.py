"""Live fantasy basketball ADP and rankings from ESPN, Sleeper, Fantrax, and Yahoo.

Two different numbers come out of these providers and they must not be confused:

* **ADP** -- what drafters actually did, an average pick number.
* **ranking** -- the provider's own published list order.

No provider has both for every player: Fantrax publishes ADP only, Sleeper rankings only.
Each row therefore carries both slots and either may be ``None``.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import NamedTuple, Optional

import httpx

from app.config import settings
from app.services import adp_cache
from app.services.player_service import espn_season_string

logger = logging.getLogger(__name__)

SITES = ("espn", "fantrax", "sleeper", "yahoo")
PROVIDER_LABELS = {"espn": "ESPN", "fantrax": "Fantrax", "sleeper": "Sleeper", "yahoo": "Yahoo"}
# What each provider actually publishes. Server-owned: the frontend reads it off the
# response rather than hardcoding "Fantrax has no rankings".
PROVIDER_CAPABILITIES = {
    "espn": {"adp": True, "rankings": True},
    "fantrax": {"adp": True, "rankings": False},
    "sleeper": {"adp": False, "rankings": True},
    "yahoo": {"adp": True, "rankings": True},
}
POSITION_MAP = {0: "PG", 1: "SG", 2: "SF", 3: "PF", 4: "C"}
_VALID_POS = {"PG", "SG", "SF", "PF", "C"}

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
}
_TIMEOUT = httpx.Timeout(30.0, connect=10.0)

class AdpRow(NamedTuple):
    espn_id: Optional[int]
    name: str
    adp: Optional[float]
    positions: list[str]
    ranking: Optional[int] = None


def coerce_ranking(raw) -> Optional[int]:
    val = coerce_adp(raw)
    return int(round(val)) if val is not None else None

# ESPN fantasy basketball stat ids (totals or averages, depending on the split).
_ESPN_PTS = "0"
_ESPN_BLK = "1"
_ESPN_STL = "2"
_ESPN_AST = "3"
_ESPN_REB = "6"
_ESPN_3PM = "17"
_ESPN_FG = "19"
_ESPN_FT = "20"
_ESPN_GP = "42"


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


# ESPN reports an averageDraftPosition for anyone drafted even once, and parks everyone else
# just under 140 -- measured 2026-08-25: 902 of 1095 values round to exactly 140 and only 141
# fall below 135. Those are the league default, not a pick number, and averaging them into a
# Blend buries the tail in identical values that then tie-break alphabetically.
_ESPN_UNDRAFTED_ADP = 135.0


def coerce_adp(raw) -> Optional[float]:
    if raw is None:
        return None
    if isinstance(raw, str):
        raw = raw.strip().replace(",", "")
        if raw in {"", "-", "—", "N/A", "NA"}:
            return None
    try:
        val = float(raw)
    except (TypeError, ValueError):
        return None
    if val != val or val <= 0:
        return None
    return round(val, 2)


def parse_espn_payload(data) -> list[AdpRow]:
    entries = data if isinstance(data, list) else (data.get("players") or [])
    rows: list[AdpRow] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        player = entry.get("player") or entry
        if not isinstance(player, dict):
            continue
        name = player.get("fullName") or player.get("name")
        pid = player.get("id") or entry.get("id")
        if not isinstance(name, str) or pid is None:
            continue
        try:
            espn_id = int(pid)
        except (TypeError, ValueError):
            continue
        ranks = player.get("draftRanksByRankType") or {}
        # ROTO, not STANDARD: this league is 8-cat roto and the two lists disagree materially
        # (e.g. Camara: STANDARD 115 vs ROTO 61).
        roto = ranks.get("ROTO") or ranks.get("roto") or {}
        ranking = coerce_ranking(roto.get("rank"))
        ownership = player.get("ownership")
        adp = coerce_adp(ownership.get("averageDraftPosition")) if isinstance(ownership, dict) else None
        if adp is not None and adp >= _ESPN_UNDRAFTED_ADP:
            adp = None
        if adp is None and ranking is None:
            continue
        slots = player.get("eligibleSlots") or []
        positions = [POSITION_MAP[s] for s in slots if s in POSITION_MAP]
        rows.append(AdpRow(espn_id, name.strip(), adp, positions, ranking))
    return rows


def _stat_num(block: dict, key: str) -> Optional[float]:
    if not isinstance(block, dict) or key not in block or block[key] is None:
        return None
    try:
        val = float(block[key])
    except (TypeError, ValueError):
        return None
    if val != val:
        return None
    return val


def _pct(value: Optional[float]) -> float:
    if value is None:
        return 0.0
    return round(value / 100.0 if value > 1 else value, 4)


def projection_from_stat_block(block: dict) -> Optional[dict]:
    """Turn an ESPN season-projection split into per-game averages."""
    if not isinstance(block, dict):
        return None
    totals = block.get("stats") if isinstance(block.get("stats"), dict) else {}
    avgs = block.get("averageStats") if isinstance(block.get("averageStats"), dict) else {}

    gp = _stat_num(totals, _ESPN_GP)
    if gp is None:
        gp = _stat_num(avgs, _ESPN_GP)
    if gp is None or gp <= 0:
        return None

    def per_game(key: str) -> float:
        avg = _stat_num(avgs, key)
        if avg is not None:
            return round(avg, 1)
        total = _stat_num(totals, key)
        return round((total or 0.0) / gp, 1)

    return {
        "gp": int(gp),
        "fg_pct": _pct(_stat_num(avgs, _ESPN_FG) if _stat_num(avgs, _ESPN_FG) is not None else _stat_num(totals, _ESPN_FG)),
        "ft_pct": _pct(_stat_num(avgs, _ESPN_FT) if _stat_num(avgs, _ESPN_FT) is not None else _stat_num(totals, _ESPN_FT)),
        "ppg": per_game(_ESPN_PTS),
        "rpg": per_game(_ESPN_REB),
        "apg": per_game(_ESPN_AST),
        "spg": per_game(_ESPN_STL),
        "bpg": per_game(_ESPN_BLK),
        "three_pm": per_game(_ESPN_3PM),
    }


def _matches_season_stat(stat: dict, season_id: int, id_prefix: str, source_id: int) -> bool:
    """ESPN tags each split with an id like "002026" (actual) or "102026" (projection) --
    prefix "00"/"10" -- and, when that id is absent, the same split can be found by
    statSourceId (0 actual, 1 projection) + seasonId + scoringPeriodId==0 (season total)."""
    if not isinstance(stat, dict):
        return False
    if str(stat.get("id") or "") == f"{id_prefix}{season_id}":
        return True
    return (
        stat.get("statSourceId") == source_id
        and stat.get("seasonId") == season_id
        and stat.get("scoringPeriodId") == 0
    )


def _parse_espn_stat_split(data, season_id: int, *, id_prefix: str, source_id: int) -> dict[int, dict]:
    entries = data if isinstance(data, list) else (data.get("players") or [])
    out: dict[int, dict] = {}
    if not isinstance(entries, list):
        return out
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        player = entry.get("player") or entry
        if not isinstance(player, dict):
            continue
        pid = player.get("id") or entry.get("id")
        try:
            espn_id = int(pid)
        except (TypeError, ValueError):
            continue
        chosen = None
        for stat in player.get("stats") or []:
            if _matches_season_stat(stat, season_id, id_prefix, source_id):
                chosen = stat
                break
        parsed = projection_from_stat_block(chosen) if chosen else None
        if parsed:
            out[espn_id] = parsed
    return out


def parse_espn_projections(data, season_id: int) -> dict[int, dict]:
    return _parse_espn_stat_split(data, season_id, id_prefix="10", source_id=1)


def parse_espn_actuals(data, season_id: int) -> dict[int, dict]:
    """Season-to-date per-game actuals -- same shape as parse_espn_projections, just the
    "00" (statSourceId 0) split instead of the "10" (statSourceId 1) projection split."""
    return _parse_espn_stat_split(data, season_id, id_prefix="00", source_id=0)


def parse_sleeper_payload(data) -> list[AdpRow]:
    if not isinstance(data, dict):
        raise ValueError("Sleeper players payload was not an object")
    rows: list[AdpRow] = []
    for rec in data.values():
        if not isinstance(rec, dict):
            continue
        if rec.get("sport") not in (None, "nba"):
            continue
        name = rec.get("full_name") or " ".join(
            p for p in [rec.get("first_name"), rec.get("last_name")] if isinstance(p, str)
        )
        if not name:
            continue
        espn_id = rec.get("espn_id")
        try:
            espn_id = int(espn_id) if espn_id is not None else None
        except (TypeError, ValueError):
            espn_id = None
        # search_rank is a ranking, not an ADP -- Sleeper publishes no draft data at all.
        ranking = coerce_ranking(rec.get("search_rank"))
        if ranking is not None and ranking >= 900:
            ranking = None
        if ranking is None:
            continue
        positions: list[str] = []
        fp = rec.get("fantasy_positions")
        if isinstance(fp, list):
            positions = [str(p).upper() for p in fp if str(p).upper() in _VALID_POS]
        rows.append(AdpRow(espn_id, name.strip(), None, positions, ranking))
    return rows


def parse_fantrax_payload(data) -> list[AdpRow]:
    if isinstance(data, dict):
        items = (
            data.get("adp")
            or data.get("players")
            or data.get("playerList")
            or data.get("data")
            or []
        )
        if isinstance(items, dict):
            items = list(items.values())
    elif isinstance(data, list):
        items = data
    else:
        items = []
    rows: list[AdpRow] = []
    for rec in items:
        if not isinstance(rec, dict):
            continue
        name = rec.get("name") or rec.get("playerName") or rec.get("fullName")
        if not isinstance(name, str):
            continue
        adp = coerce_adp(
            rec.get("adp") or rec.get("ADP") or rec.get("avgPick") or rec.get("averagePick")
        )
        if adp is None:
            continue
        rows.append(AdpRow(None, name.strip(), adp, [], None))
    return rows


def parse_yahoo_payload(entries) -> list[AdpRow]:
    """Rows from Yahoo's public game/players feed (`out=draft_analysis,ranks`).

    Missing values arrive as the string ``'-'`` interleaved with real ones -- that is a
    draft-frequency threshold, not the end of the list, so it maps to ``None`` rather than
    truncating the walk. Yahoo carries no ESPN id; these rows join by name like Fantrax.
    """
    rows: list[AdpRow] = []
    if not isinstance(entries, list):
        return rows
    for entry in entries:
        player = entry.get("player") if isinstance(entry, dict) else None
        if not isinstance(player, dict):
            continue
        name_block = player.get("name")
        name = name_block.get("full") if isinstance(name_block, dict) else None
        if not isinstance(name, str) or not name.strip():
            continue
        analysis = player.get("draft_analysis")
        adp = coerce_adp(analysis.get("average_pick")) if isinstance(analysis, dict) else None
        ranking = None
        for rank_entry in player.get("player_ranks") or []:
            block = rank_entry.get("player_rank") if isinstance(rank_entry, dict) else None
            if isinstance(block, dict) and block.get("rank_type") == "OR":
                ranking = coerce_ranking(block.get("rank_value"))
                break
        if adp is None and ranking is None:
            continue
        positions = [
            str(slot.get("position")).upper()
            for slot in player.get("eligible_positions") or []
            if isinstance(slot, dict) and str(slot.get("position")).upper() in _VALID_POS
        ]
        rows.append(AdpRow(None, name.strip(), adp, positions, ranking))
    return rows


def assemble_adp_payload(
    fetched: dict[str, tuple[list[AdpRow], str]],
    *,
    season_label: str,
    updated_at: Optional[str] = None,
    providers: Optional[list[dict]] = None,
) -> dict:
    players: list[dict] = []
    sources: dict[str, str] = {}
    for site in SITES:
        if site not in fetched:
            continue
        rows, label = fetched[site]
        sources[site] = label
        for row in rows:
            row = AdpRow(*row) if not isinstance(row, AdpRow) else row
            if not row.name or (row.adp is None and row.ranking is None):
                continue
            players.append(
                {
                    "espn_id": row.espn_id,
                    "name": row.name,
                    "positions": list(row.positions or []),
                    "adp": {site: row.adp} if row.adp is not None else {},
                    "ranking": {site: row.ranking} if row.ranking is not None else {},
                }
            )
    return {
        "seasonLabel": season_label,
        "updatedAt": updated_at or utc_now(),
        "sources": sources,
        "providers": providers or [],
        "players": players,
    }


async def _get_json(
    client: httpx.AsyncClient,
    url: str,
    headers: Optional[dict] = None,
) -> object:
    response = await client.get(url, headers=headers)
    response.raise_for_status()
    return response.json()


async def fetch_espn(client: httpx.AsyncClient, season_id: Optional[int] = None) -> tuple[list[AdpRow], str]:
    season_id = season_id if season_id is not None else settings.season_id
    filter_payload = json.dumps(
        {
            "players": {
                "filterStatsForTopScoringPeriodIds": {
                    "value": 1,
                    "additionalValue": [f"00{season_id}", f"10{season_id}"],
                },
                "sortDraftRanks": {"sortPriority": 1, "sortAsc": True, "value": "ROTO"},
                "limit": 1200,
            }
        }
    )
    urls = [
        (
            f"https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/"
            f"{season_id}/segments/0/leaguedefaults/1?view=kona_player_info"
        ),
        (
            f"https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/"
            f"{season_id}/players?scoringPeriodId=0&view=kona_player_info"
        ),
    ]
    extra = {"X-Fantasy-Filter": filter_payload}
    last_err: Optional[Exception] = None
    for url in urls:
        try:
            data = await _get_json(client, url, headers=extra)
            rows = parse_espn_payload(data)
            if rows:
                return rows, f"ESPN Fantasy ROTO draft ranks ({url})"
        except (httpx.HTTPError, json.JSONDecodeError, ValueError) as e:
            last_err = e
    raise RuntimeError(f"ESPN ADP fetch failed: {last_err}")


async def fetch_espn_stat_splits(
    client: httpx.AsyncClient,
    *,
    actual_season_id: int,
    proj_season_id: int,
) -> tuple[dict[int, dict], dict[int, dict]]:
    """Actual and projected per-game lines from ESPN kona_player_info, in one request.

    ESPN nests every stat split a player has (this season's actuals, next season's
    projections, prior seasons, ...) in the same `stats` array regardless of which
    season's URL is queried, as long as the split id is listed in the filter. So one call
    against `proj_season_id` returns `actual_season_id`'s actuals (the season already
    played, before `proj_season_id` tips off) alongside `proj_season_id`'s own
    projections -- no separate DB read and no second ESPN request needed.
    """
    filter_payload = json.dumps(
        {
            "players": {
                "filterStatsForTopScoringPeriodIds": {
                    "value": 1,
                    "additionalValue": [f"00{actual_season_id}", f"10{proj_season_id}"],
                },
                "sortDraftRanks": {"sortPriority": 1, "sortAsc": True, "value": "ROTO"},
                "limit": 1200,
            }
        }
    )
    urls = [
        (
            f"https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/"
            f"{proj_season_id}/segments/0/leaguedefaults/1?view=kona_player_info"
        ),
        (
            f"https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/"
            f"{proj_season_id}/players?scoringPeriodId=0&view=kona_player_info"
        ),
    ]
    extra = {"X-Fantasy-Filter": filter_payload}
    last_err: Optional[Exception] = None
    for url in urls:
        try:
            data = await _get_json(client, url, headers=extra)
            actuals = parse_espn_actuals(data, actual_season_id)
            projections = parse_espn_projections(data, proj_season_id)
            if actuals or projections:
                return actuals, projections
        except (httpx.HTTPError, json.JSONDecodeError, ValueError) as e:
            last_err = e
    if last_err:
        raise RuntimeError(f"ESPN stat split fetch failed: {last_err}")
    return {}, {}


async def fetch_espn_stat_splits_map(
    *, actual_season_id: int, proj_season_id: int
) -> tuple[dict[int, dict], dict[int, dict]]:
    async with httpx.AsyncClient(timeout=_TIMEOUT, headers=_HEADERS, follow_redirects=True) as client:
        return await fetch_espn_stat_splits(
            client, actual_season_id=actual_season_id, proj_season_id=proj_season_id
        )


async def fetch_sleeper(client: httpx.AsyncClient) -> tuple[list[AdpRow], str]:
    # active=true is Sleeper's own documented filter: drops retired/inactive players
    # (~14% smaller payload) and costs nothing we use -- the only usable ranks it excludes
    # belong to retired players (Lowry, Howard, C. Paul).
    data = await _get_json(client, "https://api.sleeper.app/v1/players/nba?active=true")
    rows = parse_sleeper_payload(data)
    return rows, "Sleeper search_rank (api.sleeper.app/v1/players/nba?active=true)"


async def fetch_fantrax(client: httpx.AsyncClient) -> tuple[list[AdpRow], str]:
    urls = [
        "https://www.fantrax.com/fxea/general/getAdp?sport=NBA",
        "https://www.fantrax.com/fxea/general/getAdp?sport=NBA&position=ALL",
    ]
    last_err: Optional[Exception] = None
    for url in urls:
        try:
            data = await _get_json(client, url)
            rows = parse_fantrax_payload(data)
            if rows:
                return rows, f"Fantrax ADP ({url})"
        except (httpx.HTTPError, json.JSONDecodeError, ValueError) as e:
            last_err = e
    raise RuntimeError(f"Fantrax ADP fetch failed: {last_err}")


YAHOO_PAGE_SIZE = 100
_YAHOO_URL = (
    "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/game/nba/players"
    ";start={start};count={count};sort=AR;out=draft_analysis,ranks?format=json_f"
)


async def fetch_yahoo(client: httpx.AsyncClient) -> tuple[list[AdpRow], str]:
    """Walk Yahoo's whole public NBA player pool (~662 players, 7 pages at 100/page).

    Sequential with a small delay rather than parallel pages: this runs behind the 24h
    provider cache, never inline on a user request, so throughput does not matter and
    hammering an unauthenticated public endpoint does.
    """
    rows: list[AdpRow] = []
    start = 0
    while start < 2000:
        url = _YAHOO_URL.format(start=start, count=YAHOO_PAGE_SIZE)
        data = await _get_json(client, url)
        game = ((data or {}).get("fantasy_content") or {}).get("game") if isinstance(data, dict) else None
        entries = (game or {}).get("players") or []
        if not entries:
            break
        rows.extend(parse_yahoo_payload(entries))
        start += len(entries)
        if len(entries) < YAHOO_PAGE_SIZE:
            break
        await asyncio.sleep(0.3)
    if not rows:
        raise RuntimeError("Yahoo returned no usable players")
    return rows, "Yahoo public fantasy API (draft_analysis average_pick + OR ranks)"


async def fetch_live_adp_payload() -> dict:
    """Hit ESPN, Fantrax, and Sleeper through the persisted per-provider cache.

    Each provider only makes a network call when its own cache entry is due for refresh
    (24h normally, 15min after a failed attempt -- see adp_cache.py); a provider still
    inside its TTL is served from memory/Neon with no request at all. Failed sites with
    no cached payload anywhere are omitted.
    """
    async with httpx.AsyncClient(timeout=_TIMEOUT, headers=_HEADERS, follow_redirects=True) as client:
        fetchers = {
            "espn": lambda: fetch_espn(client),
            "fantrax": lambda: fetch_fantrax(client),
            "sleeper": lambda: fetch_sleeper(client),
            "yahoo": lambda: fetch_yahoo(client),
        }
        results = await asyncio.gather(
            *(adp_cache.get_or_refresh(site, fetchers[site]) for site in SITES),
            return_exceptions=True,
        )

    fetched: dict[str, tuple[list[AdpRow], str]] = {}
    providers: list[dict] = []
    for site, result in zip(SITES, results):
        if isinstance(result, BaseException):
            logger.warning("ADP source %s failed: %s: %s", site, type(result).__name__, result)
            continue
        entry: adp_cache.ProviderCacheEntry = result
        logger.info(
            "ADP source %s: %d players (fetched_at=%s%s)",
            site,
            len(entry.payload),
            entry.fetched_at.isoformat(),
            "" if entry.ok else ", stale after failed refresh",
        )
        fetched[site] = (entry.payload, entry.source)
        caps = PROVIDER_CAPABILITIES.get(site, {})
        providers.append(
            {
                "key": site,
                "label": PROVIDER_LABELS.get(site, site.title()),
                "has_adp": bool(caps.get("adp")),
                "has_rankings": bool(caps.get("rankings")),
                "fetched_at": entry.fetched_at.isoformat(),
                "source_url": entry.source,
                "player_count": len(entry.payload),
                "stale": not entry.ok,
            }
        )

    if not fetched:
        raise RuntimeError("All ADP sources failed")

    return assemble_adp_payload(
        fetched,
        season_label=espn_season_string(settings.season_id),
        updated_at=utc_now(),
        providers=providers,
    )
