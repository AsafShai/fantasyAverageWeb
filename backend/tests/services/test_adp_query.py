from app.models.adp import AdpPlayer, SiteAdp
from app.services.adp_query import paginate_players, sort_players


def _p(name: str, *, blend=None, espn=None, team=None, positions=None, pid=None) -> AdpPlayer:
    return AdpPlayer(
        id=pid or name,
        name=name,
        team_abbr=team,
        positions=positions or ["PG"],
        espn=SiteAdp(adp=espn),
        blend=blend,
        blend_rank=1 if blend is not None else None,
        spread=None,
    )


def test_paginate_returns_requested_page():
    players = [_p(f"P{i}", blend=float(i), pid=str(i)) for i in range(1, 8)]
    page, total, page_n, pages, offset = paginate_players(players, page=2, page_size=3, sort="blend")
    assert total == 7
    assert page_n == 2
    assert pages == 3
    assert offset == 3
    assert [p.name for p in page] == ["P4", "P5", "P6"]


def test_paginate_filters_search_and_ranked_only():
    players = [
        _p("Nikola Jokic", blend=1.0, team="DEN", pid="1"),
        _p("Jamal Murray", blend=20.0, team="DEN", pid="2"),
        _p("Catalog Only", blend=None, team="BOS", pid="3"),
    ]
    page, total, *_ = paginate_players(players, q="den", ranked_only=True)
    assert total == 2
    assert {p.name for p in page} == {"Nikola Jokic", "Jamal Murray"}


def test_sort_nulls_always_last():
    players = [
        _p("A", blend=5.0, espn=None, pid="a"),
        _p("B", blend=2.0, espn=1.0, pid="b"),
        _p("C", blend=8.0, espn=None, pid="c"),
    ]
    asc = sort_players(players, "espn", "asc")
    desc = sort_players(players, "espn", "desc")
    assert [p.id for p in asc] == ["b", "a", "c"]
    assert [p.id for p in desc] == ["b", "a", "c"]


def test_ids_preserves_request_order():
    players = [_p("A", blend=1, pid="a"), _p("B", blend=2, pid="b"), _p("C", blend=3, pid="c")]
    page, total, *_ = paginate_players(players, ids=["c", "a", "missing"])
    assert [p.id for p in page] == ["c", "a"]
    assert total == 2
