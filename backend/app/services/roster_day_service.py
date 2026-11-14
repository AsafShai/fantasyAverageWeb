"""Roster by day: a fantasy team's lineup and stat lines on one scoring period.

The team page's Daily mode steps through past days. Each day needs, for one
team: the slot every player was in when that day's games locked, his stat line
that day, and the adds/drops/trades around it (the moves strip and the
Added/Dropped tags).

ESPN serves all of that per scoring period: view=mRoster with scoringPeriodId=N
and rosterForTeamId=T is the team's roster at that period's lock, each entry
with the player's single-period stat line (~160 KB; without rosterForTeamId it
is every team, ~1.9 MB, which costs the process ~12x the memory to parse);
view=mTransactions2 lists the period's moves (~50 KB). A past team-day is
fetched once, trimmed to ~16 small rows and stored (fantasy_roster_day /
fantasy_roster_moves); from then on it is read from Postgres. Nothing
backfills: a team-day is stored the first time anyone opens it. Today is never
stored -- the lineup and moves can still change -- and is cached briefly.

Without a database the same trimmed rows live in a small in-process LRU, so
the feature still works locally, just without surviving a restart.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import OrderedDict
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

import httpx

from app.config import settings
from app.exceptions import DataSourceError, InvalidParameterError, ResourceNotFoundError
from app.models.live import LiveBlock
from app.models.roster_day_models import (
    RosterDay, RosterDayGame, RosterDayMove, RosterDayMovePlayer, RosterDayPlayer, RosterDayStats,
)
from app.services import box_score_service, schedule_service
from app.services import live_overlay as lo
from app.services import live_overlay_service
from app.services.data_provider import get_data_provider
from app.services.db_service import DBService
from app.services.league_activity_service import parse_schedule
from app.utils.constants import LINEUP_SLOT_MAP, POSITION_MAP, PRO_TEAM_MAP
from app.utils.ssl_context import shared_ssl_context

logger = logging.getLogger(__name__)

EASTERN = ZoneInfo("America/New_York")

# ESPN stat id -> RosterDayStats field, for the single-period stat line. The
# order is also the stored array's order (fantasy_roster_day.stats): append
# only, never reorder.
STAT_FIELDS = {
    "40": "minutes", "13": "fgm", "14": "fga", "15": "ftm", "16": "fta", "17": "three_pm",
    "6": "reb", "3": "ast", "2": "stl", "1": "blk", "0": "pts", "11": "to",
}
STAT_ORDER = list(STAT_FIELDS.values())


def stats_to_array(stats: Optional[dict]) -> Optional[list[float]]:
    if stats is None:
        return None
    return [float(stats.get(field, 0)) for field in STAT_ORDER] if stats else []


def stats_from_array(values: Optional[list]) -> Optional[dict]:
    if values is None:
        return None
    return {field: float(v) for field, v in zip(STAT_ORDER, values)}
SINGLE_PERIOD_SPLIT = 5
ACTUAL_STATS = 0
MOVE_TYPES = {"FREEAGENT": "free_agent", "WAIVER": "waiver", "TRADE_ACCEPT": "trade"}
ITEM_TYPES = ("ADD", "DROP", "TRADE")

LIVE_TTL_S = 5 * 60           # today's roster / moves
LIVE_RESPONSE_TTL_S = 20      # today while games are counted (the page polls every 60 s)
# A game is not asked about before it could have ended (as live_overlay).
FINAL_CHECK_AFTER_TIP_MS = lo.FINAL_CHECK_AFTER_TIP_MS
RESPONSE_TTL_PAST_S = 6 * 60 * 60
RESPONSE_TTL_RECENT_S = 60    # yesterday's tags still depend on today's moves
MEMORY_PERIODS = 120          # no-DB fallback: trimmed team-days (~16 rows each) kept in process
RESPONSE_CACHE_SIZE = 128


def eastern_today() -> date:
    return datetime.now(EASTERN).date()


# ---------------------------------------------------------------------------
# Parsing ESPN payloads (pure)
# ---------------------------------------------------------------------------

def parse_roster_payload(payload: dict, period: int, season_id: int) -> list[tuple]:
    """Every team's roster at ``period``'s lock, trimmed to stored rows:
    (team_id, player_id, player_name, positions, pro_team_id, lineup_slot, stats).

    ``stats`` is None when ESPN has no stat line for the player that period (his
    team did not play), {} when it has one without numbers (did not play), else
    the line keyed by RosterDayStats field."""
    if isinstance(payload, list):
        payload = payload[0] if payload else {}
    if payload.get("seasonId") != season_id:
        # Team ids are reused across seasons; another season's rows must not be stored.
        raise DataSourceError(f"ESPN returned season {payload.get('seasonId')}, expected {season_id}")
    rows: list[tuple] = []
    for team in payload.get("teams") or []:
        team_id = team.get("id")
        for entry in (team.get("roster") or {}).get("entries") or []:
            slot = LINEUP_SLOT_MAP.get(entry.get("lineupSlotId"))
            player_id = entry.get("playerId")
            if team_id is None or player_id is None or slot is None:
                continue
            player = (entry.get("playerPoolEntry") or {}).get("player") or {}
            positions = ", ".join(POSITION_MAP[s] for s in player.get("eligibleSlots") or [] if s in POSITION_MAP)
            stats = None
            for line in player.get("stats") or []:
                if (line.get("statSplitTypeId") == SINGLE_PERIOD_SPLIT and line.get("statSourceId") == ACTUAL_STATS
                        and line.get("scoringPeriodId") == period):
                    raw = line.get("stats") or {}
                    stats = {field: float(raw[sid]) for sid, field in STAT_FIELDS.items() if sid in raw}
                    break
            rows.append((
                int(team_id), int(player_id), player.get("fullName") or "", positions,
                int(player.get("proTeamId") or 0), slot, stats,
            ))
    return rows


def parse_transactions(payload: dict) -> list[tuple]:
    """Executed adds, drops, waiver claims and trades: (tx_id, kind, at, items),
    items = [{type, player_id, from_team_id, to_team_id}]. Lineup changes are
    left out (the roster call already has the slot at lock)."""
    if isinstance(payload, list):
        payload = payload[0] if payload else {}
    out: list[tuple] = []
    for tx in payload.get("transactions") or []:
        kind = tx.get("type")
        if kind not in MOVE_TYPES or tx.get("status") != "EXECUTED" or "id" not in tx:
            continue
        items = [
            {
                "type": item.get("type"),
                "player_id": int(item["playerId"]),
                "from_team_id": item.get("fromTeamId"),
                "to_team_id": item.get("toTeamId"),
            }
            for item in tx.get("items") or []
            if item.get("type") in ITEM_TYPES and item.get("playerId") is not None
        ]
        ms = tx.get("processDate") or tx.get("proposedDate")
        if not items or not ms:
            continue
        out.append((str(tx["id"]), kind, datetime.fromtimestamp(ms / 1000, tz=timezone.utc), items))
    return out


def opponents_for_period(schedule_payload: dict, period: int) -> dict[int, str]:
    """{pro_team_id: opponent abbreviation} for the NBA games in ``period``."""
    out: dict[int, str] = {}
    for team in (schedule_payload or {}).get("settings", {}).get("proTeams") or []:
        for game in (team.get("proGamesByScoringPeriod") or {}).get(str(period)) or []:
            home, away = game.get("homeProTeamId"), game.get("awayProTeamId")
            if home is None or away is None:
                continue
            out[home] = PRO_TEAM_MAP.get(away, str(away))
            out[away] = PRO_TEAM_MAP.get(home, str(home))
    return out


def effective_period(at: datetime, period: int, lock_ms: Optional[int]) -> int:
    """The period a move first shows on a roster: its own, or the next one when
    it was made after that period's lock (the locked lineup no longer changes)."""
    if lock_ms is None:
        return period
    return period if at.timestamp() * 1000 < lock_ms else period + 1


def team_side(items: list[dict], team_id: int) -> tuple[list[int], list[int]]:
    """(players the team got, players it gave up) in one transaction."""
    got, gave = [], []
    for item in items:
        if item["type"] in ("ADD", "TRADE") and item.get("to_team_id") == team_id:
            got.append(item["player_id"])
        if item["type"] in ("DROP", "TRADE") and item.get("from_team_id") == team_id:
            gave.append(item["player_id"])
    return got, gave


def build_moves(
    txs: list[dict], team_id: int, period: int, locks: dict[int, int],
    roster_ids: set[int], names: dict[int, str],
) -> tuple[list[RosterDayMove], set[int], set[int]]:
    """The team's moves that took effect on ``period`` (oldest first), plus the
    roster players to tag Added (joined on this day) and Dropped (gone the next
    day). ``txs``: dicts with scoring_period_id, tx_id, kind, at, items."""
    moves: list[RosterDayMove] = []
    added: set[int] = set()
    dropped: set[int] = set()

    def who(pid: int) -> RosterDayMovePlayer:
        return RosterDayMovePlayer(player_id=pid, name=names.get(pid, f"Player {pid}"), on_roster=pid in roster_ids)

    for tx in sorted(txs, key=lambda t: t["at"]):
        got, gave = team_side(tx["items"], team_id)
        if not got and not gave:
            continue
        filed = tx["scoring_period_id"]
        eff = effective_period(tx["at"], filed, locks.get(filed))
        if eff == period:
            moves.append(RosterDayMove(
                id=tx["tx_id"], kind=MOVE_TYPES[tx["kind"]], at=tx["at"],
                added=[who(p) for p in got], dropped=[who(p) for p in gave],
                after_lock=eff != filed,
            ))
            added.update(p for p in got if p in roster_ids)
        elif eff == period + 1:
            dropped.update(p for p in gave if p in roster_ids)
    return moves, added, dropped


def player_status(stats: Optional[dict], opponent: Optional[str], is_today: bool) -> str:
    if (stats or {}).get("minutes", 0) > 0:
        return "played"
    if not opponent:
        return "no_game"
    return "scheduled" if is_today else "dnp"


def live_player_status(stats: Optional[dict], phase: Optional[str]) -> str:
    """Today's status with the live overlay on: ``phase`` is his game's
    ('scheduled' / 'live' / 'final', None without a game)."""
    if phase is None:
        return "no_game"
    if phase == "scheduled":
        return "scheduled"
    if phase == "live":
        return "live"
    return "played" if (stats or {}).get("minutes", 0) > 0 else "dnp"


def games_for_period(schedule_payload: dict, period: int) -> dict[int, tuple[str, int, bool]]:
    """{pro_team_id: (game_id, tip ms, is_home)} for ``period``'s NBA games."""
    out: dict[int, tuple[str, int, bool]] = {}
    for team in (schedule_payload or {}).get("settings", {}).get("proTeams") or []:
        for game in (team.get("proGamesByScoringPeriod") or {}).get(str(period)) or []:
            home, away = game.get("homeProTeamId"), game.get("awayProTeamId")
            if game.get("id") is None or game.get("date") is None or home is None or away is None:
                continue
            out[int(home)] = (str(game["id"]), int(game["date"]), True)
            out[int(away)] = (str(game["id"]), int(game["date"]), False)
    return out


def game_from_scoreboard(card: dict, is_home: bool) -> RosterDayGame:
    """One scoreboard game card as seen from one side."""
    mine, theirs = (card.get("home"), card.get("away")) if is_home else (card.get("away"), card.get("home"))
    mine, theirs = mine or {}, theirs or {}
    status = card.get("status") if card.get("status") in ("scheduled", "live", "final") else "scheduled"
    start = None
    try:
        start = datetime.fromisoformat(str(card.get("start_time") or "").replace("Z", "+00:00")) or None
    except ValueError:
        start = None
    won = None
    if status == "final" and (mine.get("winner") or theirs.get("winner")):
        won = bool(mine.get("winner"))
    return RosterDayGame(
        status=status, detail=str(card.get("status_detail") or ""), start_time=start,
        team_score=mine.get("score"), opp_score=theirs.get("score"), won=won,
    )


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------

class _TTLCache:
    def __init__(self, maxsize: int):
        self.maxsize = maxsize
        self._data: OrderedDict[Any, tuple[float, Any]] = OrderedDict()

    def get(self, key):
        hit = self._data.get(key)
        if hit is None:
            return None
        if hit[0] < time.monotonic():
            del self._data[key]
            return None
        self._data.move_to_end(key)
        return hit[1]

    def set(self, key, value, ttl: float):
        self._data[key] = (time.monotonic() + ttl, value)
        self._data.move_to_end(key)
        while len(self._data) > self.maxsize:
            self._data.popitem(last=False)

    def clear(self):
        self._data.clear()


class RosterDayService:
    def __init__(self):
        self._db = DBService()
        self._client: Optional[httpx.AsyncClient] = None
        # Live (today) and no-DB fallback data, both trimmed rows only.
        self._rosters = _TTLCache(MEMORY_PERIODS)
        self._moves = _TTLCache(MEMORY_PERIODS)
        self._responses = _TTLCache(RESPONSE_CACHE_SIZE)
        self._locks: dict[tuple, asyncio.Lock] = {}
        # Final games already read off the scoreboard: never asked about again.
        self._final_games: dict[str, dict] = {}

    @property
    def league_url(self) -> str:
        return (
            f"https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/{settings.season_id}"
            f"/segments/0/leagues/{settings.league_id}"
        )

    def clear_cache(self) -> None:
        self._final_games.clear()
        self._rosters.clear()
        self._moves.clear()
        self._responses.clear()

    def _lock(self, key: tuple) -> asyncio.Lock:
        return self._locks.setdefault(key, asyncio.Lock())

    async def _get(self, params: list[tuple[str, str]]) -> Any:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0), verify=shared_ssl_context())
        try:
            response = await self._client.get(self.league_url, params=params)
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError) as e:
            raise DataSourceError(f"ESPN request failed ({params}): {type(e).__name__}: {e}") from e

    # -- rosters ------------------------------------------------------------

    async def _fetch_roster(self, period: int, team_id: int) -> list[tuple]:
        """One team's trimmed rows for ``period``. Asks ESPN for that team only:
        the league-wide roster is ~12x the bytes to download and parse."""
        payload = await self._get([
            ("view", "mRoster"), ("scoringPeriodId", str(period)), ("rosterForTeamId", str(team_id)),
        ])
        rows = [r[1:] for r in parse_roster_payload(payload, period, settings.season_id) if r[0] == team_id]
        del payload  # only the trimmed rows are kept
        logger.info(f"Roster day: fetched period {period} team {team_id} from ESPN ({len(rows)} rows)")
        return rows

    async def _team_roster(self, period: int, team_id: int, live: bool) -> list[tuple]:
        """The team's rows for ``period``: (player_id, name, positions, pro_team_id, slot, stats)."""
        key = (period, team_id)
        cached = self._rosters.get(key)
        if cached is not None:
            return cached
        async with self._lock(("roster", *key)):
            cached = self._rosters.get(key)
            if cached is not None:
                return cached
            if not live:
                saved = await self._db.get_saved_roster_periods([period], "roster", team_id)
                if saved and period in saved:
                    return [
                        (r["player_id"], r["player_name"], r["positions"], r["pro_team_id"], r["lineup_slot"],
                         stats_from_array(r["stats"]))
                        for r in await self._db.get_roster_day_rows(period, team_id)
                    ]
            rows = await self._fetch_roster(period, team_id)
            stored = False if live else await self._db.save_roster_day(
                period, team_id, [(*r[:5], stats_to_array(r[5])) for r in rows])
            if live or not stored:
                # Today, or no database: keep the trimmed rows in process.
                self._rosters.set(key, rows, LIVE_TTL_S if live else RESPONSE_TTL_PAST_S)
            return rows

    # -- moves --------------------------------------------------------------

    async def _period_moves(self, period: int, live: bool) -> list[dict]:
        def as_dicts(rows):
            return [{"scoring_period_id": period, "tx_id": t, "kind": k, "at": a, "items": i} for t, k, a, i in rows]

        cached = self._moves.get(period)
        if cached is not None:
            return as_dicts(cached)
        async with self._lock(("moves", period)):
            cached = self._moves.get(period)
            if cached is not None:
                return as_dicts(cached)
            payload = await self._get([("view", "mTransactions2"), ("scoringPeriodId", str(period))])
            rows = parse_transactions(payload)
            stored = False if live else await self._db.save_roster_moves(period, rows)
            if live or not stored:
                self._moves.set(period, rows, LIVE_TTL_S if live else RESPONSE_TTL_PAST_S)
            return as_dicts(rows)

    async def _moves_around(self, period: int, today_period: int) -> list[dict]:
        """Transactions filed under period-1 .. period+1: everything that can take
        effect on ``period`` or the day after it."""
        periods = [p for p in (period - 1, period, period + 1) if 1 <= p <= today_period]
        past = [p for p in periods if p < today_period]
        saved = await self._db.get_saved_roster_periods(past, "moves") or set()
        stored = await self._db.get_roster_moves(sorted(saved)) if saved else []
        missing = [p for p in periods if p not in saved]
        fetched = await asyncio.gather(*(self._period_moves(p, live=p >= today_period) for p in missing))
        return stored + [tx for part in fetched for tx in part]

    # -- the day ------------------------------------------------------------

    # -- games (scoreboard) ------------------------------------------------

    async def _scoreboard_games(
        self, day: date, wanted: dict[str, int], live_on: bool, now_ms: int,
    ) -> dict[str, dict]:
        """{game_id: scoreboard card} for the games in ``wanted`` ({game_id:
        tip ms}) worth asking about: with the flag off only games that could
        have ended (1 h 45 min past tip, the same rule as the live overlay),
        with it on every game that has tipped. A game seen final is kept and
        never asked about again. One shared, cached scoreboard request at most
        (box_score_service, 60 s while live, 6 h for a finished past day);
        a failure just leaves the games without a result."""
        out = {g: self._final_games[g] for g in wanted if g in self._final_games}
        wait = 0 if live_on else FINAL_CHECK_AFTER_TIP_MS
        due = [g for g, tip in wanted.items() if g not in out and now_ms >= tip + wait]
        if not due:
            return out
        try:
            board = await box_score_service.scoreboard_for(day)
        except Exception as e:
            logger.warning(f"Roster day: scoreboard for {day} unavailable: {type(e).__name__}: {e}")
            return out
        for card in board.get("games") or []:
            game_id = str(card.get("game_id") or "")
            if game_id not in wanted:
                continue
            out[game_id] = card
            if card.get("status") == "final":
                self._final_games[game_id] = card
        return out

    # -- the day ------------------------------------------------------------

    async def get_roster_day(self, team_id: int, day: Optional[date] = None) -> RosterDay:
        provider = get_data_provider()
        season_start = await schedule_service.get_season_start_date() or settings.season_start
        # With the live overlay on, "today" is ESPN's current scoring period,
        # not the Eastern date: late games run past midnight ET while ESPN is
        # still on the same period (plan section 6). Flag off: as before.
        live_on = settings.live_standings_enabled
        live_state = await provider.get_live_state() if live_on else None
        espn_period = live_state.period if live_state is not None else None
        today = season_start + timedelta(days=espn_period - 1) if espn_period else eastern_today()
        day = day or today
        last_day = min(today, settings.season_end) if settings.season_end and settings.season_end >= season_start else today
        if day < season_start or day > max(last_day, season_start):
            raise InvalidParameterError(f"date must be between {season_start} and {last_day}")
        period = (day - season_start).days + 1
        today_period = (today - season_start).days + 1
        is_today = day == today
        live_today = live_on and is_today and espn_period is not None

        teams = {int(t["team_id"]) for t in await provider.get_team_names()}
        if team_id not in teams:
            raise ResourceNotFoundError(f"Team {team_id} not found")

        key = (team_id, period)
        hit = self._responses.get(key)
        if hit is not None:
            return hit

        schedule_payload = await provider.get_pro_team_schedules()
        locks = parse_schedule(schedule_payload, max(1, period - 1), max(period, today_period)).period_lock
        opponents = opponents_for_period(schedule_payload, period)
        pro_games = games_for_period(schedule_payload, period)

        roster, txs = await asyncio.gather(
            self._team_roster(period, team_id, live=is_today),
            self._moves_around(period, today_period),
        )
        tonight: dict[int, lo.TonightPlayer] = {}
        if live_today:
            roster, tonight = self._with_tonight(roster, provider.cached_totals_raw(), team_id, period)
        roster_ids = {r[0] for r in roster}
        names = {r[0]: r[1] for r in roster}
        try:
            directory = await provider.get_players_directory()
        except DataSourceError:
            directory = {}
        moves, added, dropped = build_moves(txs, team_id, period, locks, roster_ids, {**directory, **names})

        now_ms = live_overlay_service._now_ms()
        player_games = {}
        for pid, _name, _positions, pro_team_id, _slot, _stats in roster:
            line = tonight.get(pid)
            game = pro_games.get(pro_team_id)
            if line is not None and line.game_id and (game is None or game[0] != line.game_id):
                game = next(((g, t, h) for g, t, h in pro_games.values() if g == line.game_id), game)
            if game is not None:
                player_games[pid] = game
        cards = await self._scoreboard_games(
            day, {g: t for g, t, _ in player_games.values()}, live_today, now_ms,
        ) if player_games else {}
        finals = provider.live.known_final(period) if live_today else frozenset()

        players = []
        for pid, name, positions, pro_team_id, slot, stats in roster:
            opponent = opponents.get(pro_team_id)
            game = player_games.get(pid)
            card = cards.get(game[0]) if game else None
            if live_today:
                phase = None
                if game is not None:
                    line = tonight.get(pid)
                    phase = lo.game_phase(game[0], game[1], finals, now_ms, has_line=bool(line and line.line))
                    if card is not None and card.get("status") in ("live", "final"):
                        phase = card["status"]
                status = live_player_status(stats, phase)
            else:
                status = player_status(stats, opponent, is_today)
            game_info = None
            if card is not None and game is not None and (live_today or card.get("status") == "final"):
                game_info = game_from_scoreboard(card, game[2])
            elif live_today and game is not None and status == "scheduled":
                # Before his tip: the time from the cached schedule, no request.
                game_info = RosterDayGame(
                    status="scheduled", start_time=datetime.fromtimestamp(game[1] / 1000, tz=timezone.utc))
            players.append(RosterDayPlayer(
                player_id=pid,
                player_name=name or directory.get(pid, f"Player {pid}"),
                positions=[p for p in (positions or "").split(", ") if p],
                pro_team=PRO_TEAM_MAP.get(pro_team_id, "FA"),
                lineup_slot=slot,
                opponent=opponent,
                status=status,
                stats=RosterDayStats(**stats) if stats and status in ("played", "live") else None,
                added=pid in added,
                dropped=pid in dropped,
                game=game_info,
            ))

        has_games = bool(opponents)
        lock_ms = locks.get(period) if has_games else None
        result = RosterDay(
            team_id=team_id,
            date=day,
            scoring_period_id=period,
            is_today=is_today,
            has_games=has_games,
            lock_at=datetime.fromtimestamp(lock_ms / 1000, tz=timezone.utc) if lock_ms else None,
            first_date=season_start,
            last_date=max(last_day, season_start),
            players=players,
            moves=moves,
            live=LiveBlock(**live_state.to_dict()) if live_today and live_state is not None else None,
        )
        if live_today and live_state is not None and live_state.active:
            ttl = LIVE_RESPONSE_TTL_S
        elif is_today:
            ttl = 60
        elif period + 1 >= today_period:
            ttl = RESPONSE_TTL_RECENT_S
        else:
            ttl = RESPONSE_TTL_PAST_S
        self._responses.set(key, result, ttl)
        return result

    @staticmethod
    def _with_tonight(roster: list[tuple], raw: Optional[dict], team_id: int, period: int):
        """Today's rows with the slots and stat lines from the league payload
        the app already polls every 30 s (ESPN's current period only), so the
        Daily view follows games in progress without a faster mRoster poll.
        The payload decides who is on the roster; mRoster (5 min) supplies
        positions and, for a player it does not have yet, nothing else is
        needed. Falls back to ``roster`` unchanged when the payload is for
        another period or lists nobody for the team."""
        if not raw or int(raw.get("scoringPeriodId") or 0) != period:
            return roster, {}
        players = lo.tonight_players(raw, team_id)
        if not players:
            return roster, {}
        known = {r[0]: r for r in roster}
        rows = []
        for p in players:
            slot = LINEUP_SLOT_MAP.get(p.slot_id)
            if slot is None:
                continue
            base = known.get(p.player_id)
            stats = None
            if p.line is not None:
                stats = {field: float(p.line[sid]) for sid, field in STAT_FIELDS.items() if sid in p.line}
            elif base is not None:
                stats = base[5]
            rows.append((
                p.player_id,
                p.name or (base[1] if base else ""),
                base[2] if base else "",
                p.pro_team_id if p.pro_team_id is not None else (base[3] if base else 0),
                slot,
                stats,
            ))
        return rows, {p.player_id: p for p in players}

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None


_service: Optional[RosterDayService] = None


def get_roster_day_service() -> RosterDayService:
    global _service
    if _service is None:
        _service = RosterDayService()
    return _service
