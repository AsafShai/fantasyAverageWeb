from datetime import date
from unittest.mock import AsyncMock, patch

import pytest

from app.models.injury_models import InjuryRecord
from app.services import injury_service
from app.services import with_without_service as svc

IND = 11


def game(gid: str, d: str, opp: str = "NYK", home: bool = True) -> dict:
    return {"game_id": gid, "date": d, "date_obj": date.fromisoformat(d), "opp": opp, "home": home, "result": "W 110-100"}


def line(pid: int, gid: str, name: str = "P", mins: float = 30, pts: float = 20) -> dict:
    r = {c: 1.0 for c in svc._COLUMNS}
    r.update(player_id=pid, player_name=name, position="G", game_id=gid, min=mins, pts=pts)
    return r


def stint(pid: int, start: str, end: str | None = None, source: str = "feed", two_way: bool = False, name: str = "") -> dict:
    return {
        "player_id": pid, "player_name": name, "position": "F",
        "start_date": date.fromisoformat(start), "end_date": date.fromisoformat(end) if end else None,
        "two_way": two_way, "source": source,
    }


GAMES = [game("g1", "2026-10-22"), game("g2", "2026-10-24", "BOS", False), game("g3", "2026-10-26")]


def build(rows, stints, owners=None, outs=None):
    return svc.build_team_payload(
        IND, "2026-27", GAMES, rows, stints, owners or {}, outs or {}, ["PTS", "REB"], [],
    )


def by_id(payload):
    return {p["player_id"]: p for p in payload["players"]}


def test_usage_matches_the_trends_per_game_formula():
    # 100 * (14 + 0.44*2 + 2) * (240/5) / (30 * (88 + 0.44*20 + 13))
    assert svc.usage_pct(14, 2, 2, 30, 88, 20, 13, 240) == pytest.approx(
        100 * (14 + 0.44 * 2 + 2.0) * (240.0 / 5) / (30.0 * (88.0 + 0.44 * 20.0 + 13.0))
    )
    assert svc.usage_pct(1, 1, 1, 0, 10, 10, 10, 240) == 0.0


def test_a_played_game_carries_that_games_usage():
    row = line(1, "g1", mins=30, pts=20)
    row.update(fga=14, fta=2, tov=2, t_fga=88, t_fta=20, t_tov=13)
    p = by_id(build([row], [stint(1, "2026-10-20")]))[1]
    assert p["lines"][0][-1] == round(svc.usage_pct(14, 2, 2, 30, 88, 20, 13, 30), 1)
    assert build([row], [stint(1, "2026-10-20")])["line_fields"][-1] == "USG%"


def test_played_sat_and_not_on_team_are_encoded_separately():
    rows = [line(1, "g1", "Pascal Siakam"), line(1, "g3", "Pascal Siakam")]
    stints = [stint(1, "2026-10-20")]
    p = by_id(build(rows, stints))[1]
    assert p["lines"][0][:2] == [30.0, 20.0]
    assert p["lines"][1] == 0          # on the team, sat
    assert p["lines"][2][:2] == [30.0, 20.0]


def test_hurt_all_season_player_is_listed_from_his_stint():
    p = by_id(build([], [stint(2, "2026-10-20", name="Tyrese Haliburton")]))[2]
    assert p["name"] == "Tyrese Haliburton"
    assert p["lines"] == [0, 0, 0]


def test_mid_season_signing_is_null_before_he_joined():
    p = by_id(build([line(3, "g3")], [stint(3, "2026-10-25")]))[3]
    assert p["lines"][:2] == [None, None]


def test_zero_minute_row_counts_as_sat():
    p = by_id(build([line(4, "g1", mins=0)], [stint(4, "2026-10-20")]))[4]
    assert p["lines"][0] == 0


def test_flags_owner_and_injury():
    payload = build(
        [line(5, "g1", "Tyrese Haliburton")],
        [stint(5, "2026-10-20", source="box", two_way=True)],
        owners={5: {"team_id": 9, "abbrev": "KHA", "name": "Khachapuri"}},
        outs={"tyresehaliburton": {"status": "Out", "note": "Left Hamstring Strain"}},
    )
    p = by_id(payload)[5]
    assert p["two_way"] is True and p["approx"] is True
    assert p["owner"]["team_id"] == 9
    assert p["out_today"]["note"] == "Left Hamstring Strain"
    assert payload["line_fields"][:2] == ["MIN", "PTS"]
    assert "date_obj" not in payload["games"][0]


def test_out_today_maps_report_team_names_to_espn_ids():
    with patch.dict(injury_service.injury_store, {
        "a": InjuryRecord(game="", team="Indiana Pacers", player="Tyrese Haliburton", status="Out", injury="Hamstring", last_update=""),
        "b": InjuryRecord(game="", team="Indiana Pacers", player="T.J. McConnell", status="Questionable", injury="Hamstring", last_update=""),
    }, clear=True):
        outs = svc.out_today_by_team()
        teams = {t["team_id"]: t for t in svc.teams_payload()["teams"]}
    assert list(outs[IND]) == ["tyresehaliburton"]
    assert teams[IND]["has_out_today"] is True
    assert teams[2]["has_out_today"] is False
    assert len(teams) == 30


def test_team_route(test_client):
    svc.clear_cache()
    with patch.object(svc, "_query", AsyncMock(return_value=(GAMES, [line(1, "g1")]))), \
         patch.object(svc.RosterStintsService, "team_stints", AsyncMock(return_value=[stint(1, "2026-10-20")])), \
         patch.object(svc, "_owners", AsyncMock(return_value={})), \
         patch.object(svc, "_league_categories", AsyncMock(return_value=(["PTS", "REB"], set()))):
        res = test_client.get(f"/api/nba/with-without/{IND}")
    assert res.status_code == 200
    body = res.json()
    assert body["abbr"] == "IND" and len(body["games"]) == 3
    assert body["players"][0]["lines"][1] == 0
    assert test_client.get("/api/nba/with-without/99").status_code == 404
    assert len(test_client.get("/api/nba/with-without/teams").json()["teams"]) == 30
