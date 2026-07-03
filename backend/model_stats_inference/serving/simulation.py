"""Season replay / backtest harness.

Walks day-by-day through a season. At each "today" the feature store reflects only
games strictly before the next game day, so predictions use no future data. Stepping
forward (`advance`) reveals that day's real results, scores the model's
prediction-with-real-minutes against them, then folds the day into the store.

This is the engine behind the local debug UI. It reuses FeatureStore + LiveInference;
the store grows incrementally via `ingest_prederived` (slices of the cached frames),
so a step is cheap.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from ..research import config as rconfig
from ..research import data as rdata
from . import config
from .errors import InsufficientHistoryError, ServingError, UnknownPlayerError
from .feature_store import FeatureStore
from .inference import LiveInference, PredictionRequest

# Stats we surface in the UI (model targets + derived percentages).
DISPLAY_STATS = ["PTS", "REB", "AST", "FG3M", "STL", "BLK", "FGM", "FGA", "FTM", "FTA", "FG_PCT", "FT_PCT"]
REPLAY_SEASON = "2025-26"

# Recency caps (days) used to judge how fresh the form windows are.
W5_DAYS = rconfig.WINDOWS["w5"]["days"]    # 30
W10_DAYS = rconfig.WINDOWS["w10"]["days"]  # 60


@dataclass
class StatCell:
    value: float
    low: float | None = None
    high: float | None = None


@dataclass
class PlayerPrediction:
    player_id: int
    player_name: str
    team_id: int
    opponent_team_id: int
    is_home: bool
    minutes: float
    default_minutes: float
    eligible: bool
    status: str = "green"          # green = confident, orange = stale/thin form, red = no inference
    reason: str = ""
    stats: dict[str, StatCell] = field(default_factory=dict)


@dataclass
class EvalRow:
    player_id: int
    player_name: str
    team_id: int
    opponent_team_id: int
    is_home: bool
    real_minutes: float
    eligible: bool
    reason: str = ""
    game_id: str = ""
    predicted: dict[str, float] = field(default_factory=dict)
    actual: dict[str, float] = field(default_factory=dict)


class SeasonSimulator:
    def __init__(self, players, team_allowed, team_own, models_dir: Path | None = None,
                 season: str = REPLAY_SEASON):
        self.players = rdata._to_datetime(players).sort_values(["PLAYER_ID", "GAME_DATE"])
        self.team_allowed = rdata._to_datetime(team_allowed)
        self.team_own = rdata._to_datetime(team_own)
        self.models_dir = models_dir
        self.season = season

        # (GAME_ID, TEAM_ID) -> OPP_TEAM_ID for opponent lookup.
        self._opp = self.team_allowed.set_index(["GAME_ID", "TEAM_ID"])["OPP_TEAM_ID"].to_dict()

        season_games = self.players[self.players["SEASON"] == season]
        self.replay_days: list[pd.Timestamp] = sorted(season_games["GAME_DATE"].unique())
        if not self.replay_days:
            raise ServingError(f"no games found for season {season}")
        self._i = 0
        self.last_played_date: str | None = None
        self.last_evaluations: list[EvalRow] = []
        self._build_initial_store()

    @classmethod
    def from_research_cache(cls, season: str = REPLAY_SEASON, models_dir: Path | None = None):
        d = rdata.config.DATA_DIR
        return cls(
            pd.read_parquet(d / "players.parquet"),
            pd.read_parquet(d / "team_allowed.parquet"),
            pd.read_parquet(d / "team_own.parquet"),
            models_dir=models_dir,
            season=season,
        )

    # --- store lifecycle ---------------------------------------------------

    def _build_initial_store(self) -> None:
        cutoff = self.replay_days[0]  # store knows only games strictly before day 0
        self.store = FeatureStore.build(
            self.players[self.players["GAME_DATE"] < cutoff],
            self.team_allowed[self.team_allowed["GAME_DATE"] < cutoff],
            self.team_own[self.team_own["GAME_DATE"] < cutoff],
        )
        self.inference = LiveInference(self.store, self.models_dir)

    @property
    def finished(self) -> bool:
        return self._i >= len(self.replay_days)

    @property
    def next_game_day(self) -> pd.Timestamp | None:
        return None if self.finished else self.replay_days[self._i]

    @property
    def current_date(self) -> pd.Timestamp | None:
        return self.replay_days[self._i - 1] if self._i > 0 else None

    # --- queries -----------------------------------------------------------

    def _rows_on(self, day: pd.Timestamp) -> pd.DataFrame:
        return self.players[self.players["GAME_DATE"] == day]

    def _opponent(self, game_id, team_id) -> int:
        return int(self._opp.get((game_id, team_id), -1))

    def _default_minutes(self, player_id: int) -> float:
        if player_id in self.store.player_vectors.index:
            row = self.store.player_vectors.loc[player_id]
            for col in ("MIN_w5_mean", "MIN_w10_mean", "MIN_global_mean"):
                v = row.get(col)
                if v is not None and np.isfinite(v):
                    return float(round(v, 1))
        return 0.0

    def state(self) -> dict:
        day = self.next_game_day
        games = []
        if day is not None:
            rows = self._rows_on(day)
            seen = set()
            for _, r in rows.iterrows():
                if r["GAME_ID"] in seen:
                    continue
                seen.add(r["GAME_ID"])
                games.append({
                    "game_id": r["GAME_ID"],
                    "team_id": int(r["TEAM_ID"]),
                    "opponent_team_id": self._opponent(r["GAME_ID"], r["TEAM_ID"]),
                    "matchup": r["MATCHUP"],
                })
        return {
            "season": self.season,
            "current_date": _d(self.current_date),
            "next_game_day": _d(day),
            "day_index": self._i,
            "total_days": len(self.replay_days),
            "finished": self.finished,
            "num_games": len(games),
            "games": games,
        }

    # --- feature-store inspection -----------------------------------------

    _META_COLS = {"PLAYER_ID", "PLAYER_NAME", "TEAM_ID", "POSITION", "last_game_date", "games_count"}

    def list_players(self) -> list[dict]:
        pv = self.store.player_vectors
        out = []
        for pid, row in pv.iterrows():
            games = int(row["games_count"])
            out.append({
                "player_id": int(pid),
                "player_name": row.get("PLAYER_NAME", str(pid)),
                "team_id": int(row["TEAM_ID"]),
                "games_count": games,
                "eligible": games >= config.MIN_INFERENCE_GAMES,
            })
        out.sort(key=lambda x: x["games_count"], reverse=True)
        return out

    def player_state(self, player_id: int) -> dict:
        pv = self.store.player_vectors
        if player_id not in pv.index:
            raise UnknownPlayerError(f"player {player_id} is not in the feature store")
        row = pv.loc[player_id]
        features = {}
        for col in pv.columns:
            if col in self._META_COLS:
                continue
            v = row[col]
            features[col] = None if v is None or (isinstance(v, float) and not np.isfinite(v)) else float(v)
        games = int(row["games_count"])
        return {
            "player_id": int(player_id),
            "player_name": row.get("PLAYER_NAME", str(player_id)),
            "team_id": int(row["TEAM_ID"]),
            "position": str(row.get("POSITION", "")),
            "last_game_date": _d(row["last_game_date"]),
            "games_count": games,
            "eligible": games >= config.MIN_INFERENCE_GAMES,
            "features": features,
        }

    def list_teams(self) -> list[int]:
        return sorted(int(t) for t in self.store.team_own_vectors["TEAM_ID"])

    def team_state(self, team_id: int) -> dict:
        ts = self.store.get_team_state(team_id)  # raises UnknownTeamError if missing

        def clean(series) -> dict:
            return {
                k: (None if v is None or (isinstance(v, float) and not np.isfinite(v)) else float(v))
                for k, v in series.items()
            }

        return {"team_id": int(team_id), "allowed": clean(ts.allowed), "own": clean(ts.own)}

    def predict_upcoming(self, minutes_overrides: dict[int, float] | None = None) -> list[PlayerPrediction]:
        if self.finished:
            return []
        overrides = minutes_overrides or {}
        reqs: list[PredictionRequest] = []
        meta = []  # (row, minutes, default_min, opp, is_home) aligned to reqs
        for _, r in self._rows_on(self.next_game_day).iterrows():
            pid = int(r["PLAYER_ID"])
            default_min = self._default_minutes(pid)
            minutes = float(overrides.get(pid, default_min))
            opp = self._opponent(r["GAME_ID"], r["TEAM_ID"])
            is_home = "vs" in str(r["MATCHUP"])
            reqs.append(PredictionRequest(
                player_id=pid, opponent_team_id=opp, is_home=is_home,
                game_date=self.next_game_day, minutes=minutes,
            ))
            meta.append((r, minutes, default_min, opp, is_home))

        results, errors = self.inference.predict_many(reqs)
        out = [self._build_prediction(*m, res, err) for m, res, err in zip(meta, results, errors)]
        out.sort(key=lambda p: p.stats.get("PTS", StatCell(0)).value, reverse=True)
        return out

    def predict_player(self, player_id: int, minutes: float) -> PlayerPrediction:
        rows = self._rows_on(self.next_game_day)
        row = rows[rows["PLAYER_ID"] == player_id]
        if row.empty:
            raise ServingError(f"player {player_id} does not play on {_d(self.next_game_day)}")
        return self._predict_player(row.iloc[0], float(minutes), self._default_minutes(player_id))

    def _freshness(self, player_id: int, predict_date) -> tuple[str, str]:
        """Confidence of an eligible prediction based on how many games fall in the
        recent-form windows (computed from real game dates, anchor-independent)."""
        predict_date = pd.Timestamp(predict_date)
        games = self.players[
            (self.players["PLAYER_ID"] == player_id) & (self.players["GAME_DATE"] < predict_date)
        ]["GAME_DATE"]
        if games.empty:
            return "orange", "No prior games on record — projection uses defaults only."
        last = games.max()
        gap = (predict_date - last).days
        r30 = int((games >= predict_date - pd.Timedelta(days=W5_DAYS)).sum())
        r60 = int((games >= predict_date - pd.Timedelta(days=W10_DAYS)).sum())
        if r60 == 0:
            return "orange", (
                f"Last game {gap} days ago ({_d(last)}); 0 games in the last {W10_DAYS} days. "
                f"The recent-form windows are empty, so the projection leans on career/"
                f"season-long averages only — lower confidence."
            )
        if r30 < 3 or r60 < 5:
            return "orange", (
                f"Last game {gap} days ago ({_d(last)}); only {r30} game(s) in the last "
                f"{W5_DAYS}d and {r60} in the last {W10_DAYS}d. Recent-form windows are thin "
                f"or partly stale — treat with lower confidence."
            )
        return "green", ""

    def _predict_player(self, row, minutes: float, default_min: float) -> PlayerPrediction:
        opp = self._opponent(row["GAME_ID"], row["TEAM_ID"])
        is_home = "vs" in str(row["MATCHUP"])
        req = PredictionRequest(
            player_id=int(row["PLAYER_ID"]), opponent_team_id=opp, is_home=is_home,
            game_date=self.next_game_day, minutes=minutes,
        )
        results, errors = self.inference.predict_many([req])
        return self._build_prediction(row, minutes, default_min, opp, is_home, results[0], errors[0])

    def _build_prediction(self, row, minutes, default_min, opp, is_home, res, err) -> PlayerPrediction:
        """Assemble a PlayerPrediction from a batched result (or its error)."""
        pid = int(row["PLAYER_ID"])
        pred = PlayerPrediction(
            player_id=pid, player_name=row.get("PLAYER_NAME", str(pid)),
            team_id=int(row["TEAM_ID"]), opponent_team_id=opp, is_home=is_home,
            minutes=minutes, default_minutes=default_min, eligible=True,
        )
        if err is not None:
            pred.eligible = False
            pred.status = "red"
            pred.reason = str(err)
        else:
            pred.stats = {k: StatCell(v.value, v.low, v.high) for k, v in res.stats.items()}
            pred.status, reason = self._freshness(pid, self.next_game_day)
            if reason:
                pred.reason = reason
        return pred

    # --- stepping forward --------------------------------------------------

    def advance(self) -> list[EvalRow]:
        """Reveal the next game day: score predictions (with real minutes) vs actuals,
        then ingest the day into the store and move on."""
        if self.finished:
            return []
        day = self.next_game_day
        rows = self._rows_on(day)

        evals = self._evaluate_all(rows, day)

        # Fold the day into the store, then advance the pointer.
        self.store.ingest_prederived(
            rows,
            self.team_allowed[self.team_allowed["GAME_DATE"] == day],
            self.team_own[self.team_own["GAME_DATE"] == day],
        )
        self._i += 1
        # Remember for the UI so the panel survives page navigation / reloads.
        self.last_played_date = _d(day)
        self.last_evaluations = evals
        return evals

    def _evaluate_all(self, rows, day) -> list[EvalRow]:
        """Score every player on ``day`` against actuals, batched through one
        vectorized predict (real minutes the players actually played)."""
        reqs: list[PredictionRequest] = []
        meta = []  # (row, opp, is_home, real_min) aligned to reqs
        for _, row in rows.iterrows():
            opp = self._opponent(row["GAME_ID"], row["TEAM_ID"])
            is_home = "vs" in str(row["MATCHUP"])
            real_min = float(row["MIN"])
            reqs.append(PredictionRequest(
                player_id=int(row["PLAYER_ID"]), opponent_team_id=opp, is_home=is_home,
                game_date=day, minutes=real_min,  # score with the minutes they actually played
            ))
            meta.append((row, opp, is_home, real_min))

        results, errors = self.inference.predict_many(reqs)
        evals = []
        for (row, opp, is_home, real_min), res, err in zip(meta, results, errors):
            pid = int(row["PLAYER_ID"])
            ev = EvalRow(
                player_id=pid, player_name=row.get("PLAYER_NAME", str(pid)),
                team_id=int(row["TEAM_ID"]), opponent_team_id=opp, is_home=is_home,
                real_minutes=real_min, eligible=True, actual=_actual_line(row),
            )
            if err is not None:
                ev.eligible = False
                ev.reason = str(err)
            else:
                ev.predicted = {k: round(v.value, 2) for k, v in res.stats.items()}
            evals.append(ev)
        return evals


def _actual_line(row) -> dict[str, float]:
    out = {s: float(row[s]) for s in DISPLAY_STATS if s in row.index and s not in ("FG_PCT", "FT_PCT")}
    out["FG_PCT"] = round(out["FGM"] / out["FGA"], 3) if out.get("FGA") else 0.0
    out["FT_PCT"] = round(out["FTM"] / out["FTA"], 3) if out.get("FTA") else 0.0
    return out


def _d(ts) -> str | None:
    return None if ts is None else pd.Timestamp(ts).strftime("%Y-%m-%d")
