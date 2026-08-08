"""Player-page projection: resolve an NBA player's next scheduled game from the
ESPN schedule, then project that game off the live feature store.

Distinct from the Projections page, which starts from a slate and projects every
player in it — here the player is fixed and the slate has to be found.
"""

from __future__ import annotations

import logging

from app.models.projection_models import PlayerNextGameProjection, ProjectionStats
from app.services.db_service import DBService
from app.services.live_projection_service import LiveProjectionService
from app.services.nba_matchup_service import NbaMatchupService
from app.services.nba_player_catalog import get_player_bio
from app.utils.team_abbr_map import canonical_abbr

logger = logging.getLogger(__name__)

_LOOKAHEAD_DATES = 5
_LOOKBACK_DATES = 10


class PlayerNextGameService:
    def __init__(self) -> None:
        self._matchups = NbaMatchupService()
        self._projections = LiveProjectionService()

    async def next_game_projection(
        self, player_id: str | int, minutes: float | None = None
    ) -> PlayerNextGameProjection | None:
        """The player's next scheduled game, projected. Between seasons there is
        no next game, so it falls back to the team's most recent played game —
        the same what-if view the Projections page's past slates give."""
        bio = get_player_bio(player_id)
        if bio is None:
            return None
        team = canonical_abbr(bio.team_abbr)

        found = await self._find_next_game(team)
        scheduled = found is not None
        if found is None:
            found = await self._find_recent_game(team)
        if found is None:
            return None
        game_date, opponent, is_home = found

        proj = await self._projections.project_next_game(
            bio.display_name, opponent, is_home, minutes
        )
        if proj is None:
            return None
        return PlayerNextGameProjection(
            player_name=bio.display_name,
            team=team,
            game_date=game_date,
            opponent=opponent,
            is_home=is_home,
            scheduled=scheduled,
            default_minutes=proj['default_minutes'],
            status=proj['status'],
            reason=proj['reason'],
            stats=ProjectionStats(**proj['stats']) if proj['stats'] else None,
        )

    async def _find_next_game(self, team: str) -> tuple[str, str, bool] | None:
        """(iso date, opponent abbr, is_home) for the team's next game, or None."""
        games = await self._matchups.get_games_today()
        resolved = self._matchups.get_schedule_date()
        info = games.get(team)
        if info is not None and resolved:
            return resolved, canonical_abbr(info.opponent), info.is_home

        for iso in await self._matchups.get_upcoming_game_dates(count=_LOOKAHEAD_DATES):
            if iso == resolved:
                continue
            day_games = await self._matchups.get_games_today(iso.replace('-', ''))
            info = day_games.get(team)
            if info is not None:
                return iso, canonical_abbr(info.opponent), info.is_home
        return None

    async def _find_recent_game(self, team: str) -> tuple[str, str, bool] | None:
        """Offseason fallback: the team's latest played game, from the dates the
        feature store already knows about."""
        dates = await DBService().get_recent_game_dates()
        for day in dates[:_LOOKBACK_DATES]:
            iso = day.isoformat()
            day_games = await self._matchups.get_games_today(iso.replace('-', ''))
            info = day_games.get(team)
            if info is not None:
                return iso, canonical_abbr(info.opponent), info.is_home
        return None
