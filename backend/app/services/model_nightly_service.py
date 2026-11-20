"""Nightly model pipeline: fetch last night's games, retro-predict with real
minutes, persist predicted-vs-actual, grow the feature store, and refresh the
materialized feature vectors.

Storage layout in Postgres:
  - fs_player_games / fs_team_games  : raw game rows, the source of truth.
  - fs_*_vectors                     : the 'as of now' player/team vectors,
    DERIVED from the raw rows and re-materialized every morning so a live
    inference path can load ready-to-use vectors without recomputing.

Predictions for a night are computed from rows strictly before it (leakage-safe
by construction); the vectors written afterwards include that night, so they are
current for the *next* game. A model_nightly_runs ledger row per date makes the
scheduler's retries no-ops after one success (model_nightly_scheduler).

Manual runs:
    uv run python -m app.services.model_nightly_service --bootstrap [--until-date YYYY-MM-DD]
    uv run python -m app.services.model_nightly_service [--date YYYY-MM-DD] [--force]
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
from datetime import date, datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

import polars as pl

from app.config import settings
from app.services.db_service import DBService
from app.services.roster_stints.service import RosterStintsService
from app.utils.frames import dicts_frame
from app.utils.memory import log_memory, release_memory
from model_stats_inference.research import config as rconfig
from model_stats_inference.serving import config as sconfig
from model_stats_inference.serving import featurize, nightly
from model_stats_inference.serving.eval_row import EvalRow
from model_stats_inference.serving.feature_store import _PLAYER_META, FeatureStore
from model_stats_inference.serving.inference import (
    REQUEST_TIME_FEATURES,
    REQUEST_TIME_PREFIX,
    LiveInference,
)
from model_stats_inference.training import config as tconfig

logger = logging.getLogger(__name__)

ISRAEL_TZ = ZoneInfo("Asia/Jerusalem")
CATCHUP_DAYS = 7
_INVALIDATING_STATUSES = {"processed", "store_already_ingested"}
# A night that reached the ledger in this run (not one found there already).
_NEWLY_RECORDED_STATUSES = {"processed", "no_games", "store_already_ingested"}

_EVAL_STATS = ["PTS", "REB", "AST", "FG3M", "STL", "BLK", "FGM", "FGA", "FTM", "FTA"]

# Column orders must match DBService.insert_fs_rows.
_FS_PLAYER_COLS = [
    "PLAYER_ID", "GAME_ID", "SEASON", "GAME_DATE", "PLAYER_NAME", "TEAM_ID",
    "MATCHUP", "POSITION", "MIN", "PTS", "REB", "OREB", "DREB", "AST", "FG3M",
    "FG3A", "STL", "BLK", "TOV", "FGM", "FGA", "FTM", "FTA", "PF", "PLUS_MINUS",
]
_FS_TEAM_COLS = [
    "TEAM_ID", "GAME_ID", "SEASON", "GAME_DATE", "TEAM_NAME", "MATCHUP",
    "PTS", "REB", "AST", "STL", "BLK", "FG3M", "FG_PCT", "FGA", "FTA", "TOV",
]


def _is_missing(v) -> bool:
    return v is None or (isinstance(v, float) and math.isnan(v))


def _frame_to_tuples(df: pl.DataFrame, cols: list[str]) -> list[tuple]:
    out = []
    for row in df.select(cols).iter_rows():
        vals = []
        for col, v in zip(cols, row):
            if col in ("PLAYER_ID", "TEAM_ID"):
                vals.append(int(v))
            elif col == "GAME_DATE":
                vals.append(v if not isinstance(v, datetime) else v.date())
            elif col in ("GAME_ID", "SEASON", "PLAYER_NAME", "TEAM_NAME", "MATCHUP", "POSITION"):
                vals.append("" if _is_missing(v) else str(v))
            else:
                vals.append(float(v))
        out.append(tuple(vals))
    return out


def _eval_to_tuple(ev: EvalRow, game_date: date) -> tuple:
    return (
        ev.game_id, ev.player_id, game_date, ev.player_name, ev.team_id,
        ev.opponent_team_id, ev.is_home, ev.real_minutes, ev.eligible, ev.reason,
        *[ev.predicted.get(s) if ev.eligible else None for s in _EVAL_STATS],
        *[float(ev.actual.get(s, 0.0)) for s in _EVAL_STATS],
    )


# --- feature-vector (de)serialization --------------------------------------

def _features_dict(row: dict, feature_cols: list[str]) -> dict[str, Optional[float]]:
    """One vector row's features as a dict (NaN -> None).

    Returned as a dict, not a JSON string: the pool's jsonb codec already runs
    json.dumps, so a pre-dumped string would be stored as a JSON string scalar
    instead of an object (and jsonb_object_keys / ``?`` then fail on it).
    """
    out = {}
    for c in feature_cols:
        v = row[c]
        out[c] = None if v is None or (isinstance(v, float) and math.isnan(v)) else float(v)
    return out


def _serialize_vectors(
    store: FeatureStore, player_ids: list[int] | None = None
) -> tuple[list[tuple], list[tuple], list[tuple]]:
    """FeatureStore vectors -> DB row tuples for upsert_feature_vectors.

    ``player_ids`` limits the player rows to those (the nightly recompute only
    changes the players who played); team rows always come whole."""
    pv = store.player_vectors
    if player_ids is not None:
        pv = pv.filter(pl.col("PLAYER_ID").is_in(player_ids))
    pfeat = [c for c in pv.columns if c not in _PLAYER_META]
    player_rows = []
    for row in pv.iter_rows(named=True):
        games = int(row["games_count"])
        last = row["last_game_date"]
        last = (last.date() if isinstance(last, datetime) else last) if not _is_missing(last) else None
        player_rows.append((
            int(row["PLAYER_ID"]), str(row.get("PLAYER_NAME", "")), int(row["TEAM_ID"]),
            str(row.get("POSITION", "")), last, games,
            games >= sconfig.MIN_INFERENCE_GAMES, _features_dict(row, pfeat),
        ))

    def team_rows(tv: pl.DataFrame) -> list[tuple]:
        feat = [c for c in tv.columns if c != "TEAM_ID"]
        return [(int(row["TEAM_ID"]), _features_dict(row, feat)) for row in tv.iter_rows(named=True)]

    return player_rows, team_rows(store.team_allowed_vectors), team_rows(store.team_own_vectors)


def _float_features(df: pl.DataFrame, feat_cols: list[str]) -> pl.DataFrame:
    """Feature columns as float64 with NULL -> NaN (pandas astype(float))."""
    return df.with_columns([pl.col(c).cast(pl.Float64).fill_null(float("nan")) for c in feat_cols])


def _player_vectors_df(records: list[dict]) -> pl.DataFrame:
    """DB rows -> player_vectors frame (meta cols + expanded features, NaN restored)."""
    rows = []
    for r in records:
        feats = r["features"] if isinstance(r["features"], dict) else json.loads(r["features"])
        rows.append({
            "PLAYER_ID": r["player_id"], "PLAYER_NAME": r["player_name"],
            "TEAM_ID": r["team_id"], "POSITION": r["position"],
            "last_game_date": r["last_game_date"] if r["last_game_date"] else None,
            "games_count": r["games_count"], **feats,
        })
    df = dicts_frame(rows)
    df = df.with_columns(pl.col("last_game_date").cast(pl.Date))
    feat_cols = [c for c in df.columns if c not in _PLAYER_META]
    return _float_features(df, feat_cols)


def _team_vectors_df(records: list[dict]) -> pl.DataFrame:
    rows = []
    for r in records:
        feats = r["features"] if isinstance(r["features"], dict) else json.loads(r["features"])
        rows.append({"TEAM_ID": r["team_id"], **feats})
    df = dicts_frame(rows)
    return _float_features(df, [c for c in df.columns if c != "TEAM_ID"])


_EMPTY_PLAYER_VECTORS = {
    "PLAYER_ID": pl.Int64, "PLAYER_NAME": pl.String, "TEAM_ID": pl.Int64,
    "POSITION": pl.String, "last_game_date": pl.Date, "games_count": pl.Int64,
}


_FS_TEXT_COLS = {"GAME_ID", "SEASON", "PLAYER_NAME", "TEAM_NAME", "MATCHUP", "POSITION"}


def _conform(df: Optional[pl.DataFrame], cols: list[str]) -> pl.DataFrame:
    """``df`` reduced to ``cols`` with the stored types (ids Int64, text,
    GAME_DATE pl.Date, stats Float64), so DB rows and ESPN rows concatenate.
    A missing or column-less frame (what the DB returns for no rows) becomes
    an empty frame with those columns."""
    def dtype(c):
        if c in ("PLAYER_ID", "TEAM_ID"):
            return pl.Int64
        if c == "GAME_DATE":
            return pl.Date
        return pl.String if c in _FS_TEXT_COLS else pl.Float64
    if df is None or df.is_empty() or not set(cols) <= set(df.columns):
        return pl.DataFrame(schema={c: dtype(c) for c in cols})
    return df.select([pl.col(c).cast(dtype(c)) for c in cols])


def _corrected(base: pl.DataFrame, fixes: pl.DataFrame, cols: list[str], keys: list[str],
               gate: bool = False) -> pl.DataFrame:
    """``base`` (rows as stored) with ``fixes`` (rows as ESPN has them now) in
    place of the rows with the same keys, and the new ones added. With
    ``gate`` the fixes go through the model's MIN_MINUTES read gate, as the
    stored rows did (get_fs_rows_before): a line corrected below it drops out."""
    base, fixes = _conform(base, cols), _conform(fixes, cols)
    if fixes.is_empty():
        return base
    kept = base.join(fixes.select(keys), on=keys, how="anti")
    add = fixes.filter(pl.col("MIN") >= rconfig.MIN_MINUTES) if gate else fixes
    return pl.concat([kept, add], how="vertical")


def _resolve_positions(lines: pl.DataFrame, history: pl.DataFrame, pv: list[dict]) -> pl.DataFrame:
    """Fill an empty POSITION (ESPN's box score sometimes leaves it out) from
    the player's last known one: his latest stored game with a position, else
    his stored vector. As the nightly does (nightly.attach_positions), so a
    corrected or added line never blanks his position."""
    if lines.is_empty():
        return lines
    known = {int(r["player_id"]): r["position"] for r in pv if r.get("position")}
    if history is not None and not history.is_empty() and "POSITION" in history.columns:
        last = (history.filter(pl.col("POSITION").fill_null("") != "")
                .sort("GAME_DATE").group_by("PLAYER_ID").agg(pl.col("POSITION").last()))
        known.update({int(p): pos for p, pos in last.iter_rows()})
    return lines.with_columns(pl.Series("POSITION", [
        pos if pos else known.get(int(pid), "")
        for pos, pid in zip(lines["POSITION"].fill_null("").to_list(), lines["PLAYER_ID"].to_list())
    ], dtype=pl.String))


def _clear_night_read_caches() -> None:
    """Drop the read caches that hold "the latest night", so the night just
    recorded shows at once instead of when they expire: the season's latest
    game date (Players page, player stats and the trends, which clear their
    own caches when it moves; was up to 1 h), the players list built on it
    (5 min) and the Today hub with its last-night block (5 min)."""
    # Deferred imports: these modules sit above this one in the import graph.
    from app.services.player_service import clear_night_caches
    from app.services.today_service import clear_today_hub_cache

    for clear in (clear_night_caches, clear_today_hub_cache):
        try:
            clear()
        except Exception as e:      # a cache must never fail the run that records the night
            logger.warning(f"Clearing a read cache after the nightly failed: {type(e).__name__}: {e}")


class ModelNightlyService:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._lock = asyncio.Lock()
            cls._instance._store_lock = asyncio.Lock()
            cls._instance._db = DBService()
            # Resident inference store: loaded from the vectors tables on first
            # use and kept in memory so intra-day predictions never touch the DB.
            # Invalidated whenever the nightly job refreshes the vectors.
            cls._instance._inference_store: Optional[FeatureStore] = None
        return cls._instance

    # --- morning entry point (called by the scheduler) ----------------------

    async def run_catchup(self, through: Optional[date] = None, final: bool = False) -> dict[str, str]:
        """Process every unprocessed date in the trailing window, oldest first.

        ``through`` is the newest night to consider: the scheduler passes the
        night it is working on (its US date, which an afternoon-only slate
        reaches while it is still that day in Israel). Without it, yesterday
        in Israel, as the manual runs have always used.

        Stops at the first date that isn't in a terminal state (incomplete data,
        DB failure): ingesting later days before an earlier day would leave the
        store with a hole under those predictions.

        Runs the missing-feature check first, outside the loop, so a deploy that adds
        a feature heals even when no date in the window has games (off-season).

        Roster stints are rebuilt when a night newly lands in the ledger (games
        or not: transactions happen on off days too) and on the scheduler's
        ``final`` attempt of the morning, never on the retries in between.

        The ``final`` attempt also sweeps the window for ESPN's later box-score
        corrections (sweep_corrections).
        """
        missing = await self._ensure_vectors_current()
        newest = through or (datetime.now(ISRAEL_TZ) - timedelta(days=1)).date()
        logger.info(
            f"Model nightly catch-up: nights {newest - timedelta(days=CATCHUP_DAYS - 1)} .. {newest}"
        )
        statuses: dict[str, str] = {"missing_features": missing} if missing else {}
        for offset in range(CATCHUP_DAYS - 1, -1, -1):
            d = newest - timedelta(days=offset)
            try:
                status = await self.run_for_date(d)
            except Exception as e:
                logger.error(f"Model nightly run_for_date({d}) raised: {type(e).__name__}: {e}")
                raise
            statuses[d.isoformat()] = status
            if status not in ("processed", "no_games", "already_processed", "store_already_ingested"):
                # Waiting on the games is the normal state of an early attempt.
                log = logger.info if status == "incomplete_data" else logger.warning
                log(f"Model nightly catch-up stopped at {d}: {status}")
                break
        if settings.surprise_nightly_enabled:
            await self._retry_unscored_surprises(statuses, oldest=newest - timedelta(days=CATCHUP_DAYS - 1))
        refreshed_by_sweep = False
        if final:
            # ESPN corrects box scores a day or more after the night; the
            # morning's last attempt brings the stored nights in line.
            corrections = await self.sweep_corrections(newest)
            if corrections:
                statuses["corrections"] = corrections
                refreshed_by_sweep = "vectors: refreshed" in corrections
        if (missing == "vectors_refreshed" or refreshed_by_sweep
                or _INVALIDATING_STATUSES.intersection(statuses.values())):
            await self._prewarm_inference_store()
            release_memory("nightly catch-up: inference store prewarmed", logger)
        if final or _NEWLY_RECORDED_STATUSES.intersection(statuses.values()):
            await RosterStintsService().rebuild()
        return statuses

    async def _retry_unscored_surprises(self, statuses: dict[str, str], oldest: date) -> None:
        """Score every ingested night in the catch-up window (``oldest`` ..
        yesterday) that still has no Boom or Bust rows.

        The surprises step runs at the end of the run that marks a night
        processed, so a run that dies after the mark (a restart, a crash) left
        the night unscored and every later slot skipped it. Each slot now
        finishes the job. A night already scored is never touched; a night
        that keeps failing ages out with the window instead of being retried
        every slot all season. A night whose inline step just failed in this
        slot gets one more try here, which is cheap. Skipped when a night in
        the loop raised: the scheduler retries the whole catch-up next slot."""
        from app.services.surprise_service import SurpriseService
        try:
            async with self._lock:
                done = await SurpriseService(db=self._db).backfill_missing(since=oldest)
        except Exception as e:
            logger.error(f"Surprises retry failed: {type(e).__name__}: {e}", exc_info=True)
            statuses["surprises_retry"] = "failed"
            return
        if not done:
            logger.info(f"Surprises retry: nothing to score since {oldest}")
            return
        for night, status in done.items():
            log = logger.info if status == "processed" else logger.error
            log(f"Surprises retry {night}: {status}")
        statuses["surprises_retry"] = ", ".join(f"{d}: {s}" for d, s in done.items())

    # --- ESPN's later corrections (the scheduler's final attempt) -----------

    async def sweep_corrections(self, newest: date) -> Optional[str]:
        """Re-read the stored nights of the catch-up window from ESPN and apply
        what ESPN has corrected since (a rebound or steal moved to another
        player, a turnover taken back: ~2% of lines, almost all +-1, arriving
        a day or more after the night). None when nothing changed.

        Everything a correction changes is computed first and written in one
        transaction (_commit_corrections): the rows, the predicted-vs-actual
        actuals (the predictions stay as made) and the vectors of every player
        and team it touches - a team row reaches every player of that game
        through the usage rate. A failure writes nothing, so the next morning
        sees the same differences and tries again. Then Boom or Bust is
        rescored wherever it disagrees with the stored box scores, which also
        catches a rescore that failed on an earlier morning.
        Nights not processed, or that ESPN no longer serves complete, are left
        alone. Never raises: a failure here must not cost the morning's run."""
        try:
            async with self._lock:
                return await self._sweep_corrections(newest)
        except Exception as e:
            logger.error(f"Correction sweep failed: {type(e).__name__}: {e}", exc_info=True)
            return "failed"

    async def _sweep_corrections(self, newest: date) -> Optional[str]:
        db = self._db
        oldest = newest - timedelta(days=CATCHUP_DAYS - 1)
        notes: list[str] = []
        committed: list[date] = []
        vanished = 0
        for offset in range(CATCHUP_DAYS - 1, -1, -1):
            d = newest - timedelta(days=offset)
            run = await db.get_model_nightly_run(d)
            if not run or run.get("status") not in ("processed", "store_already_ingested"):
                continue
            fresh = await asyncio.to_thread(nightly.fetch_night, d)
            if not fresh.complete or fresh.expected_games == 0:
                logger.warning(f"Correction sweep {d}: ESPN does not serve the night complete now; left as stored")
                continue
            stored_players, stored_teams = await db.get_fs_rows_on(d)
            if stored_players is None:
                return "; ".join(notes + ["db_unavailable"])
            c = nightly.diff_night(stored_players, stored_teams, fresh.player_games, fresh.team_games)
            vanished += len(c.vanished_players)
            if c.empty:
                continue
            # One night per transaction: the memory a commit needs is bounded
            # by one night's games, like the nightly's own incremental path.
            note, ok = await self._commit_corrections(d, c, stored_players, fresh)
            notes.append(note)
            if ok:
                committed.append(d)
        if vanished:
            # Never deleted (likelier a feed hiccup than a correction); one
            # line a morning while such a night is in the window.
            logger.info(f"Correction sweep: {vanished} stored line(s) not in ESPN's box scores now, left as stored")
        if settings.surprise_nightly_enabled:
            notes.extend(await self._rescore_stale_surprises(oldest, committed))
        if not notes:
            logger.info(f"Correction sweep through {newest}: stored nights match ESPN")
            return None
        return "; ".join(notes)

    async def _commit_corrections(
        self, night: date, c: "nightly.NightCorrections", stored_players: pl.DataFrame,
        fresh: "nightly.NightFetch",
    ) -> tuple[str, bool]:
        """Compute everything one night's corrections change, then write it in
        one transaction (DBService.apply_corrections). Nothing is written
        before everything is computed, and a failed write writes nothing, so
        the next morning sees the same differences and tries again."""
        db = self._db
        pk, tk = ["PLAYER_ID", "GAME_ID"], ["TEAM_ID", "GAME_ID"]
        changed = c.changed_players
        if not changed.is_empty() and "POSITION" in stored_players.columns:
            # A stored line keeps its stored position (the write never
            # touches it); carry it here too so the vectors see the same.
            stored_pos = _conform(stored_players, _FS_PLAYER_COLS).select(pk + [pl.col("POSITION").alias("_stored_pos")])
            changed = (_conform(changed, _FS_PLAYER_COLS).join(stored_pos, on=pk, how="left")
                       .with_columns(pl.coalesce("_stored_pos", "POSITION").alias("POSITION")).drop("_stored_pos"))
        eval_actuals = [
            (str(r["GAME_ID"]), int(r["PLAYER_ID"]), *[float(r[s]) for s in _EVAL_STATS])
            for r in changed.iter_rows(named=True)
        ]
        lines = pl.concat([_conform(changed, _FS_PLAYER_COLS), _conform(c.new_players, _FS_PLAYER_COLS)])
        teams = _conform(c.changed_teams, _FS_TEAM_COLS)

        player_ids = set(c.player_ids())
        if not teams.is_empty():
            # A team row feeds the usage (USG) of every player of that game:
            # it divides by the team's possessions. Recompute them all.
            games = set(teams["GAME_ID"].to_list())
            player_ids.update(int(p) for p in fresh.player_games.filter(
                pl.col("GAME_ID").cast(pl.String).is_in(games))["PLAYER_ID"])
        ids = sorted(player_ids)
        team_ids = sorted({int(t) for t in fresh.team_games["TEAM_ID"]})

        vectors_as_of, latest = await asyncio.gather(
            db.get_vectors_as_of(), db.get_latest_fs_date_before(date.max)
        )
        bound = max(d for d in (latest, night) if d is not None) + timedelta(days=1)
        history, team_games = await db.get_fs_rows_before_for_players(bound, ids)
        pv, tav, tov = await db.load_feature_vectors(player_ids=ids)
        lines = _resolve_positions(lines, history, pv)

        vectors, dropped, vec_note = None, [], "left_to_rebuild"
        if vectors_as_of is None or latest is None or vectors_as_of != latest:
            logger.warning(
                f"Correction sweep: vectors are through {vectors_as_of}, the store through {latest}; "
                f"left to the next full rebuild"
            )
        elif team_games.is_empty() or not tav or not tov:
            vec_note = "skipped (store empty)"
        else:
            vectors, dropped = await asyncio.to_thread(
                self._recompute_sync, pv, tav, tov,
                _corrected(history, lines, _FS_PLAYER_COLS, pk, gate=True),
                _corrected(team_games, teams, _FS_TEAM_COLS, tk),
                ids, team_ids,
            )
            vec_note = "refreshed"
        del history, team_games, pv, tav, tov

        summary = (f"{night}: {len(c.changed_players)} changed, {len(c.new_players)} new player line(s), "
                   f"{len(c.changed_teams)} team row(s)")
        if not await db.apply_corrections(
            _frame_to_tuples(lines, _FS_PLAYER_COLS) if not lines.is_empty() else [],
            _frame_to_tuples(teams, _FS_TEAM_COLS) if not teams.is_empty() else [],
            eval_actuals, vectors, dropped,
        ):
            return f"{summary}; write failed, nothing written: retried next morning", False
        # Committed: what depends on it first, so nothing below can skip it.
        if vectors is not None:
            self._invalidate_inference_store()
        _clear_night_read_caches()
        try:
            logger.info(f"Correction sweep {summary}; vectors {vec_note}"
                        + (f", {len(dropped)} dropped" if dropped else ""))
            for r in lines.head(10).iter_rows(named=True):
                logger.info(f"Correction sweep {night}: {r['PLAYER_NAME']} ({r['GAME_ID']})")
        except Exception:
            pass
        return f"{summary}; vectors: {vec_note}", True

    async def _rescore_stale_surprises(self, oldest: date, committed: list[date]) -> list[str]:
        """Rescore Boom or Bust where it no longer agrees with the box scores:
        the nights corrected now, and any night whose rows still disagree
        (a rescore that failed on an earlier morning, ESPN's rosters
        unavailable then). Owners are kept: a rescore needs the rosters."""
        from app.services.surprise_service import SurpriseService

        stale = await self._db.get_nights_with_stale_surprises(oldest, settings.surprise_min_minutes)
        todo = sorted(set(committed) | set(stale or []))
        notes = []
        for d in todo:
            try:
                status = await SurpriseService(db=self._db).compute_and_store(d, require_roster=True)
            except Exception as e:
                status = f"failed ({type(e).__name__})"
                logger.error(f"Correction sweep {d}: Boom or Bust rescore failed: {e}", exc_info=True)
            notes.append(f"{d} boom or bust: {status}")
        if todo:
            release_memory("correction sweep: surprises rescored", logger)
        return notes

    @staticmethod
    def _recompute_sync(
        pv: list[dict], tav: list[dict], tov: list[dict],
        players: pl.DataFrame, team_games: pl.DataFrame,
        player_ids: list[int], team_ids: list[int],
    ) -> tuple[tuple[list, list, list], list[int]]:
        """The incremental fold-in's recompute, with nothing new to fold in:
        the given players from their own (corrected) history, the given teams
        from the (corrected) team rows; exactly what a full rebuild computes
        for them. Returns (vectors, players to drop): a player the
        corrections left with no game above the minutes gate has no vector in
        a full rebuild, so his stored one goes."""
        players = _conform(players, _FS_PLAYER_COLS)
        store = FeatureStore.from_vectors(
            _player_vectors_df(pv) if pv else pl.DataFrame(schema=_EMPTY_PLAYER_VECTORS),
            _team_vectors_df(tav), _team_vectors_df(tov),
        )
        store.players = players.sort(["PLAYER_ID", "GAME_DATE"], maintain_order=True)
        store.team_allowed = featurize.build_team_allowed(_conform(team_games, _FS_TEAM_COLS))
        store.team_own = featurize.build_team_own(_conform(team_games, _FS_TEAM_COLS))
        present = set(int(p) for p in store.players["PLAYER_ID"])
        with_rows = [p for p in player_ids if p in present]
        store._recompute(with_rows, team_ids)
        stored = {int(r["player_id"]) for r in pv}
        dropped = [p for p in player_ids if p not in present and p in stored]
        return _serialize_vectors(store, player_ids=with_rows), dropped

    async def run_for_date(self, game_date: date, force: bool = False) -> str:
        async with self._lock:
            return await self._run_for_date(game_date, force)

    async def _run_for_date(self, game_date: date, force: bool) -> str:
        db = self._db
        if not force:
            run = await db.get_model_nightly_run(game_date)
            if run is not None:
                # Only the newest night is worth a line each slot; older ones
                # were reported on their own morning.
                newest = game_date >= (datetime.now(ISRAEL_TZ) - timedelta(days=1)).date()
                logger.log(
                    logging.INFO if newest else logging.DEBUG,
                    f"Nightly {game_date}: already in the ledger ({run.get('status')}, "
                    f"{run.get('num_games')} games, marked at {run.get('ran_at')}); skipped",
                )
                return "already_processed"
        logger.info(f"Nightly {game_date}: not in the ledger; processing")

        # Leakage guard (unconditional, even with --force): once the night's rows
        # are in the store, a "prediction" for it would see its own outcome. We
        # still refresh vectors — this branch is the crash-recovery path (raw rows
        # committed on a prior run but vectors/ledger not), so vectors may be stale.
        has_date = await db.fs_has_date(game_date)
        if has_date is None:
            return "db_unavailable"
        if has_date:
            # None ("no raw rows") is impossible here — has_date implies rows exist —
            # so only an actual write failure is treated as one.
            if await self._refresh_vectors_through(game_date) is False:
                return "db_write_failed"
            self._invalidate_inference_store()
            await self._record_run(db, game_date, "store_already_ingested", 0, 0)
            return "store_already_ingested"

        # Step markers: an OOM kill leaves no traceback, so the last [mem] line
        # names the step that ran out of memory.
        log_memory(f"nightly {game_date}: fetching night", logger)
        night = await asyncio.to_thread(nightly.fetch_night, game_date)
        logger.info(
            f"Nightly {game_date}: fetched night (complete={night.complete}, "
            f"expected_games={night.expected_games}, "
            f"player_rows={len(night.player_games)}, team_rows={len(night.team_games)})"
        )
        if not night.complete:
            # Checked before the expected_games==0 branch below: a zero-events
            # scoreboard that ESPN's whitelist says should have games comes back
            # as expected_games=0, complete=False too, and must retry, not seal.
            logger.info(
                f"Night {game_date} not complete yet "
                f"(expected {night.expected_games} games); will retry next slot"
            )
            return "incomplete_data"
        if night.expected_games == 0:
            await self._record_run(db, game_date, "no_games", 0, 0)
            return "no_games"

        # Two ways to get the pre-night store. The stored vectors ARE the state
        # through the last ingested night (each night folds itself in), so when
        # they are current they can be loaded as-is (~1 MB) instead of rebuilt
        # from the whole history (~90k rows, the step that OOM-killed a 512 MB
        # container). Only the players who played tonight need recomputing, from
        # their own rows. If the vectors lag the raw rows (a crashed run, a
        # re-seed), fall back to the full rebuild, which heals them.
        vectors_as_of, latest_fs = await asyncio.gather(
            db.get_vectors_as_of(), db.get_latest_fs_date_before(game_date)
        )
        incremental = (
            vectors_as_of is not None and latest_fs is not None and vectors_as_of == latest_fs
        )
        if incremental:
            night_ids = [int(p) for p in night.player_games["PLAYER_ID"].unique(maintain_order=True)]
            log_memory(f"nightly {game_date}: loading history of tonight's players", logger)
            players, team_games = await db.get_fs_rows_before_for_players(game_date, night_ids)
            # Only tonight's players' vectors: predictions read theirs, the fold-in
            # rewrites theirs; nobody else's row is touched.
            pv, tav, tov = await db.load_feature_vectors(player_ids=night_ids)
            if not tav or not tov or team_games.is_empty():
                logger.error("Feature-store tables are empty - run --bootstrap first")
                return "store_not_bootstrapped"
            logger.info(
                f"Nightly {game_date}: stored vectors are current (through {vectors_as_of}); "
                f"scoring from them, recomputing {len(night_ids)} players from "
                f"{len(players)} history rows (incremental path)"
            )
            evals, night_players, vectors = await asyncio.to_thread(
                self._process_sync_incremental, pv, tav, tov, players, team_games, night
            )
            del pv, tav, tov
        else:
            logger.warning(
                f"Nightly {game_date}: stored vectors are through {vectors_as_of} but the "
                f"store holds games through {latest_fs}; rebuilding from the full history "
                f"(full path)"
            )
            log_memory(f"nightly {game_date}: loading feature-store history", logger)
            players, team_games = await db.get_fs_rows_before(game_date)
            log_memory(
                f"nightly {game_date}: loaded history "
                f"({len(players)} player rows, {len(team_games)} team rows)",
                logger,
            )
            if players.is_empty() or team_games.is_empty():
                logger.error("Feature-store tables are empty - run --bootstrap first")
                return "store_not_bootstrapped"

            evals, night_players, vectors = await asyncio.to_thread(
                self._process_sync, players, team_games, night
            )
        del players, team_games
        release_memory(f"nightly {game_date}: processed ({len(evals)} evals)", logger)

        eval_rows = [_eval_to_tuple(ev, game_date) for ev in evals]
        if not await db.insert_model_eval_rows(eval_rows):
            return "db_write_failed"

        log_memory(f"nightly {game_date}: writing raw rows", logger)
        if not await db.insert_fs_rows(
            _frame_to_tuples(night_players, _FS_PLAYER_COLS),
            _frame_to_tuples(night.team_games, _FS_TEAM_COLS),
        ):
            return "db_write_failed"

        # Post-night vectors (include the night just ingested). If this fails the
        # raw rows are already committed, so the run is left unmarked; the retry
        # hits the leakage-guard branch above and refreshes vectors from the DB.
        log_memory(f"nightly {game_date}: writing vectors", logger)
        if not await db.upsert_feature_vectors(*vectors):
            return "db_write_failed"
        self._invalidate_inference_store()

        await self._record_run(
            db, game_date, "processed", night.expected_games, len(eval_rows)
        )
        eligible = sum(1 for ev in evals if ev.eligible)
        logger.info(
            f"Model nightly {game_date}: {night.expected_games} games, "
            f"{len(eval_rows)} players evaluated ({eligible} eligible)"
        )
        del vectors, night_players, eval_rows, evals
        release_memory(f"nightly {game_date}: done", logger)
        # Surprises of the night need the raw rows and eval rows just written.
        # Runs after the night's memory is released; a failure here is logged,
        # not fatal: the night itself is processed, and
        # `python -m app.services.surprise_service --date` backfills it.
        if settings.surprise_nightly_enabled:
            logger.info(f"Nightly {game_date}: night stored; starting surprises (Boom or Bust)")
            try:
                from app.services.surprise_service import SurpriseService
                status = await SurpriseService(db=db).compute_and_store(game_date)
                if status == "processed":
                    logger.info(f"Nightly {game_date}: surprises finished ({status})")
                else:
                    logger.error(
                        f"Nightly {game_date}: surprises did not finish ({status}); the night has no Boom or Bust "
                        f"rows yet. The catch-up retries it this slot and the next ones while it is in the window; "
                        f"by hand: python -m app.services.surprise_service --date {game_date}"
                    )
            except Exception as e:
                logger.error(
                    f"Surprises {game_date} failed: {type(e).__name__}: {e}; the catch-up retries it",
                    exc_info=True,
                )
            release_memory(f"nightly {game_date}: surprises done", logger)
        else:
            logger.warning(f"Nightly {game_date}: surprises skipped (SURPRISE_NIGHTLY_ENABLED=false)")
        return "processed"

    async def _refresh_vectors_through(self, game_date: date) -> Optional[bool]:
        """Rebuild and upsert vectors from all rows up to and including game_date.

        Tri-state so callers can tell the two non-success cases apart:
        ``True`` written, ``False`` the write failed, ``None`` there was nothing to
        write (no raw rows — the store is not bootstrapped).
        """
        players, team_games = await self._db.get_fs_rows_before(game_date + timedelta(days=1))
        if players.is_empty() or team_games.is_empty():
            return None
        vectors = await asyncio.to_thread(self._vectors_from_frames, players, team_games)
        return await self._db.upsert_feature_vectors(*vectors)

    # --- missing features (heal the store after a deploy) --------------------

    @staticmethod
    def _required_stored_features() -> set[str]:
        """Feature names the deployed models expect to read from the store.

        The union over ``training/feature_sets/*.json``, minus the ones
        ``LiveInference._assemble_row`` derives per request (game context and the
        minutes-dependent ``T_MIN`` / ``T_x_*`` block), which are never stored.
        """
        required: set[str] = set()
        for path in sorted(tconfig.FEATURE_SETS_DIR.glob("*.json")):
            try:
                required.update(json.loads(path.read_text()).get("features", []))
            except (OSError, ValueError) as e:
                logger.warning(f"Could not read feature set {path.name}: {e}")
        return {
            f for f in required
            if f not in REQUEST_TIME_FEATURES and not f.startswith(REQUEST_TIME_PREFIX)
        }

    async def _ensure_vectors_current(self) -> Optional[str]:
        """Rebuild every vector when the models need a feature the store lacks.

        A feature-set change (a new column) otherwise leaves the models reading
        NaN for it — ``LiveInference`` reindexes missing columns rather than
        raising, so it degrades silently. The per-night rebuild would normally fix
        this on its own, but only on nights that have games: off-nights and the
        whole off-season return early, so a deploy could sit un-healed for months.

        Runs before the catch-up loop and costs one query per vector table when
        nothing changed. Whether it *fixes* the gap or only reports it is
        MODEL_FEATURE_HEAL_AUTO; when it does fix it, it is self-limiting — once
        rewritten the keys match and this is a no-op.
        """
        stored = await self._db.get_feature_vector_keys()
        if stored is None:
            return None  # not bootstrapped yet, or DB unavailable — nothing to heal
        missing = self._required_stored_features() - stored
        if not missing:
            return None

        preview = ", ".join(sorted(missing)[:5]) + (", ..." if len(missing) > 5 else "")

        # Detection is cheap; the rebuild is not (~380 MB), which is more than a
        # small container can spare mid-flight — it gets OOM-killed before the
        # upsert lands, so the gap survives and every later run tries again.
        # Off by default: say exactly what to run and leave the store alone.
        if not settings.model_feature_heal_auto:
            logger.warning(
                f"Feature vectors are missing {len(missing)} feature(s) the models need "
                f"({preview}). Auto-heal is off (MODEL_FEATURE_HEAL_AUTO), so the models "
                f"will read them as NaN until the vectors are rebuilt. Run: "
                f"cd backend && python scripts/refresh_feature_vectors.py "
                f"--database-url <url> --expect-feature {sorted(missing)[0]}"
            )
            return "manual_refresh_required"

        logger.warning(
            f"Feature vectors are missing {len(missing)} feature(s) the models need "
            f"({preview}) — rebuilding all vectors"
        )
        written = await self._refresh_vectors_through(datetime.now(ISRAEL_TZ).date())
        if written is None:
            logger.warning("Vector rebuild skipped: no raw rows to rebuild from")
            return "vectors_refresh_skipped"
        if not written:
            logger.error("Vector rebuild failed; vectors left unchanged")
            return "vectors_refresh_failed"
        self._invalidate_inference_store()

        # Escalate instead of looping: if a feature is still absent the deployed
        # code cannot produce it (a stale feature set, a renamed column), and every
        # later run would rebuild again for nothing.
        still_missing = self._required_stored_features() - (
            await self._db.get_feature_vector_keys() or set()
        )
        if still_missing:
            logger.error(
                f"After rebuilding, {len(still_missing)} feature(s) are still absent "
                f"({', '.join(sorted(still_missing)[:5])}) — the deployed code does not "
                "produce them; the feature sets and the feature engine disagree"
            )
            return "vectors_refresh_incomplete"
        logger.info(f"Feature vectors rebuilt with {len(missing)} new feature(s)")
        return "vectors_refreshed"

    @staticmethod
    def _process_sync(
        players: pl.DataFrame, team_games: pl.DataFrame, night: nightly.NightFetch
    ) -> tuple[list[EvalRow], pl.DataFrame, tuple[list, list, list]]:
        """Heavy feature/model work in a thread: build the pre-night store, score
        the night (leakage-safe), then fold the night in to materialize post-night
        vectors."""
        players = players.sort(["PLAYER_ID", "GAME_DATE"], maintain_order=True)
        log_memory("nightly: building feature store", logger)
        store = FeatureStore.build(
            players,
            featurize.build_team_allowed(team_games),
            featurize.build_team_own(team_games),
        )
        log_memory("nightly: built feature store; evaluating night", logger)
        inference = LiveInference(store)
        evals = nightly.evaluate_night(store, inference, night)
        log_memory("nightly: evaluated; folding night into store", logger)
        night_players = nightly.attach_positions(store, night.player_games)
        # Fold last night in so the stored vectors are current for tonight's games.
        # Sub-MIN_MINUTES rows are still persisted (storage keeps every played
        # minute) but are DNPs to the feature math — same gate as
        # get_fs_rows_before, so the fold-in matches tomorrow's full rebuild.
        qualifying = night_players.filter(pl.col("MIN") >= rconfig.MIN_MINUTES)
        store.update_with_nightly_results(qualifying, night.team_games)
        return evals, night_players, _serialize_vectors(store)

    @staticmethod
    def _process_sync_incremental(
        pv: list[dict], tav: list[dict], tov: list[dict],
        players: pl.DataFrame, team_games: pl.DataFrame, night: nightly.NightFetch,
    ) -> tuple[list[EvalRow], pl.DataFrame, tuple[list, list, list]]:
        """Same as ``_process_sync`` with the pre-night store loaded from the
        stored vectors (tonight's players only) instead of rebuilt: predictions
        read the stored vectors;
        the fold-in recomputes tonight's players from their own full history
        (``players``) and every team from the team rows, exactly what a full
        rebuild computes for them (``build_current_state`` is per player).
        Only tonight's players' vectors are returned for the upsert."""
        log_memory("nightly: loading pre-night store from stored vectors", logger)
        store = FeatureStore.from_vectors(
            _player_vectors_df(pv) if pv else pl.DataFrame(schema=_EMPTY_PLAYER_VECTORS),
            _team_vectors_df(tav), _team_vectors_df(tov),
        )
        # The raw rows the fold-in needs: tonight's players' history, all teams.
        store.players = players.sort(["PLAYER_ID", "GAME_DATE"], maintain_order=True)
        store.team_allowed = featurize.build_team_allowed(team_games)
        store.team_own = featurize.build_team_own(team_games)
        inference = LiveInference(store)
        evals = nightly.evaluate_night(store, inference, night)
        log_memory("nightly: evaluated; folding night into store", logger)
        night_players = nightly.attach_positions(store, night.player_games)
        qualifying = night_players.filter(pl.col("MIN") >= rconfig.MIN_MINUTES)
        store.update_with_nightly_results(qualifying, night.team_games)
        changed = [int(p) for p in qualifying["PLAYER_ID"].unique(maintain_order=True)]
        return evals, night_players, _serialize_vectors(store, player_ids=changed)


    # --- serving: resident in-memory store (for a future inference tab) -------

    async def get_inference_store(self, refresh: bool = False) -> Optional[FeatureStore]:
        """Return the resident inference store, loading it from the vectors tables
        only on first use (or when ``refresh=True``). Held in memory so every
        prediction during the day is served from RAM without a DB round-trip.
        Returns None if the vectors have not been materialized yet.
        """
        if self._inference_store is not None and not refresh:
            return self._inference_store
        async with self._store_lock:
            if self._inference_store is not None and not refresh:
                return self._inference_store
            self._inference_store = await self._load_inference_store()
            return self._inference_store

    async def _prewarm_inference_store(self) -> None:
        """Reload the store right after the nightly invalidates it, so the first
        user request of the day doesn't pay the cold-load cost. Runs in the same
        background flow as the scheduler (already off the request path); a
        failure here leaves ``_inference_store`` at None (get_inference_store's
        lock guarantees no half-loaded store is ever observed), same as if
        prewarming didn't exist — the next request just lazy-loads it.
        """
        try:
            await self.get_inference_store(refresh=True)
        except Exception as e:
            logger.warning(
                f"Inference store prewarm failed, will lazy-load on next request: "
                f"{type(e).__name__}: {e}"
            )

    async def _load_inference_store(self) -> Optional[FeatureStore]:
        pv, tav, tov = await self._db.load_feature_vectors()
        if not pv:
            return None
        # Ungated last-5-appearances minutes (slider default): the feature
        # vectors treat sub-MIN_MINUTES games as DNPs, but the default t must
        # show real recent playing time, so it comes from the raw rows.
        last5_min = await self._db.get_last5_minutes()
        def _build() -> FeatureStore:
            pdf = _player_vectors_df(pv)
            pdf = pdf.with_columns(pl.Series(
                "MIN_LAST5_ALL",
                [float(last5_min[p]) if p in last5_min else float("nan") for p in pdf["PLAYER_ID"].to_list()],
                dtype=pl.Float64,
            ))
            return FeatureStore.from_vectors(pdf, _team_vectors_df(tav), _team_vectors_df(tov))
        return await asyncio.to_thread(_build)

    @staticmethod
    async def _record_run(db, game_date, status: str, num_games: int, num_rows: int) -> bool:
        """Write the night's ledger row; the surprises page reports the newest one,
        so its in-memory copy is dropped."""
        from app.services.surprise_service import clear_surprise_read_cache

        try:
            return await db.upsert_model_nightly_run(game_date, status, num_games, num_rows)
        finally:
            clear_surprise_read_cache()
            _clear_night_read_caches()

    def _invalidate_inference_store(self) -> None:
        """Drop the resident store so the next prediction reloads the fresh vectors.

        Correct when the scheduler and the serving path share this process (the
        default — the scheduler runs in the FastAPI lifespan). A separate serving
        process should instead call get_inference_store(refresh=True) after the
        morning window, since it can't observe this in-process invalidation.
        """
        self._inference_store = None
        # Deferred import: app.routes.matchups pulls in this module transitively
        # (via live_projection_service), so a top-level import here would cycle.
        from app.routes.matchups import clear_matchup_response_cache
        clear_matchup_response_cache()

    # --- one-time init -------------------------------------------------------

    async def bootstrap(self, force: bool = False, until_date: Optional[date] = None) -> str:
        """Seed fs_player_games / fs_team_games from ESPN for research SEASONS,
        then materialize the initial vectors so inference is ready immediately."""
        async with self._lock:
            p_count, t_count = await self._db.fs_counts()
            if p_count or t_count:
                if not force:
                    logger.info(f"Store already bootstrapped ({p_count} player rows); use --force")
                    return "already_bootstrapped"
                # A forced re-bootstrap must replace, not append: inserts are
                # ON CONFLICT DO NOTHING, so leftover rows (e.g. stale players,
                # dropped seasons) would otherwise survive forever.
                if not await self._db.truncate_fs_tables():
                    return "db_write_failed"

            players, team_games = await asyncio.to_thread(
                nightly.bootstrap_frames, until_date
            )
            logger.info(
                f"Bootstrap fetched {len(players)} player rows / {len(team_games)} team rows "
                f"for {', '.join(rconfig.SEASONS)}"
                + (f" (until {until_date})" if until_date else "")
            )
            logger.info("Bootstrap: writing raw game rows...")
            # Tables are empty here (either freshly created or just truncated), so
            # COPY is safe and turns a multi-minute per-row insert into seconds.
            if not await self._db.insert_fs_rows(
                _frame_to_tuples(players, _FS_PLAYER_COLS),
                _frame_to_tuples(team_games, _FS_TEAM_COLS),
                use_copy=True,
            ):
                return "db_write_failed"

            logger.info("Bootstrap: building feature vectors (this is the slow step)...")
            vectors = await asyncio.to_thread(self._vectors_from_frames, players, team_games)
            logger.info(
                f"Bootstrap: writing {len(vectors[0])} player / {len(vectors[1])} team vectors..."
            )
            if not await self._db.upsert_feature_vectors(*vectors):
                return "db_write_failed"
            self._invalidate_inference_store()
            return "bootstrapped"

    @staticmethod
    def _vectors_from_frames(players: pl.DataFrame, team_games: pl.DataFrame) -> tuple[list, list, list]:
        store = FeatureStore.build(
            players, featurize.build_team_allowed(team_games), featurize.build_team_own(team_games)
        )
        return _serialize_vectors(store)

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Run the nightly model pipeline manually")
    parser.add_argument("--date", help="YYYY-MM-DD; default: yesterday (Asia/Jerusalem)")
    parser.add_argument("--force", action="store_true", help="ignore the runs ledger / bootstrap guard")
    parser.add_argument("--bootstrap", action="store_true", help="seed the feature-store tables")
    parser.add_argument("--until-date", help="bootstrap only rows before this date (YYYY-MM-DD)")
    args = parser.parse_args()

    async def _main() -> str:
        service = ModelNightlyService()
        try:
            if args.bootstrap:
                until = date.fromisoformat(args.until_date) if args.until_date else None
                return await service.bootstrap(force=args.force, until_date=until)
            d = (
                date.fromisoformat(args.date)
                if args.date
                else (datetime.now(ISRAEL_TZ) - timedelta(days=1)).date()
            )
            return await service.run_for_date(d, force=args.force)
        finally:
            await DBService().close()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    print(asyncio.run(_main()))
