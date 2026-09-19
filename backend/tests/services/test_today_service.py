import logging

import pandas as pd
import pytest

from app.models.injury_models import InjuryRecord
from app.services import today_service as today_module
from app.services.today_service import TodayService, classify_status


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

    def test_sorted_by_absolute_delta_descending_with_no_count_limit(self):
        previous = [rankings_row(10, tid, f'Team {tid}') for tid in range(1, 13)]
        latest = [
            rankings_row(11, tid, f'Team {tid}', rk_ast=6.0 + tid, rk_total=48.0 + tid)
            for tid in range(1, 13)
        ]
        movers = TodayService.build_movers(previous + latest)

        assert len(movers) == 24
        assert [abs(m.delta) for m in movers] == sorted((abs(m.delta) for m in movers), reverse=True)
        assert abs(movers[0].delta) == 12.0

    def test_zero_delta_movers_are_excluded_regardless_of_row_count(self):
        previous = [rankings_row(10, tid, f'Team {tid}') for tid in range(1, 21)]
        latest = [
            rankings_row(11, tid, f'Team {tid}', rk_ast=6.0 + (1.0 if tid % 2 == 0 else 0.0),
                         rk_total=48.0 + (1.0 if tid % 2 == 0 else 0.0))
            for tid in range(1, 21)
        ]
        movers = TodayService.build_movers(previous + latest)

        assert all(m.delta != 0 for m in movers)
        assert len(movers) == 20
        assert {int(m.delta) for m in movers} == {1}

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


class TestClassifyStatus:
    @pytest.mark.parametrize('raw, expected', [
        ('Out', 'out'),
        ('OUT', 'out'),
        ('  Doubtful ', 'doubtful'),
        ('Questionable', 'questionable'),
        ('Probable', 'probable'),
        ('Available', 'available'),
    ])
    def test_each_report_status_keeps_its_own_identity(self, raw, expected):
        assert classify_status(raw) == expected

    def test_game_time_decision_is_the_reports_wording_for_questionable(self):
        assert classify_status('Game Time Decision') == 'questionable'

    def test_an_unknown_status_is_questionable_and_logged_by_name(self, caplog):
        with caplog.at_level(logging.WARNING):
            assert classify_status('Reconditioning') == 'questionable'
        assert 'Reconditioning' in caplog.text


class TestRosterHealth:
    def test_five_counts_over_players_with_a_game_tonight(self):
        df = players_df([
            {'team_id': 1, 'fantasy_team_name': 'Alpha', 'Name': 'LeBron James', 'Pro Team': 'LAL'},
            {'team_id': 1, 'fantasy_team_name': 'Alpha', 'Name': 'Austin Reaves', 'Pro Team': 'LAL'},
            {'team_id': 1, 'fantasy_team_name': 'Alpha', 'Name': 'Rui Hachimura', 'Pro Team': 'LAL'},
            {'team_id': 1, 'fantasy_team_name': 'Alpha', 'Name': 'Dalton Knecht', 'Pro Team': 'LAL'},
            {'team_id': 1, 'fantasy_team_name': 'Alpha', 'Name': 'Jaxson Hayes', 'Pro Team': 'LAL'},
            {'team_id': 2, 'fantasy_team_name': 'Beta', 'Name': 'Jayson Tatum', 'Pro Team': 'BOS'},
        ])
        injuries = {
            'lebronjames': 'out',
            'austinreaves': 'questionable',
            'ruihachimura': 'doubtful',
            'daltonknecht': 'probable',
        }

        health = TodayService.build_roster_health(df, {'LAL', 'BOS'}, injuries)
        alpha = {t.team_name: t for t in health}['Alpha']

        assert (alpha.out, alpha.doubtful, alpha.questionable, alpha.probable, alpha.available_tonight) == (
            1, 1, 1, 1, 1,
        )

    def test_the_five_counts_sum_to_the_players_on_tonights_slate(self):
        df = players_df([
            {'team_id': 1, 'fantasy_team_name': 'Alpha', 'Name': f'Player {i}', 'Pro Team': 'LAL'}
            for i in range(7)
        ])
        injuries = {'player0': 'out', 'player1': 'doubtful', 'player2': 'probable'}

        team = TodayService.build_roster_health(df, {'LAL'}, injuries)[0]
        total = (team.available_tonight + team.probable + team.questionable
                 + team.doubtful + team.out)
        assert total == 7

    def test_a_player_with_no_game_tonight_is_in_no_column(self):
        df = players_df([
            {'team_id': 1, 'fantasy_team_name': 'Alpha', 'Name': 'LeBron James', 'Pro Team': 'LAL'},
            {'team_id': 1, 'fantasy_team_name': 'Alpha', 'Name': 'Anthony Davis', 'Pro Team': 'DAL'},
            {'team_id': 1, 'fantasy_team_name': 'Alpha', 'Name': 'Kyrie Irving', 'Pro Team': 'DAL'},
        ])
        injuries = {'anthonydavis': 'out', 'kyrieirving': 'questionable'}

        team = TodayService.build_roster_health(df, {'LAL'}, injuries)[0]
        assert (team.available_tonight, team.out, team.questionable) == (1, 0, 0)

    def test_a_team_with_nobody_playing_tonight_still_gets_a_row_of_zeros(self):
        df = players_df([
            {'team_id': 1, 'fantasy_team_name': 'Alpha', 'Name': 'LeBron James', 'Pro Team': 'LAL'},
            {'team_id': 2, 'fantasy_team_name': 'Beta', 'Name': 'Kyrie Irving', 'Pro Team': 'DAL'},
        ])
        health = {t.team_name: t for t in TodayService.build_roster_health(df, {'LAL'}, {})}

        assert set(health) == {'Alpha', 'Beta'}
        beta = health['Beta']
        assert beta.games_tonight == 0
        assert (beta.available_tonight, beta.probable, beta.questionable, beta.doubtful, beta.out) == (
            0, 0, 0, 0, 0,
        )

    def test_every_fantasy_team_gets_exactly_one_row(self):
        df = players_df([
            {'team_id': 1, 'fantasy_team_name': 'Alpha', 'Name': 'LeBron James', 'Pro Team': 'LAL'},
            {'team_id': 1, 'fantasy_team_name': 'Alpha', 'Name': 'Austin Reaves', 'Pro Team': 'LAL'},
            {'team_id': 2, 'fantasy_team_name': 'Beta', 'Name': 'Someone Idle', 'Pro Team': 'DAL'},
        ])
        health = TodayService.build_roster_health(df, {'LAL'}, {})
        assert len(health) == 2
        assert sorted(t.team_name for t in health) == ['Alpha', 'Beta']

    def test_an_unknown_status_lands_in_questionable(self):
        df = players_df([
            {'team_id': 1, 'fantasy_team_name': 'Alpha', 'Name': 'LeBron James', 'Pro Team': 'LAL'},
        ])
        team = TodayService.build_roster_health(df, {'LAL'}, {'lebronjames': 'questionable'})[0]
        assert (team.questionable, team.available_tonight) == (1, 0)

    def test_free_agents_are_not_a_fantasy_team(self):
        df = players_df([
            {'team_id': 0, 'fantasy_team_name': None, 'Name': 'Free Agent', 'Pro Team': 'LAL'},
            {'team_id': 1, 'fantasy_team_name': 'Alpha', 'Name': 'LeBron James', 'Pro Team': 'LAL'},
        ])
        health = TodayService.build_roster_health(df, {'LAL'}, {})
        assert [t.team_name for t in health] == ['Alpha']
        assert health[0].available_tonight == 1

    def test_sorted_by_out_then_doubtful_then_questionable_then_name(self):
        df = players_df([
            {'team_id': 1, 'fantasy_team_name': 'Alpha', 'Name': 'A One', 'Pro Team': 'LAL'},
            {'team_id': 2, 'fantasy_team_name': 'Beta', 'Name': 'B One', 'Pro Team': 'LAL'},
            {'team_id': 3, 'fantasy_team_name': 'Gamma', 'Name': 'C One', 'Pro Team': 'LAL'},
            {'team_id': 4, 'fantasy_team_name': 'Delta', 'Name': 'D One', 'Pro Team': 'LAL'},
        ])
        injuries = {'bone': 'out', 'cone': 'doubtful', 'done': 'questionable'}
        assert [t.team_name for t in TodayService.build_roster_health(df, {'LAL'}, injuries)] == [
            'Beta', 'Gamma', 'Delta', 'Alpha',
        ]

    def test_games_tonight_equals_the_sum_of_the_five_counts(self):
        df = players_df([
            {'team_id': 1, 'fantasy_team_name': 'Alpha', 'Name': 'LeBron James', 'Pro Team': 'LAL'},
            {'team_id': 1, 'fantasy_team_name': 'Alpha', 'Name': 'Austin Reaves', 'Pro Team': 'LAL'},
            {'team_id': 1, 'fantasy_team_name': 'Alpha', 'Name': 'Rui Hachimura', 'Pro Team': 'LAL'},
            {'team_id': 1, 'fantasy_team_name': 'Alpha', 'Name': 'Dalton Knecht', 'Pro Team': 'LAL'},
            {'team_id': 1, 'fantasy_team_name': 'Alpha', 'Name': 'Jaxson Hayes', 'Pro Team': 'LAL'},
        ])
        injuries = {
            'lebronjames': 'out',
            'austinreaves': 'questionable',
            'ruihachimura': 'doubtful',
            'daltonknecht': 'probable',
        }

        team = TodayService.build_roster_health(df, {'LAL'}, injuries)[0]
        assert team.games_tonight == (
            team.available_tonight + team.probable + team.questionable + team.doubtful + team.out
        )
        assert team.games_tonight == 5

    def test_empty_frame_is_no_rows(self):
        assert TodayService.build_roster_health(pd.DataFrame(), {'LAL'}, {}) == []

    def test_injury_lookup_maps_every_record_to_one_of_the_five(self, monkeypatch):
        store = {
            'LAL|James, LeBron': injury('James, LeBron', 'Out'),
            'LAL|Reaves, Austin': injury('Reaves, Austin', 'Game Time Decision'),
            'LAL|Hachimura, Rui': injury('Hachimura, Rui', 'Doubtful'),
            'LAL|Knecht, Dalton': injury('Knecht, Dalton', 'Available'),
        }
        monkeypatch.setattr('app.services.injury_service.injury_store', store)

        assert TodayService._injury_lookup() == {
            'jameslebron': 'out',
            'reavesaustin': 'questionable',
            'hachimurarui': 'doubtful',
            'knechtdalton': 'available',
        }


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
