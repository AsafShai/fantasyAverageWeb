"""Matchup context for the UI: today's schedule (ESPN scoreboard) and each
team's defensive profile (ranks / allowed values / pace).

Defensive aggregates are computed from our own fs_team_games store (season-to-
date self-join in Postgres) instead of NBA's precomputed Opponent/Advanced
tables — one ingestion path, no stats.nba.com dependency. All team keys are
canonical abbreviations (NYK/GSW/PHL…), the dialect the fantasy side and the
UI already speak.
"""

import asyncio
import logging
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx

from app.config import settings
from app.services.db_service import DBService
from app.utils.ssl_context import shared_ssl_context
from app.utils.team_abbr_map import TEAM_ID_TO_ABBR, canonical_abbr
from model_stats_inference.espn import client as espn_client
from model_stats_inference.espn.games import event_game_date, is_countable, is_final

# How far forward the default view searches for the next slate. Covers the
# All-Star break (~6 days); anything longer (offseason) is genuinely "no games".
_UPCOMING_LOOKAHEAD_DAYS = 7

# Same freshness as the shared day-events cache. A pinned date's team -> opponent
# map does not change as its games progress, so this only saves repeat fetches
# (the player card walks up to ~10 dates per view).
_EXPLICIT_DATE_TTL = timedelta(minutes=5)
# Freshness of one whitelist day's scoreboard in the default-view scan.
_DAY_EVENTS_TTL = timedelta(minutes=5)
# Backstop only: keys are dates the UI offers (upcoming + stored), a few dozen.
_EXPLICIT_DATE_MAX_ENTRIES = 128


def _season_str(season_id: int) -> str:
    return f'{season_id - 1}-{str(season_id)[2:]}'


@dataclass
class GameInfo:
    opponent: str  # canonical abbreviation
    is_home: bool


# stat key served to the UI -> aggregate column from get_team_defense_aggregates
_STAT_COLS: dict[str, str] = {
    'pts': 'opp_pts',
    'reb': 'opp_reb',
    'ast': 'opp_ast',
    'stl': 'opp_stl',
    'blk': 'opp_blk',
    'three_pm': 'opp_fg3m',
    'fg_pct': 'opp_fg_pct',
}


class NbaMatchupService:
    def __init__(self) -> None:
        self.logger = logging.getLogger(__name__)
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(30.0), verify=shared_ssl_context())
        self._db = DBService()
        self._def_cache: dict = {
            'ranks': None,
            'values': None,
            'league_avg_values': None,
            'pace': None,
            'ts': None,
        }
        # Per whitelist day: (fetched_at, [(game_date, slim countable event)]).
        # A day whose events were all filtered out (not countable) is kept with
        # an empty list, so it still counts as cached.
        self._day_events: dict[date, tuple[datetime, list[tuple[date, dict]]]] = {}
        self._explicit_cache: dict[str, tuple[datetime, dict[str, 'GameInfo']]] = {}
        self._resolved_date: str | None = None
        self._whitelist_cache: dict = {'dates': None, 'ts': None}

    def _def_cache_valid(self) -> bool:
        return (
            self._def_cache['ts'] is not None
            and datetime.now() - self._def_cache['ts'] < timedelta(minutes=5)
        )

    async def _ensure_def_cache(self) -> None:
        if self._def_cache_valid() and self._def_cache['ranks'] is not None:
            return
        rows = await self._db.get_team_defense_aggregates(_season_str(settings.season_id))
        if not rows:
            self.logger.warning('No team defense aggregates (store empty?) - matchup ranks unavailable')
        self._def_cache.update({
            'ranks': self._build_ranks(rows),
            'values': self._build_values(rows),
            'league_avg_values': self._build_league_avg_values(rows),
            'pace': self._build_pace(rows),
            'ts': datetime.now(),
        })

    async def get_all_def_data(self) -> dict:
        await self._ensure_def_cache()
        return {
            'ranks': self._def_cache['ranks'],
            'values': self._def_cache['values'],
            'league_avg_values': self._def_cache['league_avg_values'],
            'pace': self._def_cache['pace'],
        }

    @staticmethod
    def _team_abbr(row: dict) -> str:
        return TEAM_ID_TO_ABBR.get(int(row['team_id']), str(row['team_id']))

    def _build_ranks(self, rows: list[dict]) -> dict[str, dict[str, int]]:
        ranks: dict[str, dict[str, int]] = {}
        for stat_key, col in _STAT_COLS.items():
            # ascending → lowest value allowed = rank 1, highest = rank 30 (best matchup)
            for rank, row in enumerate(sorted(rows, key=lambda r: float(r[col] or 0)), start=1):
                ranks.setdefault(self._team_abbr(row), {})[stat_key] = rank
        return ranks

    def _build_values(self, rows: list[dict]) -> dict[str, dict[str, float]]:
        values: dict[str, dict[str, float]] = {}
        for row in rows:
            abbr = self._team_abbr(row)
            for stat_key, col in _STAT_COLS.items():
                raw = float(row[col] or 0)
                values.setdefault(abbr, {})[stat_key] = (
                    round(raw, 3) if stat_key == 'fg_pct' else round(raw, 1)
                )
        return values

    def _build_league_avg_values(self, rows: list[dict]) -> dict[str, float]:
        avgs: dict[str, float] = {}
        if not rows:
            return avgs
        for stat_key, col in _STAT_COLS.items():
            raw = sum(float(r[col] or 0) for r in rows) / len(rows)
            avgs[stat_key] = round(raw, 3) if stat_key == 'fg_pct' else round(raw, 1)
        return avgs

    def _build_pace(self, rows: list[dict]) -> dict[str, float]:
        return {self._team_abbr(r): float(r['pace'] or 0) for r in rows}

    def get_pace_badge(self, team_pace: float, league_avg_pace: float) -> str:
        diff = team_pace - league_avg_pace
        if diff > 2.0:
            return 'Fast'
        if diff < -2.0:
            return 'Slow'
        return 'Average'

    async def get_games_today(self, date: str | None = None) -> dict[str, GameInfo]:
        if date is not None:
            # Explicit/testing date: trusted verbatim, bypasses the whitelist
            # and the shared events cache entirely.
            hit = self._explicit_cache.get(date)
            if hit is not None and datetime.now() - hit[0] < _EXPLICIT_DATE_TTL:
                return dict(hit[1])
            resp = await espn_client.scoreboard_async(self._client, date)
            games = self._games_from(resp.get('events', []))
            if len(self._explicit_cache) >= _EXPLICIT_DATE_MAX_ENTRIES:
                self._explicit_cache.clear()
            self._explicit_cache[date] = (datetime.now(), games)
            return dict(games)

        # Default view = the UPCOMING slate. The date is always pinned (ESPN's
        # dateless scoreboard returns the NEAREST game day — the season finale
        # all offseason, which is not "upcoming"). Starting from US/Eastern
        # today (the NBA game-day convention), take the first day that still
        # has a non-final countable game: today while games are pending or
        # live, tomorrow once the whole slate is final, the next slate across
        # the All-Star break, and empty in the offseason.
        base = datetime.now(ZoneInfo('America/New_York')).date()
        by_day = await self._countable_events_by_day(
            base, _UPCOMING_LOOKAHEAD_DAYS,
            enough=lambda found: any(not is_final(e) for events in found.values() for e in events),
        )
        games: dict[str, GameInfo] = {}
        resolved_date: date | None = None
        for offset in range(_UPCOMING_LOOKAHEAD_DAYS + 1):
            events = by_day.get(base + timedelta(days=offset), [])
            if any(not is_final(e) for e in events):
                games = self._games_from(events)
                resolved_date = base + timedelta(days=offset)
                break

        # Preseason: nothing within the normal lookahead window, but the real
        # season opener (settings.season_start, now derived from the NBA
        # schedule) is a known future date — preview it instead of reporting
        # a flat offseason "no games".
        if resolved_date is None and base < settings.season_start:
            opener_events = (await self._countable_events_by_day(settings.season_start, 0)).get(
                settings.season_start, []
            )
            if opener_events:
                games = self._games_from(opener_events)
                resolved_date = settings.season_start

        self._resolved_date = resolved_date.isoformat() if resolved_date else None
        return games

    def get_schedule_date(self) -> str | None:
        """ISO date the last default-view (date=None) get_games_today call
        resolved to — None in the offseason, when there's no upcoming slate.
        Lets the UI show which real calendar day 'Upcoming (live)' means."""
        return self._resolved_date

    async def get_upcoming_game_dates(
        self, count: int = 5, lookahead_days: int = 14
    ) -> list[str]:
        """The next ``count`` days that have countable games (ISO dates, today
        included while its slate is still pending), scanning at most
        ``lookahead_days`` ahead. Offseason -> empty."""
        base = datetime.now(ZoneInfo('America/New_York')).date()

        def has_enough(by_day: dict[date, list[dict]]) -> bool:
            days = sum(
                1 for day, events in by_day.items()
                if events and (day != base or any(not is_final(e) for e in events))
            )
            return days >= count

        by_day = await self._countable_events_by_day(base, lookahead_days, enough=has_enough, first_batch=count + 1)
        found: list[str] = []
        for offset in range(lookahead_days + 1):
            day = base + timedelta(days=offset)
            events = by_day.get(day, [])
            if events and (offset > 0 or any(not is_final(e) for e in events)):
                found.append(day.isoformat())
                if len(found) >= count:
                    break

        return found

    async def _ensure_whitelist(self) -> None:
        """Every game date of the season, from ESPN's whitelist calendar —
        static once published, so this is worth caching far longer than the
        5-min schedule caches (a season doesn't grow new game days mid-day)."""
        if (
            self._whitelist_cache['ts'] is not None
            and datetime.now() - self._whitelist_cache['ts'] < timedelta(hours=24)
        ):
            return
        raw = await espn_client.calendar_whitelist_async(self._client)
        self._whitelist_cache.update({
            'dates': {
                datetime.fromisoformat(s.replace('Z', '+00:00'))
                .astimezone(ZoneInfo('America/New_York'))
                .date()
                for s in raw
            },
            'ts': datetime.now(),
        })

    async def _countable_events_by_day(
        self, start: date, lookahead_days: int, enough=None, first_batch: int = 2,
    ) -> dict[date, list[dict]]:
        """Countable events for [start, start + lookahead_days], grouped by
        US/Eastern game date. Candidate days come from the whitelist calendar
        (one cached request for the whole season) — only those specific days
        get fetched, never a whole month just to find out which days have
        games. Empty candidates (offseason) short-circuits with zero
        day-scoreboard calls.

        Days are fetched in date order and the scan stops once ``enough(found)``
        is true for the days read so far (``first_batch`` days first, then the
        rest of the window at once), so the default view reads today and
        tomorrow instead of every day of the week ahead. Each day is cached for
        5 minutes and shared by get_games_today and get_upcoming_game_dates, so
        a page load calling both never double-fetches a day."""
        await self._ensure_whitelist()
        end = start + timedelta(days=lookahead_days)
        candidates = sorted(d for d in self._whitelist_cache['dates'] if start <= d <= end)
        if not candidates:
            return {}

        now = datetime.now()
        self._day_events = {
            d: entry for d, entry in self._day_events.items() if now - entry[0] < _DAY_EVENTS_TTL
        }
        read: list[date] = []
        by_day: dict[date, list[dict]] = {}
        batch = first_batch
        while len(read) < len(candidates):
            chunk = candidates[len(read):len(read) + batch]
            missing = [d for d in chunk if d not in self._day_events]
            if missing:
                responses = await asyncio.gather(
                    *(espn_client.scoreboard_async(self._client, d.strftime('%Y%m%d')) for d in missing)
                )
                fetched_at = datetime.now()
                for d, resp in zip(missing, responses):
                    self._day_events[d] = (fetched_at, [
                        (event_game_date(event), self._slim_event(event))
                        for event in resp.get('events', [])
                        if is_countable(event)
                    ])
            read.extend(chunk)
            for d in chunk:
                for day, event in self._day_events[d][1]:
                    if start <= day <= end:
                        by_day.setdefault(day, []).append(event)
            if enough is not None and enough({d: by_day.get(d, []) for d in read}):
                break
            batch = len(candidates)

        return {d: by_day.get(d, []) for d in read}

    @staticmethod
    def _slim_event(event: dict) -> dict:
        """The parts of a scoreboard event read after the countability filter
        (is_final and _games_from), in the same shape; a full event is ~20 KB."""
        competitors = event.get('competitions', [{}])[0].get('competitors', [])
        return {
            'status': {'type': {'completed': is_final(event)}},
            'competitions': [{'competitors': [
                {'homeAway': c.get('homeAway'), 'team': {'abbreviation': c['team']['abbreviation']}}
                for c in competitors
            ]}],
        }

    @staticmethod
    def _games_from(events: list[dict]) -> dict[str, GameInfo]:
        games: dict[str, GameInfo] = {}
        for event in events:
            competitors = event.get('competitions', [{}])[0].get('competitors', [])
            if len(competitors) == 2:
                a, b = competitors[0], competitors[1]
                # scoreboard abbreviations are site dialect (NY/GS/…) — normalize
                a_abbr = canonical_abbr(a['team']['abbreviation'])
                b_abbr = canonical_abbr(b['team']['abbreviation'])
                games[a_abbr] = GameInfo(opponent=b_abbr, is_home=a.get('homeAway') == 'home')
                games[b_abbr] = GameInfo(opponent=a_abbr, is_home=b.get('homeAway') == 'home')
        return games

    async def close(self) -> None:
        await self._client.aclose()


_shared_service: NbaMatchupService | None = None


def get_shared_matchup_service() -> NbaMatchupService:
    """The one instance every caller shares, so the whitelist, day-events and
    pinned-date caches (and the HTTP connection pool) are fetched once rather
    than once per caller."""
    global _shared_service
    if _shared_service is None:
        _shared_service = NbaMatchupService()
    return _shared_service
