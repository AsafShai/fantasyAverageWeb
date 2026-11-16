from datetime import date

from app.services.roster_stints.feed import (
    CLAIMED, CONVERTED, SIGNING, TRADE, WAIVE, FeedRow, parse_feed,
)
from app.services.roster_stints.matching import EspnPlayer, FeedPlayer, match_players, name_tokens
from app.services.roster_stints.replay import Stint, build_stints, feed_intervals, merge_box
from app.services.roster_stints.service import compute_stints

SEASON_START = date(2026, 10, 20)
TODAY = date(2026, 11, 15)
PHI, NYK, IND, OKC, SAC, CHI = 20, 18, 11, 25, 23, 4


def row(day: str, kind: str, team: int, desc: str = "", pid: int = 1, slug: str = "joe-player") -> FeedRow:
    return FeedRow(date.fromisoformat(day), kind, team, pid, slug, desc, day)


def stints(rows, apps=(), today=TODAY, current=None):
    return build_stints(list(rows), list(apps), SEASON_START, today, current)


# --- feed parsing ----------------------------------------------------------

def test_parse_feed_maps_teams_and_skips_rows_without_a_player():
    payload = {"NBA_Player_Movement": {"rows": [
        {"Transaction_Type": "Trade", "TRANSACTION_DATE": "2026-11-08T00:00:00",
         "TRANSACTION_DESCRIPTION": "Oklahoma City Thunder received guard Nique Clifford from Sacramento Kings.",
         "TEAM_SLUG": "thunder", "PLAYER_ID": 1642363.0, "PLAYER_SLUG": "nique-clifford", "GroupSort": "Trade 1"},
        {"Transaction_Type": "Trade", "TRANSACTION_DATE": "2026-11-08T00:00:00",
         "TRANSACTION_DESCRIPTION": "Oklahoma City Thunder received draft consideration from Atlanta Hawks.",
         "TEAM_SLUG": "thunder", "PLAYER_ID": None, "PLAYER_SLUG": None, "GroupSort": "Trade 2"},
        {"Transaction_Type": "Signing", "TRANSACTION_DATE": "2026-10-01T00:00:00",
         "TRANSACTION_DESCRIPTION": "Philadelphia 76ers signed guard X to a Contract.",
         "TEAM_SLUG": "sixers", "PLAYER_ID": 5.0, "PLAYER_SLUG": "x", "GroupSort": "Signing 3"},
    ]}}
    rows = parse_feed(payload)
    assert [(r.team_id, r.nba_player_id) for r in rows] == [(PHI, 5), (OKC, 1642363)]


# --- feed replay -----------------------------------------------------------

def test_long_tenured_player_is_on_his_team_from_opening_night():
    # Haliburton-style: last transaction years ago, never moved since.
    s = stints([row("2022-02-08", TRADE, IND, "Indiana Pacers received guard T from Sacramento Kings.")], current=IND)
    assert s == [Stint(IND, SEASON_START, None, False, "feed")]


def test_expired_contract_is_not_carried_into_the_season():
    # Plumlee: a rest-of-season deal with SAS last February, now on SAC.
    s = stints([
        row("2026-02-27", SIGNING, 24, "San Antonio Spurs signed forward to a Rest-of-Season Contract."),
        row("2026-11-11", SIGNING, SAC, "Sacramento Kings signed forward to a Rest-of-Season Contract."),
    ], current=SAC)
    assert s == [Stint(SAC, date(2026, 11, 11), None)]


def test_carryover_confirmed_by_a_trade_away_this_season():
    # Hurt all season on SAC, then traded: no SAC appearance, not on SAC today.
    s = stints([
        row("2025-07-03", SIGNING, SAC, "signed."),
        row("2026-11-08", TRADE, OKC, "Oklahoma City Thunder received guard from Sacramento Kings."),
    ], current=OKC)
    assert s == [Stint(SAC, SEASON_START, date(2026, 11, 7)), Stint(OKC, date(2026, 11, 8), None)]


def test_hurt_from_opening_night_has_an_open_stint_without_appearances():
    s = stints([row("2025-07-01", SIGNING, PHI, "signed to a Contract.")], apps=[], current=PHI)
    assert s == [Stint(PHI, SEASON_START, None)]


def test_mid_season_trade_closes_the_old_team_the_day_before():
    s = stints([
        row("2025-07-03", SIGNING, SAC, "re-signed guard to a Rookie Scale Contract."),
        row("2026-11-08", TRADE, OKC, "Oklahoma City Thunder received guard from Sacramento Kings."),
    ], apps=[(date(2026, 10, 22), SAC)])
    assert s == [Stint(SAC, SEASON_START, date(2026, 11, 7)), Stint(OKC, date(2026, 11, 8), None)]


def test_waive_then_sign_elsewhere():
    s = stints([
        row("2026-07-01", SIGNING, PHI, "signed to a Contract."),
        row("2026-11-01", WAIVE, PHI, "waived."),
        row("2026-11-05", SIGNING, CHI, "signed to a Rest-of-Season Contract."),
    ])
    assert s == [Stint(PHI, SEASON_START, date(2026, 10, 31)), Stint(CHI, date(2026, 11, 5), None)]


def test_mid_season_signing_does_not_count_games_before_he_joined():
    s = stints([row("2026-11-13", SIGNING, CHI, "Chicago Bulls signed center to a Rest-of-Season Contract.")])
    assert s == [Stint(CHI, date(2026, 11, 13), None)]


def test_ten_day_contract_expires_without_a_transaction():
    s = stints([row("2026-10-25", SIGNING, IND, "signed to a 10-Day Contract.")])
    assert s == [Stint(IND, date(2026, 10, 25), date(2026, 11, 3))]


def test_second_ten_day_extends_the_first():
    s = stints([
        row("2026-10-25", SIGNING, IND, "signed to a 10-Day Contract."),
        row("2026-11-04", SIGNING, IND, "signed to a 10-Day Contract."),
    ])
    assert s == [Stint(IND, date(2026, 10, 25), date(2026, 11, 13))]


def test_ten_day_from_last_season_is_not_carried_into_this_one():
    # Wiseman: his last feed row is a December 2025 10-day.
    assert stints([row("2025-12-20", SIGNING, IND, "signed to a 10-Day Contract.")]) == []


def test_two_way_flag_and_conversion():
    s = stints([
        row("2026-08-17", SIGNING, IND, "Indiana Pacers signed guard to a Two-Way Contract."),
        row("2026-11-10", CONVERTED, IND, "Indiana Pacers converted the contract of guard to a Standard Contract."),
    ])
    assert s == [Stint(IND, SEASON_START, date(2026, 11, 9), True), Stint(IND, date(2026, 11, 10), None, False)]


def test_same_team_extension_changes_nothing():
    s = stints([
        row("2023-07-06", SIGNING, IND, "re-signed guard to a Rookie Scale Extension."),
        row("2026-10-01", SIGNING, IND, "re-signed guard to a Veteran Extension."),
    ])
    assert s == [Stint(IND, SEASON_START, None)]


def test_waiver_claim_moves_the_player():
    s = stints([
        row("2026-07-01", SIGNING, PHI, "signed to a Contract."),
        row("2026-10-30", WAIVE, PHI, "waived."),
        row("2026-11-01", CLAIMED, CHI, "Chicago Bulls claimed guard off waivers."),
    ])
    assert s == [Stint(PHI, SEASON_START, date(2026, 10, 29)), Stint(CHI, date(2026, 11, 1), None)]


def test_waive_by_another_team_means_he_left():
    # Omier: MIN waived him with no MIN signing in the feed.
    s = feed_intervals([
        row("2026-07-01", SIGNING, PHI, "signed to a Contract."),
        row("2026-10-30", WAIVE, CHI, "waived."),
    ], TODAY)
    assert s == [Stint(PHI, date(2026, 7, 1), date(2026, 10, 29))]


def test_conversion_by_another_team_moves_him():
    # Ingram: Utah converted his contract; the feed has no Utah signing.
    s = stints([
        row("2025-08-06", SIGNING, 24, "San Antonio Spurs re-signed forward to a Two-Way Contract."),
        row("2026-10-17", CONVERTED, 26, "Utah Jazz converted the contract of forward to a Two-Way Contract."),
    ], current=26)
    assert s == [Stint(26, SEASON_START, None, True)]


# --- box-score correction --------------------------------------------------

def test_box_appearance_without_a_feed_row_opens_a_stint():
    # Wiseman: no Knicks signing in the feed, but he played for them.
    s = stints(
        [row("2025-12-20", SIGNING, IND, "signed to a 10-Day Contract.")],
        apps=[(date(2026, 11, 14), NYK), (date(2026, 11, 15), NYK)],
    )
    assert s == [Stint(NYK, date(2026, 11, 14), None, False, "box")]


def test_box_appearance_before_the_feed_date_moves_the_start_earlier():
    s = stints(
        [row("2026-11-13", SIGNING, CHI, "signed to a Rest-of-Season Contract.")],
        apps=[(date(2026, 11, 12), CHI)],
    )
    assert s == [Stint(CHI, date(2026, 11, 12), None, False, "feed+box")]


def test_box_appearance_trims_the_other_team():
    # The feed is a day late on a trade: he already played for OKC on the 8th.
    s = stints(
        [
            row("2026-07-03", SIGNING, SAC, "signed."),
            row("2026-11-09", TRADE, OKC, "Oklahoma City Thunder received guard from Sacramento Kings."),
        ],
        apps=[(date(2026, 11, 5), SAC), (date(2026, 11, 8), OKC), (date(2026, 11, 10), OKC)],
    )
    assert s == [
        Stint(SAC, SEASON_START, date(2026, 11, 7)),
        Stint(OKC, date(2026, 11, 8), None, False, "feed+box"),
    ]


def test_missed_trade_does_not_leave_the_old_team_open():
    s = merge_box(
        [Stint(SAC, SEASON_START, None)],
        [(date(2026, 10, 25), SAC), (date(2026, 11, 10), OKC)],
        has_feed=True,
    )
    assert s == [Stint(SAC, SEASON_START, date(2026, 11, 9)), Stint(OKC, date(2026, 11, 10), None, False, "box")]


def test_unmatched_player_gets_box_only_stints():
    s = stints([], apps=[(date(2026, 10, 22), PHI), (date(2026, 11, 2), PHI)])
    assert s == [Stint(PHI, date(2026, 10, 22), None, False, "box_only")]


# --- name matching ---------------------------------------------------------

def test_name_tokens_drop_suffixes_accents_and_punctuation():
    assert name_tokens("Chris Cenac Jr.") == ["chris", "cenac"]
    assert name_tokens("christopher-cenac-jr") == ["christopher", "cenac"]
    assert name_tokens("Nikola Jokić") == ["nikola", "jokic"]
    assert name_tokens("D'Angelo Russell") == ["dangelo", "russell"]


def test_matching_handles_swaps_aliases_and_suffixes():
    espn = [
        EspnPlayer(10, "Yang Hansen", {22}),
        EspnPlayer(11, "Chris Cenac Jr.", {2}),
        EspnPlayer(12, "Dereck Lively II", {6}),
        EspnPlayer(13, "Tyrese Haliburton", {11}),
    ]
    feed = [
        FeedPlayer(1, "hansen-yang", {22}),
        FeedPlayer(2, "christopher-cenac-jr", {2}),
        FeedPlayer(3, "dereck-lively", {6}),
        FeedPlayer(4, "tyrese-haliburton", {11}),
        FeedPlayer(5, "nobody-here", {11}),
    ]
    matched, unmatched = match_players(feed, espn)
    assert matched == {1: 10, 2: 11, 3: 12, 4: 13}
    assert [p.slug for p in unmatched] == ["nobody-here"]


def test_matching_uses_teams_to_break_a_name_tie():
    espn = [EspnPlayer(20, "Jalen Williams", {25}), EspnPlayer(21, "Jalen Williams", {7})]
    matched, _ = match_players([FeedPlayer(1, "jalen-williams", {7})], espn)
    assert matched == {1: 21}


# --- whole rebuild, pure ---------------------------------------------------

def test_compute_stints_end_to_end():
    feed = [
        row("2022-02-08", TRADE, IND, "Indiana Pacers received guard from Sacramento Kings.", pid=1, slug="tyrese-haliburton"),
        row("2026-11-13", SIGNING, CHI, "Chicago Bulls signed center to a Contract.", pid=2, slug="orlando-robinson"),
    ]
    appearances = [
        (100, "Pascal Siakam", IND, date(2026, 10, 22)),
        (102, "Orlando Robinson", CHI, date(2026, 11, 14)),
    ]
    rosters = {101: ("Tyrese Haliburton", IND), 100: ("Pascal Siakam", IND)}
    out, unmatched = compute_stints(feed, appearances, rosters, SEASON_START, TODAY)
    assert unmatched == []
    assert out[101] == [Stint(IND, SEASON_START, None)]                      # hurt all season
    assert out[102] == [Stint(CHI, date(2026, 11, 13), None)]                # mid-season signing
    assert out[100] == [Stint(IND, date(2026, 10, 22), None, False, "box_only")]  # no feed rows
