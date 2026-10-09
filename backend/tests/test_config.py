from datetime import date

from app.config import Settings


def test_season_start_defaults_from_season_id(monkeypatch):
    monkeypatch.delenv("SEASON_START", raising=False)
    s = Settings(SEASON_ID=2027, LEAGUE_ID=1, _env_file=None)
    assert s.season_start == date(2026, 10, 22)


def test_explicit_season_start_wins(monkeypatch):
    monkeypatch.setenv("SEASON_START", "2026-10-20")
    s = Settings(SEASON_ID=2027, LEAGUE_ID=1, _env_file=None)
    assert s.season_start == date(2026, 10, 20)
