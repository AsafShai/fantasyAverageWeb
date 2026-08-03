import logging

from fastapi import APIRouter, HTTPException

from app.minigames import GAME_SLUGS
from app.minigames import leaderboard as lb
from app.minigames.players import (
    build_nba_team_options,
    find_player_by_id,
    get_players,
    load_bundle,
)
from app.minigames.who_am_i import compute_who_am_i_feedback
from app.models.minigame_models import (
    MinigameLeaderboardResponse,
    QualifyRequest,
    QualifyResponse,
    SubmitLeaderboardRequest,
    WhoAmIGuessRequest,
)

router = APIRouter()
logger = logging.getLogger(__name__)


def _slug_or_404(game_slug: str) -> str:
    if game_slug not in GAME_SLUGS:
        raise HTTPException(status_code=404, detail=f"Unknown game: {game_slug}")
    return game_slug


@router.get("/players")
async def get_minigame_players():
    return load_bundle()


@router.get("/teams")
async def get_minigame_teams():
    return {"teams": build_nba_team_options(get_players())}


@router.get("/{game_slug}/leaderboard", response_model=MinigameLeaderboardResponse)
async def get_leaderboard(game_slug: str):
    _slug_or_404(game_slug)
    try:
        rows = await lb.get_top5(game_slug)
        return {"rows": rows}
    except Exception as e:
        logger.error("leaderboard get failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to load leaderboard")


@router.post("/{game_slug}/leaderboard/qualify", response_model=QualifyResponse)
async def qualify_leaderboard(game_slug: str, body: QualifyRequest):
    _slug_or_404(game_slug)
    try:
        ok = await lb.check_qualifies(game_slug, body.bestStreak, body.hintsUsed)
        return {"qualifies": ok}
    except Exception as e:
        logger.error("qualify check failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to check qualification")


@router.post("/{game_slug}/leaderboard", response_model=MinigameLeaderboardResponse)
async def submit_leaderboard(game_slug: str, body: SubmitLeaderboardRequest):
    _slug_or_404(game_slug)
    try:
        rows = await lb.submit_score(
            game_slug, body.displayName, body.bestStreak, body.hintsUsed
        )
        return {"rows": rows}
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.error("leaderboard submit failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to submit score")


@router.post("/who-am-i/feedback")
async def who_am_i_feedback(body: WhoAmIGuessRequest):
    players = get_players()
    secret = find_player_by_id(players, body.secretPlayerId)
    guess = find_player_by_id(players, body.guessPlayerId)
    if secret is None or guess is None:
        raise HTTPException(status_code=404, detail="Player not found")
    return compute_who_am_i_feedback(secret, guess)
