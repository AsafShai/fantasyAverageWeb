import pytest

from app.services.data_transformer import DataTransformer


def _minimal_stat_row():
    return {
        "0": 100,
        "1": 2,
        "2": 5,
        "3": 20,
        "6": 40,
        "13": 40,
        "14": 85,
        "15": 15,
        "16": 20,
        "17": 10,
        "19": 47.1,
        "20": 75.0,
        "42": 82,
        "40": 2000,
    }


def _standings_payload(team_ids=(1, 2)):
    return {
        "teams": [
            {
                "id": tid,
                "name": f" Team {tid} ",
                "valuesByStat": _minimal_stat_row(),
            }
            for tid in team_ids
        ]
    }


@pytest.fixture
def transformer():
    return DataTransformer()


class TestParseSlotUsage:
    def test_empty_schedule(self, transformer):
        assert transformer.parse_slot_usage({}) == {}
        assert transformer.parse_slot_usage({"schedule": []}) == {}

    def test_counts_only_stat_id_42(self, transformer):
        espn = {
            "schedule": [
                {
                    "teams": [
                        {
                            "teamId": 9,
                            "cumulativeScore": {
                                "statBySlot": {
                                    "0": {"statId": 42, "value": 7},
                                    "1": {"statId": 99, "value": 999},
                                }
                            },
                        }
                    ]
                }
            ]
        }
        out = transformer.parse_slot_usage(espn)
        assert 9 in out
        assert out[9]["PG"] == 7
        assert out[9]["SG"] == 0

    def test_missing_team_id_skipped(self, transformer):
        espn = {
            "schedule": [
                {"teams": [{"cumulativeScore": {"statBySlot": {"0": {"statId": 42, "value": 1}}}}]}
            ]
        }
        assert transformer.parse_slot_usage(espn) == {}


class TestRawStandingsToTotals:
    def test_success(self, transformer):
        df = transformer.raw_standings_to_totals_df(_standings_payload())
        assert len(df) == 2
        assert set(df["team_id"].tolist()) == {1, 2}
        assert "PTS" in df.columns and "GP" in df.columns

    def test_invalid_structure(self, transformer):
        with pytest.raises(Exception, match="Error transforming ESPN standings"):
            transformer.raw_standings_to_totals_df({})

    def test_no_teams(self, transformer):
        with pytest.raises(Exception, match="Error transforming ESPN standings"):
            transformer.raw_standings_to_totals_df({"teams": []})

    def test_team_without_values_by_stat_gets_zero_row(self, transformer):
        """ESPN omits valuesByStat entirely before any games are played
        (preseason) — that's a real zero-stat team, not a missing one, so it
        must be synthesized rather than silently dropped."""
        payload = {"teams": [{"id": 5, "name": " New Team "}]}

        df = transformer.raw_standings_to_totals_df(payload)

        assert len(df) == 1
        row = df.iloc[0]
        assert row["team_id"] == 5
        assert row["team_name"] == "New Team"
        assert row["PTS"] == 0
        assert row["GP"] == 0

    def test_mix_of_teams_with_and_without_stats(self, transformer):
        """A preseason league can have some teams already synced and others
        not — both must survive in the same DataFrame."""
        payload = _standings_payload(team_ids=(1,))
        payload["teams"].append({"id": 2, "name": "No Stats Yet"})

        df = transformer.raw_standings_to_totals_df(payload)

        assert set(df["team_id"].tolist()) == {1, 2}
        no_stats_row = df[df["team_id"] == 2].iloc[0]
        assert no_stats_row["PTS"] == 0


class TestRawStandingsToTeamNames:
    def test_extracts_id_and_stripped_name(self, transformer):
        payload = {"teams": [{"id": 1, "name": " Team Alpha "}, {"id": 2, "name": "Team Beta"}]}

        result = transformer.raw_standings_to_team_names(payload)

        assert result == [
            {"team_id": 1, "team_name": "Team Alpha"},
            {"team_id": 2, "team_name": "Team Beta"},
        ]

    def test_independent_of_values_by_stat(self, transformer):
        """Team identity exists on ESPN's side even before any games are
        played, unlike per-team stat totals — no valuesByStat required."""
        payload = {"teams": [{"id": 9, "name": "Preseason Team"}]}

        result = transformer.raw_standings_to_team_names(payload)

        assert result == [{"team_id": 9, "team_name": "Preseason Team"}]

    def test_skips_teams_missing_id_or_name(self, transformer):
        payload = {"teams": [{"id": 1, "name": "Has Both"}, {"name": "Missing Id"}, {"id": 2, "name": ""}]}

        result = transformer.raw_standings_to_team_names(payload)

        assert result == [{"team_id": 1, "team_name": "Has Both"}]

    def test_missing_teams_key_returns_empty_list(self, transformer):
        assert transformer.raw_standings_to_team_names({}) == []

    def test_none_input_returns_empty_list(self, transformer):
        assert transformer.raw_standings_to_team_names(None) == []


class TestTotalsToAverages:
    def test_divides_by_gp(self, transformer, sample_totals_df):
        avg = transformer.totals_to_averages_df(sample_totals_df)
        assert len(avg) == len(sample_totals_df)
        first_pts = sample_totals_df.iloc[0]["PTS"]
        first_gp = sample_totals_df.iloc[0]["GP"]
        assert abs(avg.iloc[0]["PTS"] - first_pts / first_gp) < 0.01


class TestAveragesToRankings:
    def test_has_rank_columns(self, transformer, sample_averages_df):
        rnk = transformer.averages_to_rankings_df(sample_averages_df)
        assert "RANK" in rnk.columns
        assert "TOTAL_POINTS" in rnk.columns


class TestRawPlayersToDf:
    def test_invalid_raises(self, transformer):
        with pytest.raises(Exception, match="Error transforming ESPN players"):
            transformer.raw_players_to_df({"teams": []})


def _player_entry(player_id, name, team_id=1, stats=None, season_id=2026):
    return {
        "player": {
            "id": player_id,
            "fullName": name,
            "proTeamId": 13,
            "injured": False,
            "eligibleSlots": [0, 1],
            "stats": [
                {
                    "scoringPeriodId": 0,
                    "statSplitTypeId": 0,
                    "seasonId": season_id,
                    "stats": stats if stats is not None else {},
                }
            ],
        },
        "status": "ONTEAM",
        "onTeamId": team_id,
        "ratings": {},
    }


class TestRawAllPlayersToDf:
    def test_invalid_raises(self, transformer):
        with pytest.raises(Exception, match="Error transforming ESPN players"):
            transformer.raw_all_players_to_df({})

    def test_success_maps_stat_columns(self, transformer):
        payload = {"players": [_player_entry(101, "Player A", stats={
            "0": 25.0, "1": 1.2, "2": 1.5, "3": 4.0, "6": 8.0,
            "13": 9.0, "14": 18.0, "15": 5.0, "16": 6.0, "17": 2.0,
            "19": 0.5, "20": 0.83, "42": 70, "40": 32.0,
        })]}

        df = transformer.raw_all_players_to_df(payload)

        assert len(df) == 1
        row = df.iloc[0]
        assert row["Name"] == "Player A"
        assert row["player_id"] == 101
        assert row["PTS"] == 25.0
        assert row["GP"] == 70

    def test_zero_gp_stat_split_synthesizes_zero_row_instead_of_dropping_player(self, transformer):
        """ESPN tags the current-season split before any games are played but
        leaves 'stats' empty — that's a real 0 GP row, not a missing player."""
        payload = {"players": [_player_entry(102, "Rookie R", stats={})]}

        df = transformer.raw_all_players_to_df(payload)

        assert len(df) == 1
        row = df.iloc[0]
        assert row["Name"] == "Rookie R"
        assert row["GP"] == 0
        assert row["PTS"] == 0

    def test_mix_of_players_with_and_without_stats(self, transformer):
        payload = {"players": [
            _player_entry(101, "Veteran V", stats={"0": 10.0, "42": 5}),
            _player_entry(102, "Rookie R", stats={}),
        ]}

        df = transformer.raw_all_players_to_df(payload)

        assert len(df) == 2
        rookie_row = df[df["Name"] == "Rookie R"].iloc[0]
        assert rookie_row["GP"] == 0


class TestResolveRankingCategories:
    def test_no_settings_falls_back_to_default(self, transformer):
        from app.utils.constants import RANKING_CATEGORIES
        assert transformer.resolve_ranking_categories({}) == list(RANKING_CATEGORIES)

    def test_empty_scoring_items_falls_back_to_default(self, transformer):
        from app.utils.constants import RANKING_CATEGORIES
        payload = {"settings": {"scoringSettings": {"scoringItems": []}}}
        assert transformer.resolve_ranking_categories(payload) == list(RANKING_CATEGORIES)

    def test_standard_8_category_league_matches_default(self, transformer):
        from app.utils.constants import RANKING_CATEGORIES
        payload = {"settings": {"scoringSettings": {"scoringItems": [
            {"statId": sid} for sid in (19, 20, 17, 3, 6, 2, 1, 0)
        ]}}}
        assert transformer.resolve_ranking_categories(payload) == list(RANKING_CATEGORIES)

    def test_excludes_non_ranking_stats_like_gp_and_min(self, transformer):
        payload = {"settings": {"scoringSettings": {"scoringItems": [
            {"statId": 0}, {"statId": 42}, {"statId": 40}, {"statId": 13}, {"statId": 14},
        ]}}}
        assert transformer.resolve_ranking_categories(payload) == ["PTS"]

    def test_extra_category_like_turnovers_is_included(self, transformer):
        payload = {"settings": {"scoringSettings": {"scoringItems": [
            {"statId": 0}, {"statId": 11},
        ]}}}
        assert transformer.resolve_ranking_categories(payload) == ["PTS", "TO"]

    def test_unknown_stat_id_is_skipped(self, transformer):
        payload = {"settings": {"scoringSettings": {"scoringItems": [
            {"statId": 0}, {"statId": 9999},
        ]}}}
        assert transformer.resolve_ranking_categories(payload) == ["PTS"]

    def test_duplicate_stat_ids_deduplicated(self, transformer):
        payload = {"settings": {"scoringSettings": {"scoringItems": [
            {"statId": 0}, {"statId": 0},
        ]}}}
        assert transformer.resolve_ranking_categories(payload) == ["PTS"]

    def test_only_non_ranking_stats_falls_back_to_default(self, transformer):
        from app.utils.constants import RANKING_CATEGORIES
        payload = {"settings": {"scoringSettings": {"scoringItems": [
            {"statId": 42}, {"statId": 40},
        ]}}}
        assert transformer.resolve_ranking_categories(payload) == list(RANKING_CATEGORIES)

    def test_malformed_settings_falls_back_to_default(self, transformer):
        from app.utils.constants import RANKING_CATEGORIES
        payload = {"settings": "not-a-dict"}
        assert transformer.resolve_ranking_categories(payload) == list(RANKING_CATEGORIES)

    def test_scoring_item_missing_stat_id_is_skipped(self, transformer):
        payload = {"settings": {"scoringSettings": {"scoringItems": [
            {"statId": 0}, {"notStatId": 1},
        ]}}}
        assert transformer.resolve_ranking_categories(payload) == ["PTS"]

    def test_preserves_espn_scoring_items_order(self, transformer):
        payload = {"settings": {"scoringSettings": {"scoringItems": [
            {"statId": 6}, {"statId": 0}, {"statId": 2},
        ]}}}
        assert transformer.resolve_ranking_categories(payload) == ["REB", "PTS", "STL"]


class TestRawStandingsToTotalsDynamicCategories:
    def test_extra_category_kept_when_present_and_requested(self, transformer):
        payload = {"teams": [{
            "id": 1, "name": "A",
            "valuesByStat": {**_minimal_stat_row(), "11": 12},
        }]}
        df = transformer.raw_standings_to_totals_df(payload, ["PTS", "TO"])
        assert "TO" in df.columns
        assert df.iloc[0]["TO"] == 12

    def test_extra_category_absent_from_espn_payload_is_not_added(self, transformer):
        df = transformer.raw_standings_to_totals_df(_standings_payload(), ["PTS", "TO"])
        assert "TO" not in df.columns

    def test_no_categories_arg_keeps_default_fixed_columns_only(self, transformer):
        payload = {"teams": [{
            "id": 1, "name": "A",
            "valuesByStat": {**_minimal_stat_row(), "11": 12},
        }]}
        df = transformer.raw_standings_to_totals_df(payload)
        assert "TO" not in df.columns


class TestResolveReverseCategories:
    def test_no_settings_returns_empty_set(self, transformer):
        assert transformer.resolve_reverse_categories({}) == set()

    def test_reverse_item_flagged_true_included(self, transformer):
        payload = {"settings": {"scoringSettings": {"scoringItems": [
            {"statId": 0, "isReverseItem": False},
            {"statId": 11, "isReverseItem": True},
        ]}}}
        assert transformer.resolve_reverse_categories(payload) == {"TO"}

    def test_no_reverse_items_returns_empty_set(self, transformer):
        payload = {"settings": {"scoringSettings": {"scoringItems": [
            {"statId": 0, "isReverseItem": False},
            {"statId": 6, "isReverseItem": False},
        ]}}}
        assert transformer.resolve_reverse_categories(payload) == set()

    def test_missing_is_reverse_item_key_treated_as_false(self, transformer):
        payload = {"settings": {"scoringSettings": {"scoringItems": [
            {"statId": 0},
        ]}}}
        assert transformer.resolve_reverse_categories(payload) == set()

    def test_reverse_non_ranking_stat_excluded(self, transformer):
        payload = {"settings": {"scoringSettings": {"scoringItems": [
            {"statId": 42, "isReverseItem": True},
        ]}}}
        assert transformer.resolve_reverse_categories(payload) == set()

    def test_malformed_settings_returns_empty_set(self, transformer):
        assert transformer.resolve_reverse_categories({"settings": "not-a-dict"}) == set()


class TestStatColumnsToKeep:
    """ESPN's stat lines carry every stat it tracks and the id map can now name
    all of them, so what gets materialized has to be chosen deliberately."""

    def test_keeps_the_fixed_set_for_a_default_league(self, transformer):
        keep = transformer.stat_columns_to_keep()

        assert 'PTS' in keep and 'FG%' in keep and 'GP' in keep

    def test_keeps_min_even_though_it_is_not_a_ranking_category(self, transformer):
        """Player responses report minutes directly (response_builder reads
        row['MIN']), so dropping it as 'not a category' breaks them."""
        assert 'MIN' in transformer.stat_columns_to_keep()

    def test_drops_stats_the_league_does_not_score(self, transformer):
        keep = transformer.stat_columns_to_keep()

        for unscored in ('PPG', 'STR', 'DD', 'A/TO', 'OREB', 'AFG%'):
            assert unscored not in keep

    def test_keeps_a_scored_category_beyond_the_fixed_set(self, transformer):
        keep = transformer.stat_columns_to_keep(['PTS', 'REB', 'TO'])

        assert 'TO' in keep

    def test_keeps_the_sources_a_scored_ratio_is_rebuilt_from(self, transformer):
        """3P% over a date range is (3PM delta)/(3PA delta), so 3PA has to
        survive even though nothing scores it on its own."""
        keep = transformer.stat_columns_to_keep(['3P%'])

        assert '3PA' in keep and '3PM' in keep

    def test_leaves_non_stat_columns_untouched(self, transformer):
        import pandas as pd
        df = pd.DataFrame([{
            'Name': 'A', 'player_id': 1, 'status': 'ACTIVE',
            'PTS': 10.0, 'MIN': 30.0, 'PPG': 9.9, 'STR': 'W2',
        }])

        out = transformer._keep_stat_columns(df)

        assert list(out.columns) == ['Name', 'player_id', 'status', 'PTS', 'MIN']
