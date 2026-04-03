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


class TestRawAllPlayersToDf:
    def test_invalid_raises(self, transformer):
        with pytest.raises(Exception, match="Error transforming ESPN players"):
            transformer.raw_all_players_to_df({})
