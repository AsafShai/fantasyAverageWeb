from datetime import date, datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest

from app.models.injury_models import InjuryRecord, InjuryNotification
from app.services import injury_service as inj


def _rec(team="LAL", player="A. Player", status="Out", last_update=""):
    return InjuryRecord(
        game="7:30 PM",
        team=team,
        player=player,
        status=status,
        injury="Knee",
        last_update=last_update,
        game_time_utc=None,
    )


class TestComputeDiff:
    def test_added(self):
        old = {}
        new = [_rec(player="New Guy")]
        notes = inj.compute_diff(old, new, "t1")
        assert len(notes) == 1
        assert notes[0].type == "added"
        assert notes[0].new_status == "Out"

    def test_status_change(self):
        key = "LAL|Same Guy"
        old = {key: _rec(player="Same Guy", status="Questionable")}
        new = [_rec(player="Same Guy", status="Out")]
        notes = inj.compute_diff(old, new, "t1")
        assert len(notes) == 1
        assert notes[0].type == "status_change"
        assert notes[0].old_status == "Questionable"
        assert notes[0].new_status == "Out"

    def test_removed_when_team_still_in_report(self):
        old = {"LAL|Old": _rec(player="Old")}
        new = [_rec(player="Other")]
        notes = inj.compute_diff(old, new, "t1")
        removed = [n for n in notes if n.type == "removed"]
        assert len(removed) == 1
        assert removed[0].player == "Old"

    def test_not_removed_when_team_absent_from_new_report(self):
        old = {"BOS|Only": _rec(team="BOS", player="Only")}
        new = [_rec(team="LAL", player="Laker")]
        notes = inj.compute_diff(old, new, "t1")
        assert not any(n.type == "removed" for n in notes)


class TestBuildUpdatedStore:
    def test_preserves_last_update_when_unchanged(self):
        old = {"LAL|P": _rec(player="P", last_update="old-ts")}
        new = [_rec(player="P", last_update="")]
        notifications = []
        store = inj.build_updated_store(old, new, notifications, "now")
        assert store["LAL|P"].last_update == "old-ts"

    def test_sets_now_when_changed(self):
        old = {"LAL|P": _rec(player="P", status="?")}
        new = [_rec(player="P", status="Out")]
        notifications = inj.compute_diff(old, new, "now")
        store = inj.build_updated_store(old, new, notifications, "now")
        assert store["LAL|P"].last_update == "now"
        assert store["LAL|P"].status == "Out"


class TestParseGameTimeUtc:
    def test_none_on_empty_game(self):
        assert inj.parse_game_time_utc("", date(2025, 1, 1)) is None

    def test_parses_pm_style(self):
        out = inj.parse_game_time_utc("7:30 (ET)", date(2025, 6, 15))
        assert out is not None
        assert "T" in out


class TestGetCurrentPdfUrl:
    def test_url_contains_date_and_bucket(self):
        fixed = datetime(2025, 12, 1, 14, 30, tzinfo=ZoneInfo("America/New_York"))
        with patch("app.services.injury_service.datetime") as dt_mock:
            dt_mock.now.return_value = fixed
            dt_mock.strptime = datetime.strptime
            url = inj.get_current_pdf_url()
        assert "2025-12-01" in url
        assert "Injury-Report_" in url
        assert "_02_30PM" in url
