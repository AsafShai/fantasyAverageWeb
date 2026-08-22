from app.models.adp import AdpPlayer, SiteAdp
from app.services.adp_query import paginate_players, sort_players, three_rr_rounds


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


def test_snake_board_pages_by_rounds():
    players = [_p(f"P{i}", blend=float(i), pid=str(i)) for i in range(1, 25)]
    page1, total, page_n, pages, offset = paginate_players(
        players, page=1, page_size=12, board=12, sort="blend"
    )
    assert total == 24
    assert page_n == 1
    assert pages == 2
    assert offset == 0
    assert [p.id for p in page1] == [str(i) for i in range(1, 13)]

    page2, total2, page_n2, pages2, offset2 = paginate_players(
        players, page=2, page_size=12, board=12
    )
    assert total2 == 24
    assert page_n2 == 2
    assert pages2 == 2
    assert offset2 == 12
    assert [p.id for p in page2] == [str(i) for i in range(24, 12, -1)]

    players36 = [_p(f"P{i}", blend=float(i), pid=str(i)) for i in range(1, 37)]
    page3, *_ = paginate_players(players36, page=3, page_size=12, board=12)
    assert [p.id for p in page3] == [str(i) for i in range(36, 24, -1)]


def test_board_stops_after_fifteen_rounds():
    players = [_p(f"P{i}", blend=float(i), pid=str(i)) for i in range(1, 201)]
    page, total, _page_n, pages, _offset = paginate_players(
        players, page=1, page_size=12, board=12
    )
    assert total == 180
    assert pages == 15
    assert [p.id for p in page] == [str(i) for i in range(1, 13)]
    last, *_ = paginate_players(players, page=15, page_size=12, board=12)
    assert [p.id for p in last] == [str(i) for i in range(180, 168, -1)]


def test_three_rr_rounds_repeats_reverse_on_round_three():
    players = [_p(f"P{i}", blend=float(i), pid=str(i)) for i in range(1, 13)]
    rounds = three_rr_rounds(players, 3)
    assert [p.id for p in rounds[0]] == ["1", "2", "3"]
    assert [p.id for p in rounds[1]] == ["6", "5", "4"]
    assert [p.id for p in rounds[2]] == ["9", "8", "7"]
    assert [p.id for p in rounds[3]] == ["10", "11", "12"]
