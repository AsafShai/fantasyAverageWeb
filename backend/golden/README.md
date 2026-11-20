# Golden-master harness

Runs the whole backend on fixed, recorded inputs so two versions of the code
(e.g. pandas before / Polars after) can be compared output for output.

* `tape.py` — record/replay of every outgoing HTTP request (httpx transports).
  Key: method + URL (sorted query) + body + ESPN's `X-Fantasy-Filter` header.
* `pg.py` — a throwaway local PostgreSQL 16 (initdb in a temp dir), with the
  repo's migrations plus `schema_base.sql` (the three snapshot tables that
  predate `migrations/`). Autovacuum, parallel query and synchronized scans are
  off so un-ordered `SELECT`s return rows in the same order every run.
* `run.py` — one run: time frozen at `T0` (2026-11-20 12:00 UTC), the
  background jobs in production order (catalog, injuries, model bootstrap over
  five seasons + nightly catch-up with surprises, roster stints, standings sync
  on top of a deterministic synthetic snapshot history, estimator with a pinned
  RNG seed, league activity, ADP), then every endpoint the frontend calls
  (≈200 requests, each twice: first hit and cached hit), the model path
  (feature vectors and predictions for every stored player, floats as hex) and
  a dump of every table.
* `compare.py` — diffs two runs. Exact for strings/ids/order; a float may
  differ by ≤ 1e-9 relative and is then listed; `elapsed_ms` / `computed_at`
  (wall clock, Postgres `NOW()`) are ignored — two runs of the same code
  differ there.
* `record_games.py` — pre-records the five seasons of box scores the model
  bootstrap pulls (≈5,150 game summaries).

```bash
cd backend
# once, with network (record mode answers from the tape where it can):
PYTHONPATH=. uv run python -m golden.record_games
PYTHONPATH=. uv run --with time-machine python -m golden.run --mode record --out /tmp/rec
# replay (no network needed):
PYTHONPATH=. uv run --with time-machine python -m golden.run --out golden/_data/before
PYTHONPATH=. uv run --with time-machine python -m golden.run --out golden/_data/after
PYTHONPATH=. uv run python -m golden.compare golden/_data/before golden/_data/after --report golden/results/golden_compare.md
```

The tape and run outputs live in `golden/_data/` (git-ignored: ~300 MB, and
the league payloads carry the league members' names). `tape_manifest.txt`
lists every recorded request with the SHA-256 of its stored response, so a
re-recorded tape can be checked against the one the committed results used.
