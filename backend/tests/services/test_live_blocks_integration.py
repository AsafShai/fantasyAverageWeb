"""Rankings, summary, heatmap and team detail through the real DataProvider and
live overlay (flag on), against the recorded schedule: the counting rule and the
``live`` block end to end. Route wiring is covered in tests/routes/test_live_blocks.py."""
import pytest

from app.config import settings

from app.services.league_service import LeagueService
from app.services.ranking_service import RankingService
from tests.services.test_live_data_provider import (  # noqa: F401 (fixtures)
    GAME_A, GAME_B, flag_off, flag_on, provider,
)

pytestmark = pytest.mark.real_dataprovider


def _team1(rows):
    return next(r for r in rows if r.team.team_id == 1)


@pytest.mark.asyncio
async def test_rankings_totals_count_games_in_progress_but_averages_do_not(provider, flag_on, monkeypatch):
    provider.scoreboard.return_value = {"games": [{"game_id": GAME_A, "status": "final"}]}
    monkeypatch.setattr(settings, "live_standings_enabled", False)
    before = await RankingService().get_league_rankings()
    monkeypatch.setattr(settings, "live_standings_enabled", True)

    after = await RankingService().get_league_rankings()
    assert before.live is None
    assert after.live.active is True
    assert (after.live.games_total, after.live.games_live, after.live.games_final) == (4, 3, 1)

    # Totals include both games (10 + 20 pts); averages only the final one (10 pts, GP +1).
    assert _team1(after.totals_rankings).pts - _team1(before.totals_rankings).pts == 30
    assert _team1(after.averages_rankings).gp - _team1(before.averages_rankings).gp == 1


@pytest.mark.asyncio
async def test_flag_off_rankings_and_heatmap_serialise_without_live(provider, flag_off):
    rankings = (await RankingService().get_league_rankings()).model_dump(mode="json")
    heatmap = (await LeagueService().get_heatmap_data()).model_dump(mode="json")
    assert "live" not in rankings and "live" not in heatmap


@pytest.mark.asyncio
async def test_flag_on_heatmap_and_summary_carry_the_block(provider, flag_on):
    heatmap = await LeagueService().get_heatmap_data()
    assert heatmap.live is not None and heatmap.live.period == 24
    summary_gp = (await LeagueService().get_league_summary()).total_games_played
    # No game final yet: averages (and so the summary's GP) are the official ones.
    official_gp = int((await provider.get_averages_df())["GP"].sum())
    assert summary_gp == official_gp


@pytest.mark.asyncio
async def test_repeated_live_requests_reuse_the_memoised_response(provider, flag_on):
    service = RankingService()
    await service.get_league_rankings()
    frames = await provider.get_all_dataframes(live=True)
    await service.get_league_rankings()
    again = await provider.get_all_dataframes(live=True)
    assert frames[0] is not None and again[0].equals(frames[0])
    assert provider.espn.calls["schedule"] == 1   # schedule fetched once, not per request
