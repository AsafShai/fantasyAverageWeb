from fastapi import APIRouter, HTTPException

from app.services import with_without_service as svc

router = APIRouter()


@router.get("/teams")
async def teams():
    """The 30 NBA teams, flagging those with a player Out on today's report."""
    return svc.teams_payload()


@router.get("/{team_id}")
async def team(team_id: int):
    """One team's season, game by game, for the With / Without page."""
    try:
        return await svc.team_payload(team_id)
    except svc.UnknownTeam as exc:
        raise HTTPException(status_code=404, detail="Unknown team") from exc
