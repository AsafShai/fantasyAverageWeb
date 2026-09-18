import pandas as pd
import pytest

from app.models.injury_models import InjuryRecord
from app.services import today_service as today_module
from app.services.today_service import TodayService


def rankings_row(period, team_id, name, **cats):
    base = {
        'scoring_period_id': period,
        'team_id': team_id,
        'team_name': name,
        'rk_fg_pct': 6.0, 'rk_ft_pct': 6.0, 'rk_three_pm': 6.0, 'rk_reb': 6.0,
        'rk_ast': 6.0, 'rk_stl': 6.0, 'rk_blk': 6.0, 'rk_pts': 6.0,
        'rk_total': 48.0, 'ranks': None,
    }
    base.update(cats)
    return base


def players_df(rows):
    return pd.DataFrame(rows)


def injury(player, status, team='LAL'):
    return InjuryRecord(
        game=f'{team}@BOS', team=team, player=player, status=status,
        injury='knee', last_update='2026-09-18T12:00:00',
    )


@pytest.fixture(autouse=True)
def clear_cache():
    today_module.clear_today_hub_cache()
    yield
    today_module.clear_today_hub_cache()


class TestMovers:
    def test_deltas_between_the_two_latest_periods(self):
        rows = [
            rankings_row(10, 1, 'Alpha', rk_ast=4.0, rk_total=46.0),
            rankings_row(11, 1, 'Alpha', rk_ast=7.0, rk_total=49.0),
        ]
        movers = TodayService.build_movers(rows)

        by_cat = {m.category: m.delta for m in movers}
        assert by_cat['AST'] == 3.0
        assert by_cat['TOTAL'] == 3.0
        assert all(m.team_name == 'Alpha' for m in movers)

    def test_unchanged_categories_are_not_movers(self):
        rows = [
            rankings_row(10, 1, 'Alpha', rk_ast=4.0, rk_total=46.0),
            rankings_row(11, 1, 'Alpha', rk_ast=7.0, rk_total=49.0),
        ]
        assert {m.category for m in TodayService.build_movers(rows)} == {'AST', 'TOTAL'}

    def test_a_drop_is_a_negative_delta(self):
        rows = [
            rankings_row(10, 1, 'Alpha', rk_pts=9.0, rk_total=51.0),
            rankings_row(11, 1, 'Alpha', rk_pts=5.5, rk_total=47.5),
        ]
        by_cat = {m.category: m.delta for m in TodayService.build_movers(rows)}
        assert by_cat['PTS'] == -3.5

    def test_top_eight_by_absolute_delta(self):
        previous = [rankings_row(10, tid, f'Team {tid}') for tid in range(1, 13)]
        latest = [
            rankings_row(11, tid, f'Team {tid}', rk_ast=6.0 + tid, rk_total=48.0 + tid)
            for tid in range(1, 13)
        ]
        movers = TodayService.build_movers(previous + latest)

        assert len(movers) == 8
        assert [abs(m.delta) for m in movers] == sorted((abs(m.delta) for m in movers), reverse=True)
        assert abs(movers[0].delta) == 12.0

    def test_single_period_yields_no_movers(self):
        assert TodayService.build_movers([rankings_row(11, 1, 'Alpha')]) == []

    def test_no_rows_yields_no_movers(self):
        assert TodayService.build_movers([]) == []

    def test_reads_a_category_that_only_exists_in_the_ranks_json(self):
        rows = [
            rankings_row(10, 1, 'Alpha', ranks={'TO': 3.0, 'TOTAL': 46.0}),
            rankings_row(11, 1, 'Alpha', ranks={'TO': 8.0, 'TOTAL': 46.0}),
        ]
        by_cat = {m.category: m.delta for m in TodayService.build_movers(rows)}
        assert by_cat == {'TO': 5.0}

    def test_a_team_missing_from_the_earlier_period_is_skipped(self):
        rows = [
            rankings_row(10, 1, 'Alpha'),
            rankings_row(11, 1, 'Alpha'),
            rankings_row(11, 2, 'Beta', rk_ast=12.0),
        ]
        assert TodayService.build_movers(rows) == []


class TestRosterHealth:
    def test_joins_injuries_and_tonights_slate_onto_rosters(self):
        df = players_df([
            {'team_id': 1, 'fantasy_team_name': 'Alpha', 'Name': 'LeBron James', 'Pro Team': 'LAL'},
            {'team_id': 1, 'fantasy_team_name': 'Alpha', 'Name': 'Anthony Davis', 'Pro Team': 'DAL'},
            {'team_id': 1, 'fantasy_team_name': 'Alpha', 'Name': 'Austin Reaves', 'Pro Team': 'LAL'},
            {'team_id': 2, 'fantasy_team_name': 'Beta', 'Name': 'Jayson Tatum', 'Pro Team': 'BOS'},
        ])
        injuries = {
            'lebronjames': 'out',
            'austinreaves': 'questionable',
            'jaysontatum': 'out',
        }

        health = TodayService.build_roster_health(df, {'LAL', 'BOS'}, injuries)
        by_name = {t.team_name: t for t in health}

        alpha = by_name['Alpha']
        assert alpha.roster_size == 3
        assert alpha.out == 1
        assert alpha.questionable == 1
        assert alpha.playing_tonight == 1
        assert alpha.out_tonight == 1

        beta = by_name['Beta']
        assert (beta.out, beta.playing_tonight, beta.out_tonight) == (1, 0, 1)

    def test_free_agents_are_not_a_fantasy_team(self):
        df = players_df([
            {'team_id': 0, 'fantasy_team_name': None, 'Name': 'Free Agent', 'Pro Team': 'LAL'},
            {'team_id': 1, 'fantasy_team_name': 'Alpha', 'Name': 'LeBron James', 'Pro Team': 'LAL'},
        ])
        health = TodayService.build_roster_health(df, {'LAL'}, {})
        assert [t.team_name for t in health] == ['Alpha']
        assert health[0].roster_size == 1

    def test_sorted_by_out_then_questionable(self):
        df = players_df([
            {'team_id': 1, 'fantasy_team_name': 'Alpha', 'Name': 'A One', 'Pro Team': 'LAL'},
            {'team_id': 2, 'fantasy_team_name': 'Beta', 'Name': 'B One', 'Pro Team': 'LAL'},
            {'team_id': 3, 'fantasy_team_name': 'Gamma', 'Name': 'C One', 'Pro Team': 'LAL'},
        ])
        injuries = {'bone': 'out', 'cone': 'questionable'}
        assert [t.team_name for t in TodayService.build_roster_health(df, set(), injuries)] == [
            'Beta', 'Gamma', 'Alpha',
        ]

    def test_empty_frame_is_no_rows(self):
        assert TodayService.build_roster_health(pd.DataFrame(), {'LAL'}, {}) == []

    def test_injury_lookup_keeps_only_out_and_questionable(self, monkeypatch):
        store = {
            'LAL|James, LeBron': injury('James, LeBron', 'Out'),
            'LAL|Reaves, Austin': injury('Reaves, Austin', 'Questionable'),
            'LAL|Knecht, Dalton': injury('Knecht, Dalton', 'Available'),
        }
        monkeypatch.setattr('app.services.injury_service.injury_store', store)

        lookup = TodayService._injury_lookup()
        assert lookup == {'jameslebron': 'out', 'reavesaustin': 'questionable'}


class TestFailOpen:
    @pytest.mark.asyncio
    async def test_a_dead_source_leaves_the_rest_of_the_hub_intact(self, monkeypatch):
        service = TodayService()

        async def boom():
            raise RuntimeError('injury feed down')

        async def movers():
            return [
                today_module.RankMover(team_id=1, team_name='Alpha', category='AST', delta=2.0)
            ]

        async def nightly():
            return None

        monkeypatch.setattr(service, '_get_tonight', boom)
        monkeypatch.setattr(service, '_get_movers', movers)
        monkeypatch.setattr(service, '_get_last_nightly', nightly)

        hub = await service.get_today_hub()

        assert len(hub.movers) == 1
        assert hub.roster_health == []
        assert hub.slate_date is None
        assert hub.games_count == 0

    @pytest.mark.asyncio
    async def test_every_source_failing_still_returns_a_hub(self, monkeypatch):
        service = TodayService()

        async def boom():
            raise RuntimeError('everything is down')

        monkeypatch.setattr(service, '_get_tonight', boom)
        monkeypatch.setattr(service, '_get_movers', boom)
        monkeypatch.setattr(service, '_get_last_nightly', boom)

        hub = await service.get_today_hub()
        assert hub.movers == []
        assert hub.roster_health == []
        assert hub.last_nightly is None

    @pytest.mark.asyncio
    async def test_the_composed_response_is_cached(self, monkeypatch):
        service = TodayService()
        calls = {'n': 0}

        async def movers():
            calls['n'] += 1
            return []

        async def tonight():
            return (None, 0, [])

        async def nightly():
            return None

        monkeypatch.setattr(service, '_get_movers', movers)
        monkeypatch.setattr(service, '_get_tonight', tonight)
        monkeypatch.setattr(service, '_get_last_nightly', nightly)

        await service.get_today_hub()
        await service.get_today_hub()
        assert calls['n'] == 1
