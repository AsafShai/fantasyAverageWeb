from datetime import date

import pandas as pd
import pytest
from unittest.mock import AsyncMock, MagicMock

from app.exceptions import ResourceNotFoundError
import app.services.player_service as player_service_module
from app.services.player_service import (
    PlayerService,
    build_windowed_players_df,
    espn_season_string,
    _join_key,
    _fetch_season_roster_keys as _real_fetch_season_roster_keys,
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
def no_roster_keys(monkeypatch):
    """Default: nobody resolves to a current-season NBA player (no nba_api call
    made). Individual tests override via mock_roster_keys()."""
    monkeypatch.setattr(
        player_service_module, "get_season_roster_keys", AsyncMock(return_value=set())
    )


@pytest.fixture(autouse=True)
def fixed_anchor_date(monkeypatch):
    """Default: fixed anchor so tests aren't sensitive to real calendar today
    (and don't need a working db_service.get_latest_game_date mock). Override
    via monkeypatch in specific tests that care about the resolved window."""
    monkeypatch.setattr(
        player_service_module, "get_season_anchor_date", AsyncMock(return_value=date(2026, 7, 10))
    )


def mock_roster_keys(monkeypatch, names: list[str]) -> None:
    keys = {_join_key(n) for n in names}
    monkeypatch.setattr(
        player_service_module, "get_season_roster_keys", AsyncMock(return_value=keys)
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

    @pytest.mark.asyncio
    async def test_has_more_second_page(self, player_service, sample_window_players_df):
        player_service.data_provider.get_players_df = AsyncMock(return_value=sample_window_players_df)
        player_service.response_builder.build_all_players_response.side_effect = (
            lambda df: [_sample_player(f"P{i}") for i in range(len(df))]
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
    (including season-long-injury), unknown-preset-fallback, unknown-custom-no-data."""

    def _db_service(self, agg_df=None):
        db = MagicMock()
        db.aggregate_player_games = AsyncMock(
            return_value=(agg_df if agg_df is not None else pd.DataFrame(), date(2026, 1, 2), date(2026, 1, 9))
        )
        return db

    @pytest.mark.asyncio
    async def test_known_player_uses_db_totals(self, sample_window_players_df, monkeypatch):
        mock_roster_keys(monkeypatch, ["Player X"])
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
    async def test_known_player_zero_games_in_window_is_zeroed_not_no_data(
        self, sample_window_players_df, monkeypatch
    ):
        # Player Y is on the current-season roster but has no rows in this window.
        mock_roster_keys(monkeypatch, ["Player X", "Player Y"])
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
        assert row['GP'] == 0
        assert row['PTS'] == 0.0
        assert bool(row['has_data']) is True

    @pytest.mark.asyncio
    async def test_known_player_out_all_season_is_zero_row_not_no_data(
        self, sample_window_players_df, monkeypatch
    ):
        """Regression: a real, identifiable player out all season (e.g. a
        season-ending injury) must NOT collapse into 'no data' just because
        fs_player_games has zero rows for them all year — they're still on the
        nba_api roster, so they're 'known' regardless of the aggregation window."""
        mock_roster_keys(monkeypatch, ["Player X", "Player Y", "Player Z"])
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
        self, sample_window_players_df, monkeypatch
    ):
        """Regression: if the DB has zero rows for the ENTIRE window (e.g. the
        anchor-date resolution still lands somewhere with no games at all),
        a preset period must not zero out a matched player's stats — the
        empty window is a property of the window, not evidence this specific
        player had no games. Custom ranges still zero (test above), since
        they have no ESPN value to fall back to."""
        mock_roster_keys(monkeypatch, ["Player X", "Player Y", "Player Z"])
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
        # No roster keys, no fs_player_games rows -> preset periods keep the ESPN row untouched.
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
    async def test_unknown_custom_has_no_data(self, sample_window_players_df):
        db = self._db_service(pd.DataFrame())

        merged, _, _ = await build_windowed_players_df(
            StatTimePeriod.CUSTOM, sample_window_players_df, db,
            start=date(2026, 1, 1), end=date(2026, 1, 10),
        )

        for _, row in merged.iterrows():
            assert bool(row['has_data']) is False
            assert row['PTS'] == 0.0
            assert row['GP'] == 0

    @pytest.mark.asyncio
    async def test_unmatched_by_roster_but_has_window_rows_is_still_known(
        self, sample_window_players_df, monkeypatch
    ):
        """Defensive fallback: a player missing from the nba_api roster snapshot
        (lag / mid-season signing) but present in fs_player_games for the window
        must still be treated as known, not zeroed as no-data."""
        mock_roster_keys(monkeypatch, [])  # roster snapshot missed everyone
        agg_df = pd.DataFrame([{
            'player_id': 1, 'player_name': 'Player X', 'gp': 3,
            'pts': 60.0, 'reb': 15.0, 'ast': 9.0, 'stl': 3.0, 'blk': 1.0,
            'fgm': 21.0, 'fga': 45.0, 'ftm': 12.0, 'fta': 14.0,
            'three_pm': 6.0, 'min': 90.0,
            'fg_pct': 21.0 / 45.0, 'ft_pct': 12.0 / 14.0,
        }])
        db = self._db_service(agg_df)

        merged, _, _ = await build_windowed_players_df(
            StatTimePeriod.CUSTOM, sample_window_players_df, db,
            start=date(2026, 1, 1), end=date(2026, 1, 10),
        )

        row = merged[merged['Name'] == 'Player X'].iloc[0]
        assert row['GP'] == 3
        assert bool(row['has_data']) is True

    @pytest.mark.asyncio
    async def test_name_override_resolves_mismatch(self, sample_window_players_df, monkeypatch):
        mock_roster_keys(monkeypatch, ["X. Player"])
        agg_df = pd.DataFrame([{
            'player_id': 9, 'player_name': 'X. Player', 'gp': 1,
            'pts': 25.0, 'reb': 5.0, 'ast': 4.0, 'stl': 1.0, 'blk': 1.0,
            'fgm': 9.0, 'fga': 18.0, 'ftm': 4.0, 'fta': 5.0,
            'three_pm': 3.0, 'min': 30.0,
            'fg_pct': 9.0 / 18.0, 'ft_pct': 4.0 / 5.0,
        }])
        db = self._db_service(agg_df)

        from app.utils.name_matching import normalize_player_name
        espn_key = normalize_player_name('Player X')
        db_key = normalize_player_name('X. Player')
        player_service_module.NAME_OVERRIDES[espn_key] = db_key
        try:
            merged, _, _ = await build_windowed_players_df(
                StatTimePeriod.LAST_7, sample_window_players_df, db
            )
        finally:
            player_service_module.NAME_OVERRIDES.pop(espn_key, None)

        row = merged[merged['Name'] == 'Player X'].iloc[0]
        assert row['GP'] == 1
        assert row['PTS'] == 25.0
        assert bool(row['has_data']) is True


class TestGetSeasonRosterKeys:
    """These tests exercise the real get_season_roster_keys, so they must not
    inherit the module-wide 'no_roster_keys' autouse patch — shadow it here."""

    @pytest.fixture(autouse=True)
    def no_roster_keys(self):
        yield

    @pytest.mark.asyncio
    async def test_fetches_and_caches(self, monkeypatch):
        player_service_module._season_roster_cache.update({'season': None, 'keys': None, 'ts': None})
        calls = []

        def fake_fetch(season):
            calls.append(season)
            return {'playerx'}

        monkeypatch.setattr(player_service_module, "_fetch_season_roster_keys", fake_fetch)

        first = await player_service_module.get_season_roster_keys("2025-26")
        second = await player_service_module.get_season_roster_keys("2025-26")

        assert first == {'playerx'}
        assert second == {'playerx'}
        assert calls == ["2025-26"]  # second call served from cache, no re-fetch

    @pytest.mark.asyncio
    async def test_fetch_failure_falls_back_to_stale_cache(self, monkeypatch):
        player_service_module._season_roster_cache.update(
            {'season': "2025-26", 'keys': {'stale'}, 'ts': player_service_module.datetime.now()}
        )
        # Force the cache to look expired so a re-fetch is attempted.
        player_service_module._season_roster_cache['ts'] = (
            player_service_module.datetime.now() - player_service_module._SEASON_ROSTER_TTL * 2
        )

        def failing_fetch(season):
            raise RuntimeError("nba_api down")

        monkeypatch.setattr(player_service_module, "_fetch_season_roster_keys", failing_fetch)

        result = await player_service_module.get_season_roster_keys("2025-26")
        assert result == {'stale'}

    @pytest.mark.asyncio
    async def test_fetch_failure_no_cache_returns_empty_set(self, monkeypatch):
        player_service_module._season_roster_cache.update({'season': None, 'keys': None, 'ts': None})

        def failing_fetch(season):
            raise RuntimeError("nba_api down")

        monkeypatch.setattr(player_service_module, "_fetch_season_roster_keys", failing_fetch)

        result = await player_service_module.get_season_roster_keys("2025-26")
        assert result == set()


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


class TestFetchSeasonRosterKeys:
    """Regression coverage for the is_only_current_season=1 bug: that flag
    silently means 'has played a game this season', which is exactly the
    games-played bug this feature is supposed to eliminate (just moved from
    fs_player_games to nba_api). The real filter must be ROSTERSTATUS==1,
    a real TEAM_ID, and TO_YEAR matching the season's end year — independent
    of whether the player has actually played."""

    def _raw_players_df(self):
        return pd.DataFrame([
            # rostered, season-long injury (no games played this season) -> must be kept
            {'DISPLAY_FIRST_LAST': 'Season Long Injury', 'ROSTERSTATUS': 1,
             'TEAM_ID': 1610612754, 'TO_YEAR': '2026', 'GAMES_PLAYED_FLAG': 'Y'},
            # rostered, active -> kept
            {'DISPLAY_FIRST_LAST': 'Healthy Starter', 'ROSTERSTATUS': 1,
             'TEAM_ID': 1610612745, 'TO_YEAR': '2026', 'GAMES_PLAYED_FLAG': 'Y'},
            # no longer rostered this season (retired/released) -> dropped
            {'DISPLAY_FIRST_LAST': 'Retired Veteran', 'ROSTERSTATUS': 0,
             'TEAM_ID': 0, 'TO_YEAR': '2023', 'GAMES_PLAYED_FLAG': 'Y'},
            # rostered flag set but no current team (free agent in the historical frame) -> dropped
            {'DISPLAY_FIRST_LAST': 'Unsigned Free Agent', 'ROSTERSTATUS': 0,
             'TEAM_ID': 0, 'TO_YEAR': '2025', 'GAMES_PLAYED_FLAG': 'N'},
        ])

    def test_filters_by_roster_status_team_and_to_year(self, monkeypatch):
        monkeypatch.setattr(player_service_module.settings, "season_id", 2026)
        raw_df = self._raw_players_df()

        class FakeEndpoint:
            def __init__(self, is_only_current_season, season, timeout):
                assert is_only_current_season == 0  # not the games-played-only variant
                self.season = season

            def get_data_frames(self):
                return [raw_df]

        monkeypatch.setattr(
            player_service_module.commonallplayers, "CommonAllPlayers", FakeEndpoint
        )

        keys = _real_fetch_season_roster_keys("2025-26")

        assert player_service_module._join_key('Season Long Injury') in keys
        assert player_service_module._join_key('Healthy Starter') in keys
        assert player_service_module._join_key('Retired Veteran') not in keys
        assert player_service_module._join_key('Unsigned Free Agent') not in keys
