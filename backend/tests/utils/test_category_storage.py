import json

import pandas as pd
import pytest

from app.utils import category_storage
from app.utils.category_storage import (
    RANKINGS_FIXED_CATEGORIES, SNAPSHOT_FIXED_CATEGORIES, TOTAL_KEY,
)


class TestJsonSafe:
    def test_numpy_scalars_become_plain_floats(self):
        row = pd.Series({'PTS': 1120})
        value = category_storage.json_safe(row['PTS'])
        assert isinstance(value, float)
        json.dumps(value)

    @pytest.mark.parametrize("bad", [float('nan'), float('inf'), float('-inf')])
    def test_non_finite_becomes_none(self, bad):
        """NaN/inf are not valid JSON and Postgres rejects the whole payload."""
        assert category_storage.json_safe(bad) is None

    def test_none_stays_none(self):
        assert category_storage.json_safe(None) is None


class TestExtraCategories:
    def test_none_when_league_scores_only_fixed_categories(self):
        """The whole point of extras-only storage: the column stays NULL."""
        row = pd.Series({'team_id': 1, 'team_name': 'A', 'PTS': 1120, 'REB': 400,
                         'GP': 47, 'FGM': 380, 'FGA': 810, 'FG%': 0.469,
                         'FTM': 150, 'FTA': 200, 'FT%': 0.75, '3PM': 100,
                         'AST': 200, 'STL': 50, 'BLK': 20})
        assert category_storage.extra_categories(row, SNAPSHOT_FIXED_CATEGORIES) is None

    def test_captures_only_the_extras(self):
        row = pd.Series({'team_id': 1, 'team_name': 'A', 'PTS': 1120, 'TO': 120})
        assert category_storage.extra_categories(row, SNAPSHOT_FIXED_CATEGORIES) == {'TO': 120.0}

    def test_ignores_identity_and_ranking_bookkeeping_columns(self):
        row = pd.Series({'team_id': 1, 'team_name': 'A', 'RANK': 3,
                         'TOTAL_POINTS': 61, 'PTS': 1120})
        assert category_storage.extra_categories(row, RANKINGS_FIXED_CATEGORIES) is None

    def test_nan_extra_is_dropped_rather_than_serialized(self):
        row = pd.Series({'team_id': 1, 'TO': float('nan')})
        assert category_storage.extra_categories(row, SNAPSHOT_FIXED_CATEGORIES) is None

    def test_output_is_json_serializable(self):
        row = pd.Series({'team_id': 1, 'TO': 120})
        payload = category_storage.extra_categories(row, SNAPSHOT_FIXED_CATEGORIES)
        assert json.loads(category_storage.dumps(payload)) == {'TO': 120.0}

    def test_dumps_passes_none_through_as_sql_null(self):
        assert category_storage.dumps(None) is None


class TestLoads:
    def test_accepts_dict_from_a_codec_registered_connection(self):
        assert category_storage.loads({'TO': 120}) == {'TO': 120}

    def test_accepts_str_from_a_connection_without_the_codec(self):
        assert category_storage.loads('{"TO": 120}') == {'TO': 120}

    @pytest.mark.parametrize("empty", [None, '', {}])
    def test_empty_shapes_become_empty_dict(self, empty):
        assert category_storage.loads(empty) == {}

    def test_malformed_json_does_not_raise(self):
        assert category_storage.loads('{not json') == {}


class TestMergeCategories:
    def test_combines_columns_and_extras(self):
        merged = category_storage.merge_categories({'PTS': 8.0, 'REB': 3.0}, {'TO': 5.0})
        assert merged == {'PTS': 8.0, 'REB': 3.0, 'TO': 5.0}

    def test_drops_null_columns(self):
        merged = category_storage.merge_categories({'PTS': 8.0, 'REB': None}, None)
        assert merged == {'PTS': 8.0}

    def test_extras_win_on_collision(self):
        merged = category_storage.merge_categories({'PTS': 8.0}, {'PTS': 9.0})
        assert merged == {'PTS': 9.0}


class TestRoundTrip:
    def test_write_then_read_reproduces_the_extra_category(self):
        row = pd.Series({'team_id': 1, 'team_name': 'A', 'PTS': 1120, 'TO': 120})
        stored = category_storage.dumps(
            category_storage.extra_categories(row, SNAPSHOT_FIXED_CATEGORIES)
        )
        merged = category_storage.merge_categories({'PTS': 1120.0}, stored)
        assert merged == {'PTS': 1120.0, 'TO': 120.0}

    def test_total_key_is_not_a_category(self):
        """TOTAL rides in the same document but is pulled out before merging."""
        stored = {'TO': 7.0, TOTAL_KEY: 61.0}
        total = stored.pop(TOTAL_KEY)
        assert total == 61.0
        assert category_storage.merge_categories({'PTS': 3.0}, stored) == {'PTS': 3.0, 'TO': 7.0}
