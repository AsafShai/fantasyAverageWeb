"""How teams moved between two standings: per-category roto points, the total,
places and games played. Shared by the day-over-day movers (two stored
scoring periods) and tonight's movers (this morning's official standings vs
live), so both read the same way.

Points are roto POINTS (higher is better), so a positive delta is always an
improvement, the total included."""
from typing import Mapping, Optional

from app.models import RankMover, TeamRankChange
from app.utils.category_storage import TOTAL_KEY

Points = Mapping[int, Mapping[str, Optional[float]]]


def places(points: Points) -> dict[int, int]:
    """Standard competition ranks by total points: a tie shares the higher place."""
    totals = {tid: cats[TOTAL_KEY] for tid, cats in points.items() if cats.get(TOTAL_KEY) is not None}
    return {tid: 1 + sum(1 for other in totals.values() if other > total) for tid, total in totals.items()}


def movers_between(before: Points, after: Points, names: Mapping[int, str]) -> list[RankMover]:
    """Every (team, category) whose points changed, biggest move first."""
    movers: list[RankMover] = []
    for team_id, latest in after.items():
        previous = before.get(team_id)
        if previous is None:
            continue
        for category, value in latest.items():
            prior = previous.get(category)
            if prior is None or value is None:
                continue
            delta = round(float(value) - float(prior), 2)
            if delta == 0:
                continue
            movers.append(RankMover(team_id=team_id, team_name=names.get(team_id, str(team_id)),
                                    category=category, delta=delta))
    movers.sort(key=lambda m: (-abs(m.delta), m.team_name, m.category))
    return movers


def changes_between(before: Points, after: Points, names: Mapping[int, str],
                    gp_before: Mapping[int, int], gp_after: Mapping[int, int]) -> list[TeamRankChange]:
    """Each team's move in places, points per category and in total, and games played."""
    place_before, place_now = places(before), places(after)
    teams: list[TeamRankChange] = []
    for team_id, latest in after.items():
        previous = before.get(team_id)
        if previous is None:
            continue
        deltas = {
            category: round(float(value) - float(previous[category]), 2)
            for category, value in latest.items()
            if value is not None and previous.get(category) is not None
        }
        total_delta = deltas.pop(TOTAL_KEY, None)
        rank_delta = (place_before[team_id] - place_now[team_id]
                      if team_id in place_before and team_id in place_now else None)
        gp_was, gp_now = gp_before.get(team_id), gp_after.get(team_id)
        teams.append(TeamRankChange(
            team_id=team_id,
            team_name=names.get(team_id, str(team_id)),
            rank_delta=rank_delta,
            total_delta=total_delta,
            gp_delta=None if gp_was is None or gp_now is None else gp_now - gp_was,
            categories=deltas,
        ))
    teams.sort(key=lambda t: t.team_id)
    return teams
