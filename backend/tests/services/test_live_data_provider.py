"""DataProvider with the live overlay: the flag, the shadow run, the morning
hand-over and the two-layer rule (live numbers never reach the DB)."""
import copy
import json
from datetime import timedelta
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pandas as pd
import pytest

import app.services.data_provider as data_provider_module
from app.config import settings
from app.services import live_overlay_service
from app.services.data_provider import DataProvider
from app.services.data_transformer import DataTransformer
from tests.services.test_live_overlay import (
    GAME_A, GAME_B, LINE_10PTS, LINE_20PTS, UPDATED_AFTER_23, _entry, _line, _payload,
)

pytestmark = pytest.mark.real_dataprovider

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"
SCHEDULE = json.loads((FIXTURES / "pro_team_schedules_2027_periods_22_25.json").read_text())
TIP_24 = 1794528000000          # first tip of period 24, 2026-11-13T00:00Z
HOUR_MS = 60 * 60 * 1000


def _tonight(period=24, standings_updated=UPDATED_AFTER_23, values=None):
    """Team 1 has a PG in game A (10 pts) and a SG in game B (20 pts)."""
    return _payload(
        period=period, standings_updated=standings_updated, values=values,
        entries_by_team={1: [
            _entry(11, 0, _line(GAME_A, period, LINE_10PTS)),
            _entry(12, 1, _line(GAME_B, period, LINE_20PTS)),
        ]},
    )


def _resp(payload, status=200, etag="e1"):
    resp = MagicMock()
    resp.status_code = status
    resp.headers = {"ETag": etag}
    resp.json.return_value = payload
    return resp


class FakeEspn:
    """Answers the standings URL with the current payload and the schedule
    URL with the pro-team schedule fixture; counts requests per kind."""

    def __init__(self, provider, payload):
        self.provider = provider
        self.payload = payload
        self.calls = {"standings": 0, "schedule": 0}
        self.etag = 0

    async def get(self, url, headers=None):
        if url == self.provider.espn_pro_team_schedules_url:
            self.calls["schedule"] += 1
            return _resp(SCHEDULE)
        self.calls["standings"] += 1
        self.etag += 1
        return _resp(copy.deepcopy(self.payload), etag=f"e{self.etag}")


@pytest.fixture
def provider(monkeypatch):
    DataProvider._instance = None
    DataProvider._initialized = False
    p = DataProvider()
    p.cache_manager.invalidate_cache()
    p.db_service = AsyncMock()
    p.db_service.get_db_max_scoring_period = AsyncMock(return_value=10_000)
    p.data_transformer = DataTransformer()
    # Every request revalidates, as if 30 s had passed.
    monkeypatch.setattr(data_provider_module, "TOTALS_TTL_SECONDS", 0)
    spawned = []

    def fake_spawn(coro, *, name):
        spawned.append(name)
        coro.close()

    monkeypatch.setattr(data_provider_module.background_tasks, "spawn", fake_spawn)
    p.espn = FakeEspn(p, _tonight())
    p._client = MagicMock()
    p._client.get = AsyncMock(side_effect=p.espn.get)
    p.scoreboard = AsyncMock(return_value={"games": []})
    monkeypatch.setattr(data_provider_module.box_score_service, "scoreboard_for", p.scoreboard)
    monkeypatch.setattr(live_overlay_service, "_now_ms", lambda: TIP_24 + 3 * HOUR_MS)
    yield p
    p.cache_manager.invalidate_cache()
    DataProvider._instance = None
    DataProvider._initialized = False


@pytest.fixture
def flag_on(monkeypatch):
    monkeypatch.setattr(settings, "live_standings_enabled", True)


@pytest.fixture
def flag_off(monkeypatch):
    monkeypatch.setattr(settings, "live_standings_enabled", False)


def _pts(df, team_id=1):
    return int(df.set_index("team_id").loc[team_id, "PTS"])


# --- flag off: everything exactly as today ----------------------------------

@pytest.mark.asyncio
async def test_flag_off_live_calls_return_the_official_objects(provider, flag_off):
    official = await provider.get_totals_df()
    assert await provider.get_totals_df(live=True) is official
    pd.testing.assert_frame_equal(await provider.get_averages_df(live=True), await provider.get_averages_df())
    pd.testing.assert_frame_equal(await provider.get_rankings_df(live=True), await provider.get_rankings_df())
    for live_df, official_df in zip(await provider.get_all_dataframes(live=True), await provider.get_all_dataframes()):
        pd.testing.assert_frame_equal(live_df, official_df)
    assert await provider.get_slot_usage(live=True) == await provider.get_slot_usage()


@pytest.mark.asyncio
async def test_flag_off_makes_no_scoreboard_or_schedule_request(provider, flag_off):
    await provider.get_all_dataframes(live=True)
    await provider.get_averages_df(live=True)
    provider.scoreboard.assert_not_awaited()
    assert provider.espn.calls["schedule"] == 0


@pytest.mark.asyncio
async def test_flag_off_has_no_live_block(provider, flag_off):
    assert await provider.get_live_state() is None


@pytest.mark.asyncio
async def test_flag_off_memo_response_is_the_official_response(provider, flag_off):
    built = []

    class Resp:
        def __init__(self, n):
            self.n = n

        def model_copy(self, update):
            return self

    async def build():
        built.append(1)
        return Resp(len(built))

    official = await provider.memo_response("rankings", (), build)
    live = await provider.memo_response("rankings", (), build, live=True)
    assert official.n == 1 and live.n == 2  # separate slots ...
    again = await provider.memo_response("rankings", (), build, live=True)
    assert again is live and len(built) == 2  # ... and neither is rebuilt


# --- flag on ------------------------------------------------------------------

@pytest.mark.asyncio
async def test_live_totals_add_games_in_progress(provider, flag_on):
    official = await provider.get_totals_df()
    live = await provider.get_totals_df(live=True)
    assert _pts(official) == 1000
    assert _pts(live) == 1030
    assert provider.cache_manager.totals_cache["data"] is official
    assert _pts(provider.cache_manager.totals_cache["data"]) == 1000


@pytest.mark.asyncio
async def test_live_averages_count_finished_games_only(provider, flag_on):
    provider.scoreboard.return_value = {"games": [
        {"game_id": GAME_A, "status": "final"}, {"game_id": GAME_B, "status": "live"},
    ]}
    averages = await provider.get_averages_df(live=True)
    team = averages.set_index("team_id").loc[1]
    # Game A only: 1010 points over 91 games.
    assert team["PTS"] == pytest.approx(1010 / 91)
    _, averages_all, _ = await provider.get_all_dataframes(live=True)
    assert averages_all.set_index("team_id").loc[1, "PTS"] == pytest.approx(1010 / 91)


@pytest.mark.asyncio
async def test_scoreboard_is_not_asked_before_1h45_after_tip(provider, flag_on, monkeypatch):
    monkeypatch.setattr(live_overlay_service, "_now_ms", lambda: TIP_24 + 60 * 60 * 1000)
    averages = await provider.get_averages_df(live=True)
    provider.scoreboard.assert_not_awaited()
    assert averages.set_index("team_id").loc[1, "PTS"] == pytest.approx(1000 / 90)


@pytest.mark.asyncio
async def test_scoreboard_is_not_asked_again_after_the_last_final(provider, flag_on):
    provider.scoreboard.return_value = {"games": [
        {"game_id": GAME_A, "status": "final"}, {"game_id": GAME_B, "status": "final"},
    ]}
    await provider.get_averages_df(live=True)
    calls = provider.scoreboard.await_count
    # Period 24 has two more games (not on these rosters); finish them too.
    provider.scoreboard.return_value = {"games": [
        {"game_id": g, "status": "final"} for g in ("401909976", "401909977", "401909978", "401909979")
    ]}
    await provider.get_averages_df(live=True)
    calls = provider.scoreboard.await_count
    await provider.get_averages_df(live=True)
    await provider.get_averages_df(live=True)
    assert provider.scoreboard.await_count == calls


@pytest.mark.asyncio
async def test_scoreboard_failure_counts_nothing_new_as_final(provider, flag_on):
    provider.scoreboard.side_effect = RuntimeError("down")
    averages = await provider.get_averages_df(live=True)
    assert averages.set_index("team_id").loc[1, "PTS"] == pytest.approx(1000 / 90)


@pytest.mark.asyncio
async def test_empty_overlay_returns_the_official_object(provider, flag_on, monkeypatch):
    provider.espn.payload = _payload(standings_updated=UPDATED_AFTER_23)
    official = await provider.get_totals_df()
    assert await provider.get_totals_df(live=True) is official
    # Before tip-off nothing is live.
    monkeypatch.setattr(live_overlay_service, "_now_ms", lambda: TIP_24 - HOUR_MS)
    state = await provider.get_live_state()
    assert state.active is False and state.games_total == 4


@pytest.mark.asyncio
async def test_db_fallback_disables_live(provider, flag_on):
    provider._client.get = AsyncMock(side_effect=RuntimeError("espn down"))
    provider.db_service.get_latest_snapshot = AsyncMock(return_value=("2026-11-12", [
        {"team_id": 1, "team_name": "Team 1", "PTS": 1000, "GP": 90},
    ]))
    official = await provider.get_totals_df()
    assert await provider.get_totals_df(live=True) is official


@pytest.mark.asyncio
async def test_overlay_failure_serves_official(provider, flag_on, monkeypatch):
    official = await provider.get_totals_df()
    monkeypatch.setattr(data_provider_module.lo, "apply_overlay", MagicMock(side_effect=ValueError("bug")))
    assert await provider.get_totals_df(live=True) is official
    pd.testing.assert_frame_equal(await provider.get_averages_df(live=True), await provider.get_averages_df())


@pytest.mark.asyncio
async def test_g1_failure_serves_official(provider, flag_on):
    # Standings updated after period 24 began, yet ESPN still reports 24.
    provider.espn.payload = _tonight(standings_updated=TIP_24 + 9 * HOUR_MS)
    official = await provider.get_totals_df()
    assert await provider.get_totals_df(live=True) is official
    state = await provider.get_live_state()
    assert state.active is False and "did not roll" in state.reason


@pytest.mark.asyncio
async def test_live_slot_usage_adds_tonight(provider, flag_on):
    official = await provider.get_slot_usage()
    live = await provider.get_slot_usage(live=True)
    assert live[1]["PG"] == official[1]["PG"] + 1
    assert live[1]["SG"] == official[1]["SG"] + 1
    assert live[2] == official[2]


@pytest.mark.asyncio
async def test_live_state_counts_games(provider, flag_on):
    provider.scoreboard.return_value = {"games": [{"game_id": GAME_A, "status": "final"}]}
    state = await provider.get_live_state()
    assert state.active and state.period == 24
    # Four games tonight, all tipped by now; none known final yet.
    assert (state.games_total, state.games_live, state.games_final) == (4, 4, 0)
    state = await provider.get_live_state(include_finals=True)
    assert (state.games_total, state.games_live, state.games_final) == (4, 3, 1)
    body = state.to_dict()
    assert set(body) == {"active", "period", "slate_date", "as_of", "games_total", "games_live", "games_final",
                         "official_updated_at"}
    # The badge's games sheet shows this day's games until ESPN goes official.
    assert body["slate_date"] == (settings.season_start + timedelta(days=23)).isoformat()
    assert body["official_updated_at"].startswith("2026-11-12T08:15:58")


# --- memo identity --------------------------------------------------------------

@pytest.mark.asyncio
async def test_official_frame_keeps_its_identity_while_only_lines_change(provider, flag_on):
    first = await provider.get_totals_df()
    provider.espn.payload = _payload(standings_updated=UPDATED_AFTER_23, entries_by_team={1: [
        _entry(11, 0, _line(GAME_A, 24, LINE_20PTS)),
    ]})
    second = await provider.get_totals_df()
    assert second is first
    assert provider.espn.calls["standings"] == 2


@pytest.mark.asyncio
async def test_per_mode_memo_does_not_thrash(provider, flag_on, monkeypatch):
    provider.scoreboard.return_value = {"games": [{"game_id": GAME_A, "status": "final"}]}
    spy = MagicMock(side_effect=provider.data_transformer.totals_to_averages_df)
    monkeypatch.setattr(provider.data_transformer, "totals_to_averages_df", spy)
    for _ in range(3):
        await provider.get_averages_df()
        await provider.get_averages_df(live=True)
        await provider.get_rankings_df(live=True)
        await provider.get_all_dataframes()
    # One build per mode, although the payload was re-downloaded every time.
    assert spy.call_count == 2


# --- the two-layer rule ------------------------------------------------------------

@pytest.mark.asyncio
async def test_db_sync_receives_the_official_frame_only(provider, flag_on, monkeypatch):
    seen = []

    async def record(period, totals_df, updated=None):
        seen.append(totals_df)

    monkeypatch.setattr(provider, "_sync_db_if_needed", record)
    monkeypatch.setattr(data_provider_module.background_tasks, "spawn", lambda coro, *, name: __import__("asyncio").ensure_future(coro))
    await provider.get_totals_df(live=True)
    await provider.get_all_dataframes(live=True)
    await provider.sync_db_now()
    await __import__("asyncio").sleep(0)
    assert seen and all(_pts(df) == 1000 for df in seen)


# --- G1 hardening of the DB sync -------------------------------------------------

def _sync_ready(provider):
    provider.db_service.get_db_max_scoring_period = AsyncMock(return_value=0)
    provider.db_service.upsert_rankings_averages = AsyncMock()
    provider.db_service.upsert_rankings_totals = AsyncMock()
    provider.db_service.upsert_daily_snapshot = AsyncMock()


@pytest.mark.asyncio
async def test_db_sync_held_back_until_standings_absorb_the_completed_day(provider, flag_off):
    _sync_ready(provider)
    totals = provider.data_transformer.raw_standings_to_totals_df(_tonight())
    # ESPN says 25, but its standings are still from the morning of the 12th.
    assert await provider._sync_db_if_needed(25, totals, UPDATED_AFTER_23) is False
    provider.db_service.upsert_daily_snapshot.assert_not_awaited()
    # Once the standings land after period 24's games, the same day is written.
    await provider._sync_db_if_needed(25, totals, TIP_24 + 8 * HOUR_MS)
    provider.db_service.upsert_daily_snapshot.assert_awaited_once()
    assert provider.db_service.upsert_daily_snapshot.await_args.args[0] == 24


@pytest.mark.asyncio
async def test_db_sync_writes_as_before_without_a_schedule(provider, flag_off, monkeypatch):
    _sync_ready(provider)
    monkeypatch.setattr(provider, "get_pro_team_schedules", AsyncMock(side_effect=RuntimeError("down")))
    totals = provider.data_transformer.raw_standings_to_totals_df(_tonight())
    await provider._sync_db_if_needed(25, totals, UPDATED_AFTER_23)
    provider.db_service.upsert_daily_snapshot.assert_awaited_once()


# --- the morning hand-over --------------------------------------------------------

def _absorbed(payload, new_period, standings_updated):
    """ESPN's morning run: period P's lines move into valuesByStat."""
    from app.services import live_overlay as lo
    overlay = lo.build_overlay(payload)
    values = {}
    for team in payload["teams"]:
        vbs = dict(team["valuesByStat"])
        add = overlay.per_team().get(team["id"], {})
        for stat_id, cat in (("0", "PTS"), ("3", "AST"), ("6", "REB"), ("13", "FGM"), ("14", "FGA"),
                             ("15", "FTM"), ("16", "FTA"), ("42", "GP")):
            vbs[stat_id] = vbs.get(stat_id, 0) + add.get(cat, 0)
        vbs["19"] = vbs["13"] / vbs["14"]
        vbs["20"] = vbs["15"] / vbs["16"]
        values[team["id"]] = vbs
    return _payload(period=new_period, standings_updated=standings_updated, values=values)


@pytest.mark.asyncio
async def test_hand_over_has_no_double_count_and_reconciles(provider, flag_on):
    await provider.get_pro_team_schedules()
    tonight = await provider.get_totals_df(live=True)
    assert _pts(tonight) == 1030

    provider.espn.payload = _absorbed(_tonight(), 25, TIP_24 + 8 * HOUR_MS)
    official = await provider.get_totals_df()
    live = await provider.get_totals_df(live=True)

    # Day 24 is in the official totals exactly once, and the live view of
    # period 25 (no games yet) is the official frame itself.
    assert _pts(official) == 1030
    assert live is official
    reconcile = provider.live_health()["last_reconcile"]
    assert reconcile["status"] == "ok", reconcile
    assert reconcile["closed_period"] == 24


@pytest.mark.asyncio
async def test_shadow_reconciliation_runs_with_the_flag_off(provider, flag_off):
    await provider.get_pro_team_schedules()
    await provider.get_totals_df()
    provider.espn.payload = _absorbed(_tonight(), 25, TIP_24 + 8 * HOUR_MS)
    await provider.get_totals_df()
    health = provider.live_health()
    assert health["enabled"] is False
    assert health["last_reconcile"]["status"] == "ok"


@pytest.mark.asyncio
async def test_hand_over_with_period_rolling_before_standings(provider, flag_on):
    await provider.get_pro_team_schedules()
    await provider.get_totals_df()
    # ESPN rolls the period first; standings still yesterday's.
    provider.espn.payload = _payload(period=25, standings_updated=UPDATED_AFTER_23)
    official_before = await provider.get_totals_df()
    assert await provider.get_totals_df(live=True) is official_before
    assert provider.live_health()["g1"]["ok"] is False
    # Then the standings land: reconciled against period 24's overlay.
    provider.espn.payload = _absorbed(_tonight(), 25, TIP_24 + 8 * HOUR_MS)
    await provider.get_totals_df()
    reconcile = provider.live_health()["last_reconcile"]
    assert reconcile["status"] == "ok" and reconcile["closed_period"] == 24


@pytest.mark.asyncio
async def test_reconciliation_reports_diffs(provider, flag_off):
    await provider.get_pro_team_schedules()
    await provider.get_totals_df()
    after = _absorbed(_tonight(), 25, TIP_24 + 8 * HOUR_MS)
    after["teams"][0]["valuesByStat"]["0"] += 2   # a stat correction
    provider.espn.payload = after
    await provider.get_totals_df()
    reconcile = provider.live_health()["last_reconcile"]
    assert reconcile["status"] == "diffs"
    assert reconcile["diffs"] == [{"team_id": 1, "stat": "PTS", "official": 32, "overlay": 30}]


@pytest.mark.asyncio
async def test_live_memo_hit_keeps_the_stored_last_updated_so_etags_can_match(provider, flag_on):
    """A live response is the same bytes until the live frames change; the
    official one keeps its fresh stamp per request, as before."""
    class Resp:
        def __init__(self, n, last_updated=None):
            self.n, self.last_updated = n, last_updated

        def model_copy(self, update):
            return Resp(self.n, update['last_updated'])

    async def build():
        return Resp(1, "built")

    live_first = await provider.memo_response("rankings", (), build, live=True)
    live_again = await provider.memo_response("rankings", (), build, live=True)
    assert live_again is live_first and live_again.last_updated == "built"

    await provider.memo_response("rankings", (), build)
    official_again = await provider.memo_response("rankings", (), build)
    assert official_again.last_updated != "built"
