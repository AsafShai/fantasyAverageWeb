"""Injury reports recount the Dashboard hub's cached roster health."""
import pytest

from app.models.injury_models import InjuryRecord
from app.services import injury_service as inj


def _rec(team="LAL", player="A. Player", status="Out", last_update=""):
    return InjuryRecord(
        game="7:30 PM", team=team, player=player, status=status,
        injury="Knee", last_update=last_update, game_time_utc=None,
    )


class TestRefreshesTodayHub:
    @staticmethod
    def _run(monkeypatch, old, new):
        from unittest.mock import AsyncMock, MagicMock

        monkeypatch.setattr(inj, "injury_store", old)
        monkeypatch.setattr(inj, "fetch_pdf_bytes", AsyncMock(return_value=b"pdf"))
        monkeypatch.setattr(inj, "parse_injury_pdf", lambda _: new)
        monkeypatch.setattr(inj, "get_db_service", lambda: MagicMock(
            upsert_injury_status=AsyncMock(), delete_injury_status=AsyncMock(),
            get_injury_statuses_for_teams=AsyncMock(return_value=[]),
        ))
        monkeypatch.setattr(inj, "broadcast_notifications", AsyncMock())
        monkeypatch.setattr(inj, "broadcast_fetch_update", AsyncMock())
        seen = []
        monkeypatch.setattr(
            "app.services.today_service.refresh_roster_health",
            lambda: seen.append({k: r.status for k, r in inj.injury_store.items()}),
        )
        return seen

    @pytest.mark.asyncio
    async def test_changed_report_recounts_hub_from_the_new_store(self, monkeypatch):
        seen = self._run(
            monkeypatch,
            {"LAL|LeBron James": _rec(player="LeBron James", status="Questionable")},
            [_rec(player="LeBron James", status="Out")],
        )
        await inj._try_update_injury_data()
        assert seen == [{"LAL|LeBron James": "Out"}]

    @pytest.mark.asyncio
    async def test_unchanged_report_leaves_hub_alone(self, monkeypatch):
        seen = self._run(
            monkeypatch,
            {"LAL|LeBron James": _rec(player="LeBron James", status="Out")},
            [_rec(player="LeBron James", status="Out")],
        )
        await inj._try_update_injury_data()
        assert seen == []
