"""Live fantasy basketball ADP from ESPN, Sleeper, and Fantrax JSON APIs."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Optional

import httpx

from app.config import settings
from app.services.player_service import espn_season_string

logger = logging.getLogger(__name__)

SITES = ("espn", "fantrax", "sleeper")
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

AdpRow = tuple[Optional[int], str, Optional[float], list[str]]

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
        std = ranks.get("STANDARD") or ranks.get("standard") or {}
        avg = std.get("averageRank")
        adp = coerce_adp(avg if avg not in (None, 0) else std.get("rank"))
        if adp is None:
            continue
        slots = player.get("eligibleSlots") or []
        positions = [POSITION_MAP[s] for s in slots if s in POSITION_MAP]
        rows.append((espn_id, name.strip(), adp, positions))
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


def _is_season_projection(stat: dict, season_id: int) -> bool:
    if not isinstance(stat, dict):
        return False
    if str(stat.get("id") or "") == f"10{season_id}":
        return True
    return (
        stat.get("statSourceId") == 1
        and stat.get("seasonId") == season_id
        and stat.get("scoringPeriodId") == 0
    )


def parse_espn_projections(data, season_id: int) -> dict[int, dict]:
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
            if _is_season_projection(stat, season_id):
                chosen = stat
                break
        parsed = projection_from_stat_block(chosen) if chosen else None
        if parsed:
            out[espn_id] = parsed
    return out


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
        adp = coerce_adp(rec.get("search_rank"))
        if adp is not None and adp >= 900:
            adp = None
        if adp is None:
            continue
        positions: list[str] = []
        fp = rec.get("fantasy_positions")
        if isinstance(fp, list):
            positions = [str(p).upper() for p in fp if str(p).upper() in _VALID_POS]
        rows.append((espn_id, name.strip(), adp, positions))
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
        rows.append((None, name.strip(), adp, []))
    return rows


def assemble_adp_payload(
    fetched: dict[str, tuple[list[AdpRow], str]],
    *,
    season_label: str,
    updated_at: Optional[str] = None,
) -> dict:
    players: list[dict] = []
    sources: dict[str, str] = {}
    for site in SITES:
        if site not in fetched:
            continue
        rows, label = fetched[site]
        sources[site] = label
        for espn_id, name, adp, positions in rows:
            if adp is None or not name:
                continue
            players.append(
                {
                    "espn_id": espn_id,
                    "name": name,
                    "positions": positions,
                    "adp": {site: adp},
                }
            )
    return {
        "seasonLabel": season_label,
        "updatedAt": updated_at or utc_now(),
        "sources": sources,
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
                "sortDraftRanks": {"sortPriority": 1, "sortAsc": True, "value": "STANDARD"},
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
                return rows, f"ESPN Fantasy STANDARD draft ranks ({url})"
        except (httpx.HTTPError, json.JSONDecodeError, ValueError) as e:
            last_err = e
    raise RuntimeError(f"ESPN ADP fetch failed: {last_err}")


async def fetch_espn_projections(
    client: httpx.AsyncClient,
    season_id: int,
) -> dict[int, dict]:
    """Season projection per-game lines from ESPN kona_player_info."""
    filter_payload = json.dumps(
        {
            "players": {
                "filterStatsForTopScoringPeriodIds": {
                    "value": 1,
                    "additionalValue": [f"00{season_id}", f"10{season_id}"],
                },
                "sortDraftRanks": {"sortPriority": 1, "sortAsc": True, "value": "STANDARD"},
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
            parsed = parse_espn_projections(data, season_id)
            if parsed:
                return parsed
        except (httpx.HTTPError, json.JSONDecodeError, ValueError) as e:
            last_err = e
    if last_err:
        raise RuntimeError(f"ESPN projection fetch failed: {last_err}")
    return {}


async def fetch_espn_projection_map(season_id: int) -> dict[int, dict]:
    async with httpx.AsyncClient(timeout=_TIMEOUT, headers=_HEADERS, follow_redirects=True) as client:
        return await fetch_espn_projections(client, season_id)


async def fetch_sleeper(client: httpx.AsyncClient) -> tuple[list[AdpRow], str]:
    data = await _get_json(client, "https://api.sleeper.app/v1/players/nba")
    rows = parse_sleeper_payload(data)
    return rows, "Sleeper search_rank (api.sleeper.app/v1/players/nba)"


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


async def fetch_live_adp_payload() -> dict:
    """Hit ESPN, Fantrax, and Sleeper in parallel. Failed sites are omitted."""
    async with httpx.AsyncClient(timeout=_TIMEOUT, headers=_HEADERS, follow_redirects=True) as client:
        results = await asyncio.gather(
            fetch_espn(client),
            fetch_fantrax(client),
            fetch_sleeper(client),
            return_exceptions=True,
        )

    fetched: dict[str, tuple[list[AdpRow], str]] = {}
    for site, result in zip(SITES, results):
        if isinstance(result, Exception):
            logger.warning("ADP source %s failed: %s: %s", site, type(result).__name__, result)
            continue
        rows, label = result
        logger.info("ADP source %s: %d players", site, len(rows))
        fetched[site] = (rows, label)

    if not fetched:
        raise RuntimeError("All ADP sources failed")

    return assemble_adp_payload(
        fetched,
        season_label=espn_season_string(settings.season_id),
        updated_at=utc_now(),
    )
