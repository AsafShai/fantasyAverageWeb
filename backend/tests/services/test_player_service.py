from datetime import date

import pandas as pd
import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, MagicMock

from app.exceptions import ResourceNotFoundError
import app.services.player_service as player_service_module
from app.services.player_service import (
    PlayerService,
    build_windowed_players_df,
    espn_season_string,
)
from app.models import PaginatedPlayers, Player, PlayerStats, StatTimePeriod


def _sample_player(name: str = "P1") -> Player:
    return Player(
        player_name=name,
        pro_team="T",
        positions=["PG"],
        stats=PlayerStats(
            pts=1,
            reb=1,
            ast=1,
            stl=1,
            blk=1,
            fgm=1,
            fga=1,
            ftm=1,
            fta=1,
            fg_percentage=0.5,
            ft_percentage=0.5,
            three_pm=1,
            minutes=1,
            gp=82,
        ),
        team_id=1,
        status="Active",
        injured=False,
    )


@pytest.fixture
def player_service():
    svc = object.__new__(PlayerService)
    svc.data_provider = MagicMock()
    svc.data_provider.db_service = MagicMock()
    svc.data_provider.db_service.aggregate_player_games = AsyncMock(
        return_value=(pd.DataFrame(), None, None)
    )
    from app.utils.constants import RANKING_CATEGORIES
    svc.data_provider.get_ranking_categories = AsyncMock(return_value=list(RANKING_CATEGORIES))
    svc.data_provider.get_reverse_categories = AsyncMock(return_value=set())
    svc.response_builder = MagicMock()
    svc.logger = MagicMock()
    return svc


@pytest.fixture
def sample_window_players_df():
    """ESPN-shaped players DataFrame (has the columns build_windowed_players_df
    actually reads/writes), unlike the team-stats fixtures reused elsewhere."""
    return pd.DataFrame({
        'Name': ['Player X', 'Player Y', 'Player Z'],
        'team_id': [1, 2, 3],
        'Pro Team': ['LAL', 'BOS', 'GSW'],
        'Positions': ['PG', 'SF', 'C'],
        'PTS': [200.0, 180.0, 220.0],
        'REB': [50.0, 70.0, 90.0],
        'AST': [40.0, 30.0, 20.0],
        'STL': [10.0, 10.0, 10.0],
        'BLK': [5.0, 10.0, 15.0],
        'FGM': [70.0, 60.0, 80.0],
        'FGA': [150.0, 130.0, 160.0],
        'FTM': [30.0, 20.0, 30.0],
        'FTA': [40.0, 30.0, 40.0],
        'FG%': [46.7, 46.2, 50.0],
        'FT%': [75.0, 66.7, 75.0],
        '3PM': [10.0, 15.0, 5.0],
        'GP': [70, 65, 75],
        'MIN': [300.0, 280.0, 320.0],
    })


@pytest.fixture(autouse=True)
def fixed_anchor_date(monkeypatch):
    """Default: fixed anchor so tests aren't sensitive to real calendar today
    (and don't need a working db_service.get_latest_game_date mock). Override
    via monkeypatch in specific tests that care about the resolved window."""
    monkeypatch.setattr(
        player_service_module, "get_season_anchor_date", AsyncMock(return_value=date(2026, 7, 10))
    )


class TestGetAllPlayers:
    @pytest.mark.asyncio
    async def test_success(self, player_service, sample_window_players_df):
        player_service.data_provider.get_players_df = AsyncMock(return_value=sample_window_players_df)
        mock_players = [_sample_player("A")]
        player_service.response_builder.build_all_players_response.return_value = mock_players

        result = await player_service.get_all_players(page=1, limit=10, time_period=StatTimePeriod.SEASON)

        assert isinstance(result, PaginatedPlayers)
        assert result.players == mock_players
        assert result.total_count == 3
        assert result.page == 1
        assert result.limit == 10
        assert result.has_more is False
        assert result.actual_start is None
        assert result.actual_end is None
        from app.utils.constants import RANKING_CATEGORIES
        assert result.categories == list(RANKING_CATEGORIES)

    @pytest.mark.asyncio
    async def test_has_more_second_page(self, player_service, sample_window_players_df):
        player_service.data_provider.get_players_df = AsyncMock(return_value=sample_window_players_df)
        player_service.response_builder.build_all_players_response.side_effect = (
            lambda df, categories=None: [_sample_player(f"P{i}") for i in range(len(df))]
        )

        result = await player_service.get_all_players(page=1, limit=2, time_period=StatTimePeriod.SEASON)
        assert result.has_more is True
        assert len(result.players) == 2

        page2 = await player_service.get_all_players(page=2, limit=2, time_period=StatTimePeriod.SEASON)
        assert len(page2.players) == 1
        assert page2.has_more is False

    @pytest.mark.asyncio
    async def test_none_df_raises(self, player_service):
        player_service.data_provider.get_players_df = AsyncMock(return_value=None)
        with pytest.raises(ResourceNotFoundError, match="No players found"):
            await player_service.get_all_players()

    @pytest.mark.asyncio
    async def test_empty_df_raises(self, player_service):
        player_service.data_provider.get_players_df = AsyncMock(return_value=pd.DataFrame())
        with pytest.raises(ResourceNotFoundError, match="No players found"):
            await player_service.get_all_players()

    @pytest.mark.asyncio
    async def test_custom_period_passes_actual_dates_through(self, player_service, sample_window_players_df):
        player_service.data_provider.get_players_df = AsyncMock(return_value=sample_window_players_df)
        player_service.data_provider.db_service.aggregate_player_games = AsyncMock(
            return_value=(pd.DataFrame(), date(2026, 1, 2), date(2026, 1, 9))
        )
        player_service.response_builder.build_all_players_response.return_value = []

        result = await player_service.get_all_players(
            time_period=StatTimePeriod.CUSTOM, start=date(2026, 1, 1), end=date(2026, 1, 10)
        )

        assert result.actual_start == date(2026, 1, 2)
        assert result.actual_end == date(2026, 1, 9)


def test_espn_season_string():
    assert espn_season_string(2026) == "2025-26"
    assert espn_season_string(2031) == "2030-31"


class TestBuildWindowedPlayersDf:
    """The core join/fallback logic: known-with-games, known-zero-games
    (including season-long-injury), unknown-preset-fallback, custom-always-known."""

    def _db_service(self, agg_df=None):
        db = MagicMock()
        db.aggregate_player_games = AsyncMock(
            return_value=(agg_df if agg_df is not None else pd.DataFrame(), date(2026, 1, 2), date(2026, 1, 9))
        )
        return db

    @pytest.mark.asyncio
    async def test_known_player_uses_db_totals(self, sample_window_players_df):
        agg_df = pd.DataFrame([{
            'player_id': 1, 'player_name': 'Player X', 'gp': 4,
            'pts': 100.0, 'reb': 20.0, 'ast': 16.0, 'stl': 4.0, 'blk': 2.0,
            'fgm': 28.0, 'fga': 60.0, 'ftm': 12.0, 'fta': 16.0,
            'three_pm': 4.0, 'min': 120.0,
            'fg_pct': 28.0 / 60.0, 'ft_pct': 12.0 / 16.0,
        }])
        db = self._db_service(agg_df)

        merged, actual_start, actual_end = await build_windowed_players_df(
            StatTimePeriod.LAST_7, sample_window_players_df, db
        )

        row = merged[merged['Name'] == 'Player X'].iloc[0]
        assert row['GP'] == 4
        assert row['PTS'] == 100.0
        assert row['FG%'] == pytest.approx(28.0 / 60.0)
        assert bool(row['has_data']) is True
        assert actual_start == date(2026, 1, 2)
        assert actual_end == date(2026, 1, 9)

    @pytest.mark.asyncio
    async def test_known_player_zero_games_in_window_keeps_espn_value(
        self, sample_window_players_df
    ):
        """Player Y is on an ESPN roster (Pro Team != 'FA') but has no rows in
        this window — this is indistinguishable from a DB ingest gap for just
        this player, so the preset keeps ESPN's own split value instead of
        forcing a zero (unlike custom ranges, which have no ESPN fallback)."""
        agg_df = pd.DataFrame([{
            'player_id': 1, 'player_name': 'Player X', 'gp': 2,
            'pts': 40.0, 'reb': 10.0, 'ast': 8.0, 'stl': 2.0, 'blk': 1.0,
            'fgm': 14.0, 'fga': 30.0, 'ftm': 6.0, 'fta': 8.0,
            'three_pm': 2.0, 'min': 60.0,
            'fg_pct': 14.0 / 30.0, 'ft_pct': 6.0 / 8.0,
        }])
        db = self._db_service(agg_df)

        merged, _, _ = await build_windowed_players_df(
            StatTimePeriod.LAST_7, sample_window_players_df, db
        )

        row = merged[merged['Name'] == 'Player Y'].iloc[0]
        assert row['GP'] == 65
        assert row['PTS'] == 180.0
        assert bool(row['has_data']) is True

    @pytest.mark.asyncio
    async def test_known_player_out_all_season_is_zero_row_not_no_data(
        self, sample_window_players_df
    ):
        """Regression: a real, identifiable player out all season (e.g. a
        season-ending injury) must NOT collapse into 'no data' just because
        fs_player_games has zero rows for them all year — custom ranges treat
        every player as known regardless of the aggregation window."""
        db = self._db_service(pd.DataFrame())  # nobody has any games in fs_player_games at all

        merged, _, _ = await build_windowed_players_df(
            StatTimePeriod.CUSTOM, sample_window_players_df, db,
            start=date(2026, 1, 1), end=date(2026, 1, 10),
        )

        for _, row in merged.iterrows():
            assert row['GP'] == 0
            assert row['PTS'] == 0.0
            assert bool(row['has_data']) is True

    @pytest.mark.asyncio
    async def test_known_player_preset_with_fully_empty_window_keeps_espn_value(
        self, sample_window_players_df
    ):
        """Regression: if the DB has zero rows for the ENTIRE window (e.g. the
        anchor-date resolution still lands somewhere with no games at all),
        a preset period must not zero out a matched player's stats — the
        empty window is a property of the window, not evidence this specific
        player had no games. Custom ranges still zero (test above), since
        they have no ESPN value to fall back to."""
        db = self._db_service(pd.DataFrame())

        original_pts = sample_window_players_df.set_index('Name')['PTS'].to_dict()
        merged, _, _ = await build_windowed_players_df(
            StatTimePeriod.LAST_30, sample_window_players_df, db
        )

        for name, pts in original_pts.items():
            row = merged[merged['Name'] == name].iloc[0]
            assert row['PTS'] == pts
            assert bool(row['has_data']) is True

    @pytest.mark.asyncio
    async def test_unknown_preset_falls_back_to_espn_value(self, sample_window_players_df):
        # ESPN free agents ('FA'), no fs_player_games rows -> preset periods keep the ESPN row untouched.
        sample_window_players_df['Pro Team'] = 'FA'
        db = self._db_service(pd.DataFrame())

        original_pts = sample_window_players_df.set_index('Name')['PTS'].to_dict()
        merged, _, _ = await build_windowed_players_df(
            StatTimePeriod.SEASON, sample_window_players_df, db
        )

        for name, pts in original_pts.items():
            row = merged[merged['Name'] == name].iloc[0]
            assert row['PTS'] == pts
            assert bool(row['has_data']) is True

    @pytest.mark.asyncio
    async def test_custom_range_zeroes_regardless_of_espn_roster_status(self, sample_window_players_df):
        """Custom ranges skip the roster gate entirely: even an ESPN free
        agent with no fs_player_games rows is treated as known and just
        zeroed, never dropped to has_data=False."""
        sample_window_players_df['Pro Team'] = 'FA'
        db = self._db_service(pd.DataFrame())

        merged, _, _ = await build_windowed_players_df(
            StatTimePeriod.CUSTOM, sample_window_players_df, db,
            start=date(2026, 1, 1), end=date(2026, 1, 10),
        )

        for _, row in merged.iterrows():
            assert bool(row['has_data']) is True
            assert row['PTS'] == 0.0
            assert row['GP'] == 0

    @pytest.mark.asyncio
    async def test_name_override_resolves_mismatch(self, sample_window_players_df):
        agg_df = pd.DataFrame([{
            'player_id': 9, 'player_name': 'X. Player', 'gp': 1,
            'pts': 25.0, 'reb': 5.0, 'ast': 4.0, 'stl': 1.0, 'blk': 1.0,
            'fgm': 9.0, 'fga': 18.0, 'ftm': 4.0, 'fta': 5.0,
            'three_pm': 3.0, 'min': 30.0,
            'fg_pct': 9.0 / 18.0, 'ft_pct': 4.0 / 5.0,
        }])
        db = self._db_service(agg_df)

        from app.utils import name_matching
        espn_key = name_matching.normalize_player_name('Player X')
        db_key = name_matching.normalize_player_name('X. Player')
        name_matching.NAME_OVERRIDES[espn_key] = db_key
        try:
            merged, _, _ = await build_windowed_players_df(
                StatTimePeriod.LAST_7, sample_window_players_df, db
            )
        finally:
            name_matching.NAME_OVERRIDES.pop(espn_key, None)

        row = merged[merged['Name'] == 'Player X'].iloc[0]
        assert row['GP'] == 1
        assert row['PTS'] == 25.0
        assert bool(row['has_data']) is True


class TestGetSeasonAnchorDate:
    """These tests exercise the real get_season_anchor_date, so they must not
    inherit the module-wide fixed_anchor_date autouse patch — shadow it here
    (same fixture name, so pytest resolves this class-scoped no-op instead)."""

    @pytest.fixture(autouse=True)
    def fixed_anchor_date(self):
        yield

    @pytest.mark.asyncio
    async def test_fetches_and_caches(self):
        db = MagicMock()
        db.get_latest_game_date = AsyncMock(return_value=date(2026, 4, 12))

        first = await player_service_module.get_season_anchor_date("2025-26", db)
        second = await player_service_module.get_season_anchor_date("2025-26", db)

        assert first == date(2026, 4, 12)
        assert second == date(2026, 4, 12)
        db.get_latest_game_date.assert_called_once()  # second call served from cache

    @pytest.mark.asyncio
    async def test_falls_back_to_real_today_when_no_data_yet(self):
        db = MagicMock()
        db.get_latest_game_date = AsyncMock(return_value=None)

        result = await player_service_module.get_season_anchor_date("2025-26", db)
        assert result == date.today()

    @pytest.mark.asyncio
    async def test_cache_expires_after_ttl(self):
        player_service_module._season_anchor_cache.update({
            'season': "2025-26", 'date': date(2026, 1, 1),
            'ts': player_service_module.datetime.now() - player_service_module._SEASON_ANCHOR_TTL * 2,
        })
        db = MagicMock()
        db.get_latest_game_date = AsyncMock(return_value=date(2026, 4, 12))

        result = await player_service_module.get_season_anchor_date("2025-26", db)
        assert result == date(2026, 4, 12)


@pytest.mark.real_dataprovider
class TestDynamicCategoriesPlayers:
    """Full pipeline: real DataProvider + DataTransformer + ResponseBuilder,
    only the ESPN HTTP call stubbed, proving a turnovers-scoring league
    surfaces TO on individual player rows via get_all_players()."""

    @staticmethod
    def _turnovers_league_standings_payload():
        return {
            "scoringPeriodId": 5,
            "teams": [{"id": 1, "name": "Alpha", "valuesByStat": {
                "0": 1000, "1": 20, "2": 50, "3": 200, "6": 400,
                "13": 400, "14": 850, "15": 150, "16": 200, "17": 100,
                "19": 47.1, "20": 75.0, "42": 82, "40": 2000, "11": 120,
            }}],
            "settings": {"scoringSettings": {"scoringItems": [
                {"statId": sid} for sid in (19, 20, 17, 3, 6, 2, 1, 0, 11)
            ]}},
        }

    @staticmethod
    def _players_payload():
        return {"players": [{
            "id": 501, "onTeamId": 1, "status": "ONTEAM",
            "player": {
                "id": 501, "fullName": "TO Guy", "proTeamId": 1, "injured": False,
                "eligibleSlots": [0],
                "stats": [{
                    "scoringPeriodId": 0, "statSplitTypeId": 0, "seasonId": 2026,
                    "stats": {
                        "0": 500, "1": 10, "2": 25, "3": 100, "6": 200,
                        "13": 200, "14": 425, "15": 75, "16": 100, "17": 50,
                        "19": 47.1, "20": 75.0, "42": 41, "40": 1000, "11": 60,
                    },
                }],
            },
        }]}

    @pytest_asyncio.fixture
    async def real_player_service(self, monkeypatch):
        from datetime import date as date_cls
        from unittest.mock import AsyncMock as AM
        from app.services.data_provider import DataProvider

        monkeypatch.setattr(
            player_service_module, "get_season_anchor_date", AM(return_value=date_cls(2026, 7, 10))
        )

        from app.services.cache_manager import CacheManager

        DataProvider._instance = None
        DataProvider._initialized = False
        # CacheManager is its own singleton, independent of DataProvider's —
        # resetting DataProvider alone leaves a stale players_0 cache entry
        # (5-minute TTL) that could otherwise leak in from any other test.
        CacheManager._instance = None
        service = PlayerService()
        service.data_provider = DataProvider()
        service.data_provider.db_service = MagicMock()
        service.data_provider.db_service.aggregate_player_games = AsyncMock(
            return_value=(pd.DataFrame(), None, None)
        )

        standings_resp = MagicMock()
        standings_resp.status_code = 200
        standings_resp.headers = {"ETag": "e1"}
        standings_resp.json.return_value = self._turnovers_league_standings_payload()
        standings_resp.raise_for_status = MagicMock()

        players_resp = MagicMock()
        players_resp.status_code = 200
        players_resp.headers = {}
        players_resp.json.return_value = self._players_payload()
        players_resp.raise_for_status = MagicMock()

        async def routed_get(url, **kwargs):
            return players_resp if 'kona_player_info' in url else standings_resp
        service.data_provider._client.get = AsyncMock(side_effect=routed_get)

        yield service
        DataProvider._instance = None
        DataProvider._initialized = False
        CacheManager._instance = None

    @pytest.mark.asyncio
    async def test_player_row_includes_turnovers_stat(self, real_player_service):
        result = await real_player_service.get_all_players(page=1, limit=10)

        player = next(p for p in result.players if p.player_name == "TO Guy")
        assert player.stats.stats is not None
        assert player.stats.stats['TO'] == 60.0
        assert player.stats.stats['PTS'] == player.stats.pts


class TestWindowedPlayersCache:
    """Step 1-2 of the response-cache refactor: the preset cache entry holds a
    fully built, unpaginated list[Player]; pagination slices that list instead
    of rebuilding Pydantic objects per request."""

    @pytest.fixture
    def many_players_df(self, sample_window_players_df):
        df = pd.concat([sample_window_players_df] * 4, ignore_index=True)
        df['Name'] = [f"Player {i}" for i in range(len(df))]
        return df

    @staticmethod
    def _build_side_effect(df, categories=None):
        return [_sample_player(str(name)) for name in df['Name']]

    @pytest.mark.asyncio
    async def test_players_built_once_and_reused_within_ttl(self, player_service, many_players_df):
        player_service.data_provider.get_players_df = AsyncMock(return_value=many_players_df)
        player_service.response_builder.build_all_players_response.side_effect = self._build_side_effect

        first = await player_service.get_all_players(page=1, limit=1200, time_period=StatTimePeriod.SEASON)
        second = await player_service.get_all_players(page=1, limit=1200, time_period=StatTimePeriod.SEASON)

        assert player_service.response_builder.build_all_players_response.call_count == 1
        assert len(first.players) == len(many_players_df)
        for a, b in zip(first.players, second.players):
            assert a is b

    @pytest.mark.asyncio
    async def test_cache_entry_holds_full_unpaginated_list(self, player_service, many_players_df):
        player_service.data_provider.get_players_df = AsyncMock(return_value=many_players_df)
        player_service.response_builder.build_all_players_response.side_effect = self._build_side_effect

        await player_service.get_all_players(page=1, limit=10, time_period=StatTimePeriod.SEASON)

        entry = player_service_module._windowed_players_cache[StatTimePeriod.SEASON]
        assert len(entry['players']) == len(many_players_df)

    @pytest.mark.asyncio
    async def test_pagination_slices_cached_list(self, player_service, many_players_df):
        player_service.data_provider.get_players_df = AsyncMock(return_value=many_players_df)
        player_service.response_builder.build_all_players_response.side_effect = self._build_side_effect

        full = await player_service.get_all_players(page=1, limit=1200, time_period=StatTimePeriod.SEASON)
        page2 = await player_service.get_all_players(page=2, limit=5, time_period=StatTimePeriod.SEASON)

        assert player_service.response_builder.build_all_players_response.call_count == 1
        assert [p.player_name for p in page2.players] == [p.player_name for p in full.players[5:10]]
        for cached, sliced in zip(full.players[5:10], page2.players):
            assert cached is sliced

    @pytest.mark.asyncio
    async def test_has_more_on_cached_list(self, player_service, many_players_df):
        player_service.data_provider.get_players_df = AsyncMock(return_value=many_players_df)
        player_service.response_builder.build_all_players_response.side_effect = self._build_side_effect
        total = len(many_players_df)

        await player_service.get_all_players(page=1, limit=1200, time_period=StatTimePeriod.SEASON)

        first = await player_service.get_all_players(page=1, limit=5, time_period=StatTimePeriod.SEASON)
        assert first.total_count == total
        assert len(first.players) == 5
        assert first.has_more is True

        last = await player_service.get_all_players(page=3, limit=5, time_period=StatTimePeriod.SEASON)
        assert len(last.players) == 2
        assert last.has_more is False

        past_end = await player_service.get_all_players(page=9, limit=5, time_period=StatTimePeriod.SEASON)
        assert past_end.players == []
        assert past_end.has_more is False
        assert past_end.total_count == total

    @pytest.mark.asyncio
    async def test_expired_entry_rebuilds_players(self, player_service, many_players_df):
        player_service.data_provider.get_players_df = AsyncMock(return_value=many_players_df)
        player_service.response_builder.build_all_players_response.side_effect = self._build_side_effect

        first = await player_service.get_all_players(page=1, limit=1200, time_period=StatTimePeriod.SEASON)
        entry = player_service_module._windowed_players_cache[StatTimePeriod.SEASON]
        entry['ts'] = entry['ts'] - player_service_module._WINDOWED_PLAYERS_TTL * 2

        second = await player_service.get_all_players(page=1, limit=1200, time_period=StatTimePeriod.SEASON)

        assert player_service.response_builder.build_all_players_response.call_count == 2
        assert first.players[0] is not second.players[0]

    @pytest.mark.asyncio
    async def test_custom_range_is_never_cached(self, player_service, many_players_df):
        player_service.data_provider.get_players_df = AsyncMock(return_value=many_players_df)
        player_service.response_builder.build_all_players_response.side_effect = self._build_side_effect

        await player_service.get_all_players(
            page=1, limit=1200, time_period=StatTimePeriod.CUSTOM,
            start=date(2026, 1, 1), end=date(2026, 1, 10),
        )
        await player_service.get_all_players(
            page=1, limit=1200, time_period=StatTimePeriod.CUSTOM,
            start=date(2026, 1, 1), end=date(2026, 1, 10),
        )

        assert StatTimePeriod.CUSTOM not in player_service_module._windowed_players_cache
        assert player_service_module.players_etag(StatTimePeriod.CUSTOM, 1, 1200) is None
        assert player_service.response_builder.build_all_players_response.call_count == 2

    @pytest.mark.asyncio
    async def test_separate_cache_entry_per_preset(self, player_service, many_players_df):
        player_service.data_provider.get_players_df = AsyncMock(return_value=many_players_df)
        player_service.response_builder.build_all_players_response.side_effect = self._build_side_effect

        season = await player_service.get_all_players(page=1, limit=1200, time_period=StatTimePeriod.SEASON)
        last7 = await player_service.get_all_players(page=1, limit=1200, time_period=StatTimePeriod.LAST_7)

        assert player_service.response_builder.build_all_players_response.call_count == 2
        assert season.players[0] is not last7.players[0]


class TestPlayersEtag:
    @pytest.mark.asyncio
    async def test_none_until_cache_is_warm(self, player_service, sample_window_players_df):
        assert player_service_module.players_etag(StatTimePeriod.SEASON, 1, 1200) is None

        player_service.data_provider.get_players_df = AsyncMock(return_value=sample_window_players_df)
        player_service.response_builder.build_all_players_response.return_value = []
        await player_service.get_all_players(page=1, limit=1200, time_period=StatTimePeriod.SEASON)

        etag = player_service_module.players_etag(StatTimePeriod.SEASON, 1, 1200)
        assert etag is not None
        assert etag.startswith('W/"')

    @pytest.mark.asyncio
    async def test_stable_across_calls_and_varies_by_key(self, player_service, sample_window_players_df):
        player_service.data_provider.get_players_df = AsyncMock(return_value=sample_window_players_df)
        player_service.response_builder.build_all_players_response.return_value = []
        await player_service.get_all_players(page=1, limit=1200, time_period=StatTimePeriod.SEASON)

        etag = player_service_module.players_etag(StatTimePeriod.SEASON, 1, 1200)
        assert player_service_module.players_etag(StatTimePeriod.SEASON, 1, 1200) == etag
        assert player_service_module.players_etag(StatTimePeriod.SEASON, 2, 1200) != etag
        assert player_service_module.players_etag(StatTimePeriod.SEASON, 1, 500) != etag

    @pytest.mark.asyncio
    async def test_none_after_ttl_expiry(self, player_service, sample_window_players_df):
        player_service.data_provider.get_players_df = AsyncMock(return_value=sample_window_players_df)
        player_service.response_builder.build_all_players_response.return_value = []
        await player_service.get_all_players(page=1, limit=1200, time_period=StatTimePeriod.SEASON)

        entry = player_service_module._windowed_players_cache[StatTimePeriod.SEASON]
        entry['ts'] = entry['ts'] - player_service_module._WINDOWED_PLAYERS_TTL * 2

        assert player_service_module.players_etag(StatTimePeriod.SEASON, 1, 1200) is None

    @pytest.mark.asyncio
    async def test_changes_when_cache_refills(self, player_service, sample_window_players_df):
        player_service.data_provider.get_players_df = AsyncMock(return_value=sample_window_players_df)
        player_service.response_builder.build_all_players_response.return_value = []
        await player_service.get_all_players(page=1, limit=1200, time_period=StatTimePeriod.SEASON)
        before = player_service_module.players_etag(StatTimePeriod.SEASON, 1, 1200)

        entry = player_service_module._windowed_players_cache[StatTimePeriod.SEASON]
        entry['ts'] = entry['ts'] - player_service_module._WINDOWED_PLAYERS_TTL * 2
        await player_service.get_all_players(page=1, limit=1200, time_period=StatTimePeriod.SEASON)

        assert player_service_module.players_etag(StatTimePeriod.SEASON, 1, 1200) != before
