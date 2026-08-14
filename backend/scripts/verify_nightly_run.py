"""Verify one nightly run against reality, and print a pass/fail report.

The nightly job's unit tests use fakes, so they prove the orchestration and
nothing about real data. This script inspects what a real run actually wrote:
did it cover the whole slate, are the predictions in the accuracy band the models
were trained to, and are the feature vectors current afterwards.

The accuracy check is the point. A pipeline with a broken opponent map or a
NaN-filled feature vector still "succeeds" — it just predicts badly. Comparing
per-stat MAE against the training MAE in ``models/model_card.json`` is what
separates "ESPN changed and we're silently ingesting garbage" from "one noisy
night". A single night has ~200 eligible rows and a broader population than the
training corpus (MIN_INFERENCE_GAMES=10 vs MIN_PLAYER_GAMES=20), so the band is
deliberately loose — it catches collapse, not drift.

Usage (from backend/):
    python scripts/verify_nightly_run.py --date 2026-03-05
    DATABASE_URL=... python scripts/verify_nightly_run.py --date 2026-03-05 --espn
    python scripts/verify_nightly_run.py --date 2026-03-05 --mae-tolerance 2.0

Exits non-zero if any check fails. Read-only — it never writes to the database.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

EVAL_STATS = ["PTS", "REB", "AST", "FG3M", "STL", "BLK", "FGM", "FGA", "FTM", "FTA"]

# Ineligible reasons come from serving/errors.py. "N game(s) of history" is the
# expected one (rookies, early season). An unknown *team* is never expected — it
# means the ESPN team-id space no longer matches the feature store. An unknown
# *player* is normal in small numbers (call-ups) and alarming in bulk.
BENIGN_REASON = "history"
TEAM_REASON = "opponent team"
UNKNOWN_PLAYER_SHARE_LIMIT = 0.15

VECTOR_STALENESS_DAYS = 2


class Report:
    def __init__(self) -> None:
        self.rows: list[tuple[bool | None, str, str]] = []

    def check(self, ok: bool, name: str, detail: str = "") -> bool:
        self.rows.append((ok, name, detail))
        return ok

    def info(self, name: str, detail: str) -> None:
        self.rows.append((None, name, detail))

    def print(self) -> bool:
        print()
        for ok, name, detail in self.rows:
            tag = "INFO" if ok is None else ("PASS" if ok else "FAIL")
            print(f"  [{tag}] {name:<38} {detail}")
        failed = [r for r in self.rows if r[0] is False]
        print()
        if failed:
            print(f"{len(failed)} check(s) FAILED:")
            for _, name, detail in failed:
                print(f"  - {name}: {detail}")
        else:
            print("All checks passed.")
        return not failed


def load_mae_baselines() -> dict[str, float]:
    card = Path(__file__).resolve().parents[1] / "model_stats_inference" / "models" / "model_card.json"
    data = json.loads(card.read_text())
    return {k: v["mae_mean"] for k, v in data.items() if isinstance(v, dict) and "mae_mean" in v}


def espn_countable_games(game_date: date) -> tuple[int, bool]:
    from model_stats_inference.espn import client, games
    sb = client.scoreboard(game_date.strftime("%Y%m%d"))
    events = [e for e in sb.get("events", []) if games.is_countable(e)]
    return len(events), all(games.is_final(e) for e in events)


async def check_ledger(conn, d: date, rep: Report) -> dict | None:
    row = await conn.fetchrow("SELECT * FROM model_nightly_runs WHERE game_date = $1", d)
    if not rep.check(row is not None, "ledger row exists", "" if row else "no model_nightly_runs row - the job never ran for this date"):
        return None
    row = dict(row)
    rep.check(
        row["status"] in ("processed", "no_games"),
        "ledger status",
        f"status={row['status']} games={row['num_games']} rows={row['num_rows']}",
    )
    return row


async def check_coverage(conn, d: date, ledger: dict, rep: Report, use_espn: bool) -> None:
    eval_games = await conn.fetchval(
        "SELECT COUNT(DISTINCT game_id) FROM model_eval_results WHERE game_date = $1", d)
    store_games = await conn.fetchval(
        "SELECT COUNT(DISTINCT game_id) FROM fs_player_games WHERE game_date = $1", d)
    team_rows = await conn.fetchval(
        "SELECT COUNT(*) FROM fs_team_games WHERE game_date = $1", d)
    player_rows = await conn.fetchval(
        "SELECT COUNT(*) FROM fs_player_games WHERE game_date = $1", d)

    rep.check(eval_games == ledger["num_games"], "eval games == ledger games",
              f"eval={eval_games} ledger={ledger['num_games']}")
    rep.check(store_games == eval_games, "store games == eval games",
              f"store={store_games} eval={eval_games}")
    rep.check(team_rows == 2 * store_games, "team rows == 2x games",
              f"team_rows={team_rows} games={store_games}")
    if store_games:
        per_game = player_rows / store_games
        rep.check(14 <= per_game <= 32, "player rows per game in range",
                  f"{per_game:.1f} rows/game ({player_rows} total)")

    if use_espn:
        espn_games, all_final = espn_countable_games(d)
        rep.check(espn_games == store_games, "ESPN slate fully ingested",
                  f"espn={espn_games} store={store_games}")
        rep.check(all_final, "ESPN games all final", "")


async def check_eligibility(conn, d: date, rep: Report) -> int:
    total = await conn.fetchval(
        "SELECT COUNT(*) FROM model_eval_results WHERE game_date = $1", d)
    eligible = await conn.fetchval(
        "SELECT COUNT(*) FROM model_eval_results WHERE game_date = $1 AND eligible", d)
    if not rep.check(total > 0, "eval rows written", f"{total} rows"):
        return 0

    share = eligible / total
    rep.check(share >= 0.4, "eligible share >= 40%", f"{eligible}/{total} = {share:.0%}")

    reasons = await conn.fetch(
        "SELECT reason, COUNT(*) AS n FROM model_eval_results "
        "WHERE game_date = $1 AND NOT eligible GROUP BY reason ORDER BY n DESC", d)
    if not reasons:
        rep.info("ineligible reasons", "none")
    unknown_players = 0
    for r in reasons:
        reason = (r["reason"] or "").lower()
        if BENIGN_REASON in reason:
            rep.info("ineligible: insufficient history", f"{r['n']} rows")
        elif TEAM_REASON in reason:
            rep.check(False, "ineligible: unknown opponent team",
                      f"{r['n']} rows - team-id space broken: {r['reason'][:60]}")
        else:
            unknown_players += r["n"]
    if unknown_players:
        share = unknown_players / total
        rep.check(share <= UNKNOWN_PLAYER_SHARE_LIMIT, "unknown players within tolerance",
                  f"{unknown_players}/{total} = {share:.0%} never seen in the store")

    nulls = await conn.fetchval(
        "SELECT COUNT(*) FROM model_eval_results WHERE game_date = $1 AND eligible AND pred_pts IS NULL", d)
    rep.check(nulls == 0, "no NULL predictions on eligible rows", f"{nulls} null")
    return eligible


async def check_accuracy(conn, d: date, rep: Report, tolerance: float) -> None:
    baselines = load_mae_baselines()
    selects = ", ".join(
        f"AVG(ABS(pred_{s.lower()} - actual_{s.lower()})) AS mae_{s.lower()}, "
        f"STDDEV_POP(pred_{s.lower()}) AS sd_{s.lower()}"
        for s in EVAL_STATS
    )
    row = await conn.fetchrow(
        f"SELECT {selects} FROM model_eval_results WHERE game_date = $1 AND eligible", d)

    for stat in EVAL_STATS:
        mae = row[f"mae_{stat.lower()}"]
        sd = row[f"sd_{stat.lower()}"]
        base = baselines.get(stat)
        if mae is None or base is None:
            rep.check(False, f"MAE {stat}", "no data / no training baseline")
            continue
        limit = base * tolerance
        rep.check(mae <= limit, f"MAE {stat} <= {limit:.2f}",
                  f"{mae:.2f} (training {base:.2f}, x{mae / base:.2f})")
        rep.check(sd is not None and sd > 0.01, f"{stat} predictions vary",
                  f"sd={sd:.3f}" if sd is not None else "sd=None — all predictions identical")


async def check_vectors(conn, d: date, rep: Report) -> None:
    row = await conn.fetchrow(
        "SELECT COUNT(*) AS n, MAX(updated_at) AS updated, MAX(last_game_date) AS last, "
        "COUNT(*) FILTER (WHERE eligible) AS eligible FROM fs_player_vectors")
    rep.check(row["n"] > 300, "player vectors present", f"{row['n']} rows, {row['eligible']} eligible")
    if row["last"] is not None:
        rep.check(row["last"] >= d, "vectors include the verified night",
                  f"max last_game_date={row['last']}")
    if row["updated"] is not None:
        age = datetime.now(timezone.utc) - row["updated"]
        rep.check(age <= timedelta(days=VECTOR_STALENESS_DAYS), "vectors refreshed recently",
                  f"updated_at={row['updated']:%Y-%m-%d %H:%M} ({age.days}d old)")

    played = await conn.fetch(
        "SELECT DISTINCT player_id FROM fs_player_games WHERE game_date = $1 LIMIT 50", d)
    missing = 0
    null_features = 0
    for r in played:
        v = await conn.fetchrow(
            "SELECT last_game_date, features FROM fs_player_vectors WHERE player_id = $1", r["player_id"])
        if v is None:
            missing += 1
            continue
        feats = json.loads(v["features"]) if isinstance(v["features"], str) else v["features"]
        if not feats or all(x is None for x in feats.values()):
            null_features += 1
    rep.check(missing == 0, "everyone who played has a vector", f"{missing} missing of {len(played)} sampled")
    rep.check(null_features == 0, "sampled vectors are not all-NaN", f"{null_features} empty of {len(played)} sampled")

    for table in ("fs_team_allowed_vectors", "fs_team_own_vectors"):
        n = await conn.fetchval(f"SELECT COUNT(*) FROM {table}")
        rep.check(n == 30, f"{table} has 30 teams", f"{n} rows")


async def _main(args: argparse.Namespace) -> int:
    from app.services.db_service import DBService

    d = date.fromisoformat(args.date)
    db = DBService()
    pool = await db._get_pool()
    if pool is None:
        print("ERROR: cannot connect - check --database-url / DATABASE_URL", file=sys.stderr)
        return 1

    rep = Report()
    print(f"Verifying nightly run for {d} (MAE tolerance x{args.mae_tolerance})")
    # Every early exit stays inside the acquire block; closing the pool while a
    # connection is still checked out makes Pool.close() hang until it times out.
    async with pool.acquire() as conn:
        ledger = await check_ledger(conn, d, rep)
        if ledger is not None and ledger["status"] == "no_games":
            rep.info("no games", "off-night - nothing further to verify")
        elif ledger is not None:
            await check_coverage(conn, d, ledger, rep, args.espn)
            eligible = await check_eligibility(conn, d, rep)
            if eligible:
                await check_accuracy(conn, d, rep, args.mae_tolerance)
            await check_vectors(conn, d, rep)

    await db.close()
    return 0 if rep.print() else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Verify one nightly run against reality, and print a pass/fail report.")
    parser.add_argument("--date", required=True, help="game date to verify (YYYY-MM-DD)")
    parser.add_argument("--database-url", help="Postgres URL; falls back to DATABASE_URL env")
    parser.add_argument("--espn", action="store_true",
                        help="also fetch the real scoreboard and confirm no game was missed")
    parser.add_argument("--mae-tolerance", type=float, default=1.6,
                        help="multiple of training MAE allowed for a single night (default 1.6)")
    args = parser.parse_args()

    if args.database_url:
        os.environ["DATABASE_URL"] = args.database_url
    if not os.environ.get("DATABASE_URL"):
        parser.error("no database given — pass --database-url or set DATABASE_URL")

    raise SystemExit(asyncio.run(_main(args)))
