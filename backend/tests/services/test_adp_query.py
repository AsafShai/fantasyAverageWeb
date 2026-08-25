from app.models.adp import AdpPlayer, SiteAdp
from app.services.adp_query import filter_players, paginate_players, sort_players, to_index_player


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


def _rank_p(name: str, *, blend, ranking_blend, espn_adp=None, espn_ranking=None) -> AdpPlayer:
    return AdpPlayer(
        id=name,
        name=name,
        positions=["PG"],
        espn=SiteAdp(adp=espn_adp, ranking=espn_ranking),
        blend=blend,
        blend_rank=None,
        ranking_blend=ranking_blend,
        ranking_blend_rank=None,
    )


def test_metric_switches_which_blend_sorts_and_filters():
    players = [
        _rank_p("A", blend=1.0, ranking_blend=50.0),
        _rank_p("B", blend=40.0, ranking_blend=2.0),
        _rank_p("C", blend=None, ranking_blend=8.0),
    ]
    by_adp, total_adp, *_ = paginate_players(players, sort="blend", metric="adp")
    assert [p.id for p in by_adp] == ["A", "B"]  # C has no ADP blend, so ranked_only drops it
    assert total_adp == 2

    by_rank, total_rank, *_ = paginate_players(players, sort="blend", metric="rank")
    assert [p.id for p in by_rank] == ["B", "C", "A"]
    assert total_rank == 3


def test_site_columns_sort_by_ranking_on_the_rankings_view():
    players = [
        _rank_p("A", blend=1.0, ranking_blend=1.0, espn_adp=1.0, espn_ranking=90),
        _rank_p("B", blend=2.0, ranking_blend=2.0, espn_adp=2.0, espn_ranking=4),
    ]
    assert [p.id for p in sort_players(players, "espn", "asc", "adp")] == ["A", "B"]
    assert [p.id for p in sort_players(players, "espn", "asc", "rank")] == ["B", "A"]


def test_index_player_carries_both_blends():
    p = _rank_p("A", blend=3.0, ranking_blend=11.0)
    row = to_index_player(p.model_copy(update={"blend_rank": 1, "ranking_blend_rank": 4}))
    assert row.blend == 3.0
    assert row.blend_rank == 1
    assert row.ranking_blend == 11.0
    assert row.ranking_blend_rank == 4


def _pool_player(name: str, *, blend=None, ranking_blend=None, fringe=False) -> AdpPlayer:
    return AdpPlayer(
        id=name,
        name=name,
        positions=["PG"],
        blend=blend,
        ranking_blend=ranking_blend,
        fringe=fringe,
    )


def test_fringe_players_are_excluded_unless_asked_for():
    players = [
        _pool_player("Real", blend=10.0, ranking_blend=10.0),
        _pool_player("Out Of League", ranking_blend=400.0, fringe=True),
    ]
    assert [p.id for p in filter_players(players, metric="any")] == ["Real"]
    assert len(filter_players(players, metric="any", include_fringe=True)) == 2


def test_any_metric_keeps_players_the_other_blend_covers():
    """The board pool must not change when the user flips the order."""
    players = [
        _pool_player("Adp Only", blend=30.0),
        _pool_player("Rank Only", ranking_blend=120.0),
    ]
    assert len(filter_players(players, metric="adp")) == 1
    assert len(filter_players(players, metric="rank")) == 1
    assert len(filter_players(players, metric="any")) == 2


def test_players_tied_on_adp_fall_back_to_the_other_metric():
    """ESPN parks hundreds of undrafted players on the same value; the alphabet must not
    decide who among them comes first."""
    players = [
        _pool_player("Aaron Undrafted", blend=140.0, ranking_blend=520.0),
        _pool_player("Zeke Undrafted", blend=140.0, ranking_blend=260.0),
    ]
    ordered = sort_players(players, "blend", "asc", "adp")
    assert [p.id for p in ordered] == ["Zeke Undrafted", "Aaron Undrafted"]


def test_unblended_tail_falls_back_to_the_other_metric_not_the_alphabet():
    players = [
        _pool_player("Aaron Alphabetical", ranking_blend=500.0),
        _pool_player("Zeke Highly Ranked", ranking_blend=210.0),
        _pool_player("Drafted Guy", blend=44.0, ranking_blend=300.0),
    ]
    ordered = sort_players(players, "blend", "asc", "adp")
    assert [p.id for p in ordered] == ["Drafted Guy", "Zeke Highly Ranked", "Aaron Alphabetical"]
