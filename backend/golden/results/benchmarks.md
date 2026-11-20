# pandas → Polars: benchmarks, golden comparison, tests, verdict

Before = base commit `ba47642` (pandas 3.0.2 + pyarrow). After = branch `polars-migration` (Polars 2.1.0, NumPy).
Each side ran in its own production-only venv (its Dockerfile's `uv sync` groups), with
`OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 POLARS_MAX_THREADS=1 MALLOC_ARENA_MAX=2` (+ `ARROW_DEFAULT_MEMORY_POOL=system`
on the pandas side, its production setting). Same inputs for both: one DB snapshot (`golden/bench.py seed`), the
recorded HTTP tape, the clock starting at 2026-11-20 12:00 UTC, the estimator RNG pinned. Before/after runs
interleaved ABBA. CPU = utime+stime of the server/job process. Medians over repetitions; p50/p95 over all cached hits.

## Verdict

**Every job- and process-level number is better or equal, outputs are identical, all tests pass.**
Two things short of "better everywhere":

1. **Single-endpoint first-hit medians.** A handful of endpoints are slower on their *first* hit after
   start (list at the end). Profiled: the extra time is one full (gen-2) garbage collection that lands in that
   request on the Polars side. The Polars process holds *fewer* Python objects (274k vs 298k after the 201-endpoint
   sequence) and spends **less than half** the GC time over the whole sequence (≈0.56 s, 5 full collections vs
   ≈1.26 s, 11); the collections land on different requests. In-process with GC accounted for, those endpoints
   are equal or faster (e.g. `/api/teams/8` 76 vs 112 ms, `/api/players/?…season` 154 vs 166 ms). Sum of first-hit
   latency over all 201 variants: −30%; server CPU for the run: −37%.
2. **The soak is short**: one 3-minute run per side (owner's time budget). Steady-state RSS 223 vs 253 MB, flat on
   both, 20% more requests served for the same CPU. It cannot rule out drift over a full day.

Recommendation: mergeable. If the owner reads rule 1 literally (every single-endpoint first-hit median), do not
merge. After deploying, compare Render's memory graph over a day with today's ~340 → 480 MB.

## Golden comparison

432 files, 5,277,662 values (201 endpoint variants × first/cached hit, 24 DB tables, job results, every
stored feature vector and prediction as exact hex, outgoing request log): **0 differences, 0 tolerated float
differences** (`golden_compare.md`). Rankings identical; feature vectors and predictions bit-identical.

Found while checking reproducibility (pre-existing, both builds): the physical write order of a night's
rows varies from run to run (ESPN game summaries are fetched concurrently and written in completion order).
Endpoints that order only by score — `/api/surprises/latest`, `/api/surprises/{date}` (`ORDER BY score DESC`),
`/api/feature-store/players` (sorted by games played) — then break exact ties differently between runs.
Measured: pandas 3 distinct orders in 4 runs, Polars 2 in 6. A tiebreaker (`ORDER BY score DESC, player_id`)
would fix it; left out of this change because it changes output.

## Tests

- Backend `pytest`: 1618 passed (14 deselected `live`).
- Frontend `npm ci && npm test`: 970 passed, 3 skipped (131 files).
- Playwright `npm run test:e2e`: 305 passed, 123 skipped (per-viewport `test.skip`s in the specs), 0 failed.
  Run with the preinstalled Chromium via a temporary config (the pinned Playwright's browser isn't installed here).
- Added: kernel bit-parity tests (incl. multi-column `last_only`), featurize/surprise parity vs pandas, pdcompat,
  subprocess guard (production process never imports pandas/pyarrow), feature-store concurrent-read regression.

## Fixed along the way

- Nightly CPU regression (53 s vs 44 s) in the first cut: the window kernels ran per column; now one pass per
  halflife over all columns, last row only — same arithmetic, still bit-identical.
- Pre-existing race in `FeatureStore` (both builds): concurrent first reads could see features built but meta
  not yet (`TypeError` in `get_player_state`); hit by `bench_background_jobs.py`. Views are now one atomic
  attribute built under a lock.

## Not covered

- A long soak (only 3 min × 1 run per side). No 0.15-CPU / 512 MB cgroup or Docker run (not available here):
  CPU is measured as process CPU time, which the CPU cap scales, not changes.
- Live ESPN/NBA traffic (everything ran from the recorded tape), and the in-production schedulers'
  timing (schedulers disabled; their jobs were run directly).

## Background jobs (fresh process each; median of reps)

| metric | pandas (before) | Polars (after) | Δ | |
|---|---:|---:|---:|:-:|
| bootstrap: CPU s (n=3/3) | 49.5 | 37.0 | -25.2% | ✅ |
| bootstrap: wall s (n=3/3) | 50.4 | 37.8 | -25.0% | ✅ |
| bootstrap: peak RSS MB (n=3/3) | 376.6 | 364.8 | -3.1% | ✅ |
| bootstrap: RSS after MB (n=3/3) | 264.7 | 221.4 | -16.4% | ✅ |
| bootstrap: RSS after imports MB | 125.7 | 87.1 | -30.7% | ✅ |
| nightly: CPU s (n=5/5) | 42.5 | 11.4 | -73.2% | ✅ |
| nightly: wall s (n=5/5) | 43.6 | 12.2 | -72.1% | ✅ |
| nightly: peak RSS MB (n=5/5) | 246.2 | 224.4 | -8.9% | ✅ |
| nightly: RSS after MB (n=5/5) | 212.0 | 188.9 | -10.9% | ✅ |
| nightly: RSS after imports MB | 125.7 | 87.0 | -30.8% | ✅ |
| bench_background_jobs (48 cycles): CPU s (n=4/4) | 25.2 | 23.8 | -5.7% | ✅ |
| bench_background_jobs (48 cycles): wall s (n=4/4) | 20.6 | 19.7 | -4.6% | ✅ |
| bench_background_jobs (48 cycles): start RSS MB (n=4/4) | 165.6 | 124.7 | -24.7% | ✅ |
| bench_background_jobs (48 cycles): max RSS MB (n=4/4) | 237.8 | 195.9 | -17.6% | ✅ |
| bench_background_jobs (48 cycles): end RSS MB (n=4/4) | 237.2 | 195.9 | -17.4% | ✅ |

## bench_soak (3 min, 6 clients, cache-missing traffic; 1 run per side, after the merge of dev)

| metric | pandas (before) | Polars (after) | Δ | |
|---|---:|---:|---:|:-:|
| requests served | 15742 | 18931 | +20.3% | ✅ |
| errors | 0 | 0 | | ✅ |
| RSS at load start MB | 194.5 | 148.7 | -23.5% | ✅ |
| steady-state RSS (end) MB | 252.5 | 222.9 | -11.7% | ✅ |
| max RSS MB | 255.2 | 223.1 | -12.6% | ✅ |
| server CPU s (whole run; CPU-bound) | 180.9 | 180.6 | -0.2% | ✅ |
| server CPU ms per request | 11.49 | 9.54 | -17.0% | ✅ |

RSS every 15 s — pandas: 194.5, 255.2, 255.2, 255.2, 255.2, 250.6, 250.6, 250.6, 250.5, 252.5, 252.5, 252.5, 252.5;
Polars: 148.7, 220.7, 220.6, 220.6, 220.8, 223.1, 222.9, 222.8, 222.8, 222.8, 222.8, 222.6, 222.9. Both flat after
the first minute. One short run per side (owner's time budget): it shows no drift over 3 minutes, not over a day.

## API: the 20 production-traffic endpoints of scripts/bench_api.py (6 rounds per start) (n=5/5 server starts)

| metric | pandas (before) | Polars (after) | Δ | |
|---|---:|---:|---:|:-:|
| ready s | 1.6 | 1.4 | -11.2% | ✅ |
| startup RSS MB (after 20 s settle) | 193.8 | 157.9 | -18.5% | ✅ |
| startup CPU s | 1.5 | 1.3 | -11.9% | ✅ |
| RSS after all rounds MB | 245.5 | 221.1 | -9.9% | ✅ |
| server CPU s, whole run | 2.8 | 2.4 | -14.5% | ✅ |
| Σ first-hit ms | 1080.5 | 831.8 | -23.0% | ✅ |
| Σ first-hit server CPU ms | 1000.0 | 780.0 | -22.0% | ✅ |
| Σ cached-hit p50 ms | 66.8 | 63.8 | -4.4% | ✅ |

Per endpoint — first hit (median ms, median server CPU ms) and cached hits (p50 / p95 ms over all hits, mean CPU ms):

| endpoint | first ms before | first ms after | first CPU before | first CPU after | cached p50 b/a | cached p95 b/a | cached CPU b/a |
|---|---:|---:|---:|---:|---:|---:|---:|
| `/api/nba-teams/` | 3.1 | 3.6 | 0 | 0 | 1.4 / 1.2 | 1.7 / 1.9 | 0.8 / 0.8 |
| `/api/teams/` | 29.2 | 19.8 | 30 | 20 | 1.6 / 1.4 | 3.7 / 2.0 | 0.8 / 0.4 |
| `/api/rankings?order=asc` | 23.5 | 7.5 | 20 | 10 | 1.9 / 2.0 | 3.4 / 2.6 | 1.6 / 1.6 |
| `/api/league/summary` | 30.5 | 26.8 | 30 | 20 | 5.9 / 4.7 | 7.7 / 7.0 | 6.4 / 3.6 |
| `/api/players/?page=1&limit=1200&time_period=season` | 121.5 | 104.5 | 110 | 100 | 12.0 / 12.1 | 15.9 / 15.2 | 10.8 / 10.4 |
| `/api/estimator/results` | 14.1 | 9.0 | 10 | 0 | 2.0 / 2.0 | 3.2 / 2.7 | 1.2 / 1.6 |
| `/api/league/today` | 33.4 | 15.4 | 30 | 10 | 1.1 / 1.1 | 1.4 / 1.5 | 0.4 / 1.6 |
| `/api/league/activity/latest?limit=8` | 194.3 | 168.7 | 190 | 170 | 1.4 / 1.4 | 1.8 / 1.8 | 0.8 / 1.2 |
| `/api/matchups/current-slate-date` | 1.8 | 1.9 | 0 | 0 | 1.0 / 0.9 | 1.3 / 1.2 | 0.0 / 1.2 |
| `/api/matchups/upcoming-dates` | 10.3 | 9.1 | 10 | 10 | 0.9 / 0.9 | 1.2 / 1.2 | 1.6 / 0.4 |
| `/api/matchups/today` | 269.7 | 153.2 | 260 | 150 | 5.1 / 5.0 | 7.4 / 7.3 | 5.6 / 4.4 |
| `/api/teams/8?time_period=season` | 71.2 | 121.4 | 60 | 120 | 1.8 / 1.8 | 2.2 / 2.3 | 0.8 / 1.6 |
| `/api/teams/1?time_period=season` | 29.5 | 18.8 | 20 | 10 | 1.7 / 1.6 | 2.7 / 2.1 | 1.6 / 0.8 |
| `/api/analytics/heatmap` | 6.4 | 4.8 | 10 | 0 | 1.5 / 1.4 | 2.0 / 1.8 | 0.8 / 1.6 |
| `/api/nba/schedule` | 36.7 | 35.9 | 30 | 30 | 5.3 / 5.3 | 6.9 / 6.7 | 3.2 / 6.0 |
| `/api/league/activity` | 5.5 | 5.2 | 10 | 0 | 4.7 / 4.4 | 6.4 / 6.2 | 6.0 / 2.4 |
| `/api/injuries/` | 1.8 | 1.6 | 0 | 0 | 1.3 / 1.2 | 1.8 / 1.8 | 0.8 / 0.8 |
| `/api/league/shots` | 2.5 | 1.8 | 0 | 0 | 2.2 / 1.4 | 2.8 / 1.8 | 1.2 / 2.0 |
| `/api/players/?page=1&limit=1200&time_period=last_7` | 90.1 | 74.3 | 90 | 70 | 10.7 / 10.7 | 13.1 / 14.7 | 9.2 / 8.8 |
| `/api/trends/minutes?window_days=15` | 66.0 | 24.9 | 50 | 20 | 3.3 / 3.3 | 4.2 / 4.2 | 3.2 / 4.4 |

## API: all 201 golden endpoint variants (3 rounds per start) (n=3/3 server starts)

| metric | pandas (before) | Polars (after) | Δ | |
|---|---:|---:|---:|:-:|
| ready s | 1.8 | 1.4 | -21.0% | ✅ |
| startup RSS MB (after 20 s settle) | 193.7 | 157.8 | -18.5% | ✅ |
| startup CPU s | 1.5 | 1.4 | -9.8% | ✅ |
| RSS after all rounds MB | 294.9 | 282.7 | -4.1% | ✅ |
| server CPU s, whole run | 18.0 | 11.3 | -37.2% | ✅ |
| Σ first-hit ms | 11760.8 | 8220.2 | -30.1% | ✅ |
| Σ first-hit server CPU ms | 10140.0 | 6730.0 | -33.6% | ✅ |
| Σ cached-hit p50 ms | 3181.2 | 1797.7 | -43.5% | ✅ |

Per endpoint — first hit (median ms, median server CPU ms) and cached hits (p50 / p95 ms over all hits, mean CPU ms):

| endpoint | first ms before | first ms after | first CPU before | first CPU after | cached p50 b/a | cached p95 b/a | cached CPU b/a |
|---|---:|---:|---:|---:|---:|---:|---:|
| `/health` | 3.6 | 4.0 | 10 | 0 | 1.5 / 1.5 | 1.7 / 2.0 | 1.7 / 0.0 |
| `/api/rankings?order=asc` | 47.9 | 26.0 | 40 | 30 | 1.9 / 1.9 | 2.2 / 3.2 | 1.7 / 3.3 |
| `/api/rankings?order=desc` | 14.2 | 5.2 | 20 | 0 | 2.0 / 1.7 | 2.6 / 2.8 | 1.7 / 1.7 |
| `/api/rankings?sort_by=PTS&order=desc` | 14.0 | 4.4 | 10 | 10 | 1.9 / 1.7 | 2.3 / 2.6 | 1.7 / 1.7 |
| `/api/rankings?sort_by=FG%25&order=asc` | 14.2 | 4.3 | 10 | 0 | 2.0 / 1.9 | 2.2 / 2.7 | 1.7 / 3.3 |
| `/api/rankings?order=asc&start_date=2026-11-13&end_date=2026-11-19` | 37.3 | 14.5 | 30 | 10 | 35.5 / 8.9 | 43.6 / 16.0 | 31.7 / 8.3 |
| `/api/rankings?order=asc&start_date=2026-11-01&end_date=2026-11-20&settled=true` | 29.8 | 8.0 | 30 | 0 | 29.9 / 7.8 | 46.9 / 11.5 | 33.3 / 6.7 |
| `/api/league/summary` | 28.0 | 28.5 | 30 | 20 | 6.4 / 3.8 | 9.1 / 5.8 | 6.7 / 1.7 |
| `/api/league/shots` | 3.3 | 1.9 | 0 | 0 | 2.3 / 1.4 | 2.7 / 2.0 | 3.3 / 3.3 |
| `/api/league/today` | 92.2 | 73.6 | 90 | 80 | 1.3 / 1.2 | 1.5 / 1.8 | 0.0 / 0.0 |
| `/api/league/rank-changes?mode=averages` | 10.5 | 12.3 | 0 | 0 | 5.6 / 5.7 | 6.6 / 6.1 | 1.7 / 3.3 |
| `/api/league/rank-changes?mode=totals` | 5.1 | 5.2 | 0 | 0 | 5.1 / 5.2 | 9.0 / 5.9 | 1.7 / 1.7 |
| `/api/league/rank-changes?mode=averages&settled=true` | 4.8 | 5.9 | 0 | 0 | 4.8 / 5.6 | 6.6 / 5.8 | 0.0 / 0.0 |
| `/api/league/rank-changes?mode=totals&settled=true` | 4.6 | 5.1 | 0 | 0 | 4.9 / 5.3 | 6.2 / 6.2 | 1.7 / 3.3 |
| `/api/league/draft-report` | 14.3 | 13.7 | 20 | 20 | 2.6 / 2.6 | 3.2 / 3.8 | 1.7 / 3.3 |
| `/api/league/activity` | 188.6 | 185.6 | 190 | 180 | 5.0 / 5.5 | 9.9 / 7.7 | 6.7 / 6.7 |
| `/api/league/activity/latest?limit=8` | 2.2 | 2.2 | 0 | 0 | 1.6 / 1.6 | 1.8 / 2.3 | 0.0 / 1.7 |
| `/api/league/activity/latest?limit=50` | 1.7 | 1.8 | 0 | 0 | 1.6 / 1.8 | 2.1 / 2.5 | 0.0 / 0.0 |
| `/api/analytics/heatmap` | 7.0 | 5.4 | 10 | 0 | 1.6 / 1.6 | 2.0 / 2.3 | 1.7 / 0.0 |
| `/api/analytics/heatmap?start_date=2026-11-13&end_date=2026-11-19` | 26.6 | 9.6 | 20 | 10 | 26.5 / 8.5 | 51.9 / 12.3 | 28.3 / 10.0 |
| `/api/analytics/over-time?source=rankings_avg` | 19.6 | 19.1 | 10 | 10 | 18.4 / 17.7 | 26.0 / 20.9 | 10.0 / 3.3 |
| `/api/analytics/over-time?source=rankings_totals` | 20.2 | 20.7 | 0 | 0 | 20.1 / 17.2 | 22.9 / 19.5 | 8.3 / 10.0 |
| `/api/analytics/over-time?source=snapshot` | 12.9 | 12.8 | 10 | 10 | 12.9 / 11.7 | 30.6 / 19.5 | 18.3 / 8.3 |
| `/api/analytics/over-time?source=averages` | 13.5 | 14.8 | 10 | 10 | 14.0 / 13.5 | 21.0 / 19.0 | 15.0 / 13.3 |
| `/api/analytics/over-time?source=rankings_avg&team_ids=1,15` | 4.8 | 6.1 | 0 | 0 | 5.5 / 4.8 | 8.1 / 5.8 | 1.7 / 1.7 |
| `/api/teams/` | 1.8 | 2.1 | 0 | 0 | 1.9 / 1.4 | 3.2 / 1.6 | 0.0 / 1.7 |
| `/api/teams/1?time_period=season` | 70.8 | 64.3 | 60 | 50 | 2.1 / 1.7 | 3.9 / 2.3 | 0.0 / 3.3 |
| `/api/teams/1/players` | 4.3 | 3.1 | 0 | 0 | 4.3 / 2.6 | 7.4 / 2.9 | 6.7 / 0.0 |
| `/api/teams/3?time_period=season` | 25.9 | 17.4 | 20 | 10 | 2.1 / 1.7 | 2.7 / 2.2 | 3.3 / 1.7 |
| `/api/teams/3/players` | 4.1 | 2.8 | 0 | 0 | 4.0 / 2.1 | 5.9 / 2.7 | 1.7 / 1.7 |
| `/api/teams/4?time_period=season` | 26.1 | 16.3 | 20 | 10 | 2.0 / 1.7 | 2.6 / 2.1 | 0.0 / 0.0 |
| `/api/teams/4/players` | 3.9 | 2.9 | 10 | 0 | 4.0 / 2.2 | 5.6 / 2.8 | 1.7 / 5.0 |
| `/api/teams/5?time_period=season` | 26.1 | 16.7 | 20 | 10 | 2.0 / 1.7 | 2.4 / 2.3 | 5.0 / 0.0 |
| `/api/teams/5/players` | 4.4 | 2.6 | 10 | 0 | 3.5 / 2.0 | 4.8 / 2.4 | 3.3 / 1.7 |
| `/api/teams/6?time_period=season` | 30.7 | 16.6 | 20 | 10 | 1.8 / 1.7 | 2.4 / 2.1 | 1.7 / 0.0 |
| `/api/teams/6/players` | 5.0 | 2.2 | 0 | 0 | 3.7 / 2.0 | 5.2 / 2.7 | 0.0 / 3.3 |
| `/api/teams/8?time_period=season` | 28.5 | 15.8 | 30 | 10 | 1.8 / 1.7 | 2.1 / 2.1 | 3.3 / 1.7 |
| `/api/teams/8/players` | 4.0 | 2.4 | 0 | 0 | 3.5 / 2.1 | 3.6 / 2.9 | 3.3 / 0.0 |
| `/api/teams/9?time_period=season` | 29.1 | 16.3 | 20 | 10 | 1.8 / 1.6 | 2.0 / 2.3 | 3.3 / 3.3 |
| `/api/teams/9/players` | 3.5 | 2.5 | 0 | 0 | 3.4 / 2.0 | 3.8 / 2.5 | 0.0 / 1.7 |
| `/api/teams/10?time_period=season` | 26.5 | 19.7 | 20 | 10 | 1.7 / 1.7 | 2.1 / 2.2 | 0.0 / 0.0 |
| `/api/teams/10/players` | 3.6 | 2.6 | 0 | 0 | 3.4 / 2.0 | 3.7 / 2.7 | 6.7 / 1.7 |
| `/api/teams/11?time_period=season` | 27.0 | 20.8 | 20 | 10 | 1.8 / 1.6 | 1.9 / 2.1 | 0.0 / 1.7 |
| `/api/teams/11/players` | 3.6 | 2.4 | 10 | 0 | 3.5 / 1.9 | 3.6 / 2.4 | 3.3 / 0.0 |
| `/api/teams/12?time_period=season` | 25.4 | 21.3 | 20 | 10 | 1.8 / 1.7 | 2.0 / 2.2 | 0.0 / 3.3 |
| `/api/teams/12/players` | 3.5 | 2.2 | 10 | 0 | 3.5 / 2.0 | 3.7 / 2.3 | 5.0 / 3.3 |
| `/api/teams/13?time_period=season` | 26.1 | 17.9 | 20 | 10 | 1.8 / 1.7 | 2.1 / 2.0 | 1.7 / 0.0 |
| `/api/teams/13/players` | 3.5 | 2.0 | 0 | 0 | 3.5 / 2.0 | 3.7 / 2.4 | 3.3 / 0.0 |
| `/api/teams/15?time_period=season` | 25.4 | 17.2 | 20 | 10 | 2.0 / 1.6 | 2.1 / 2.1 | 0.0 / 0.0 |
| `/api/teams/15/players` | 3.5 | 2.1 | 0 | 10 | 3.4 / 1.9 | 3.6 / 2.4 | 1.7 / 5.0 |
| `/api/teams/1?time_period=last_night` | 19.9 | 8.1 | 20 | 0 | 1.8 / 1.7 | 2.4 / 2.3 | 3.3 / 0.0 |
| `/api/teams/15?time_period=last_night` | 19.4 | 9.0 | 20 | 10 | 1.8 / 1.6 | 2.2 / 2.0 | 0.0 / 0.0 |
| `/api/teams/1?time_period=last_7` | 64.4 | 63.4 | 70 | 60 | 1.8 / 1.8 | 2.3 / 2.4 | 0.0 / 5.0 |
| `/api/teams/15?time_period=last_7` | 24.1 | 12.6 | 20 | 10 | 1.7 / 1.7 | 2.0 / 2.2 | 1.7 / 1.7 |
| `/api/teams/1?time_period=last_15` | 68.1 | 56.7 | 60 | 50 | 1.9 / 1.6 | 2.0 / 2.3 | 3.3 / 0.0 |
| `/api/teams/15?time_period=last_15` | 25.5 | 13.7 | 20 | 10 | 1.7 / 1.6 | 2.0 / 1.9 | 0.0 / 0.0 |
| `/api/teams/1?time_period=last_30` | 71.5 | 58.4 | 60 | 60 | 1.7 / 1.7 | 2.0 / 1.7 | 1.7 / 0.0 |
| `/api/teams/15?time_period=last_30` | 26.7 | 16.5 | 20 | 10 | 1.8 / 1.6 | 2.2 / 1.9 | 0.0 / 5.0 |
| `/api/teams/1?time_period=custom&start=2026-11-01&end=2026-11-19` | 28.2 | 15.8 | 20 | 10 | 28.8 / 15.1 | 29.3 / 15.5 | 25.0 / 8.3 |
| `/api/teams/1/roster-day` | 12.9 | 13.7 | 10 | 10 | 2.3 / 1.9 | 2.5 / 2.2 | 1.7 / 1.7 |
| `/api/teams/1/roster-day?date=2026-11-19` | 84.8 | 21.7 | 80 | 10 | 2.0 / 1.8 | 2.2 / 1.9 | 0.0 / 3.3 |
| `/api/teams/1/roster-day?date=2026-11-13` | 21.4 | 21.4 | 20 | 30 | 1.9 / 1.8 | 2.2 / 2.0 | 3.3 / 0.0 |
| `/api/teams/15/roster-day` | 10.3 | 10.3 | 0 | 10 | 1.7 / 1.6 | 2.0 / 1.7 | 0.0 / 1.7 |
| `/api/teams/15/roster-day?date=2026-11-19` | 15.1 | 16.9 | 10 | 10 | 1.9 / 1.7 | 2.1 / 1.8 | 1.7 / 0.0 |
| `/api/teams/15/roster-day?date=2026-11-13` | 12.6 | 14.5 | 10 | 10 | 1.9 / 1.8 | 3.4 / 2.0 | 3.3 / 1.7 |
| `/api/players/?page=1&limit=1200&time_period=season` | 52.5 | 114.8 | 50 | 100 | 12.3 / 12.0 | 12.8 / 12.3 | 11.7 / 11.7 |
| `/api/players/?page=1&limit=1200&time_period=last_night` | 42.5 | 30.5 | 40 | 30 | 8.7 / 8.6 | 9.2 / 8.9 | 6.7 / 8.3 |
| `/api/players/?page=1&limit=1200&time_period=last_7` | 45.4 | 34.5 | 40 | 30 | 11.0 / 10.8 | 12.0 / 10.9 | 10.0 / 10.0 |
| `/api/players/?page=1&limit=1200&time_period=last_15` | 48.8 | 34.4 | 40 | 30 | 11.4 / 11.1 | 12.1 / 11.4 | 10.0 / 8.3 |
| `/api/players/?page=1&limit=1200&time_period=last_30` | 50.6 | 39.4 | 40 | 30 | 12.1 / 12.0 | 12.6 / 13.4 | 10.0 / 10.0 |
| `/api/players/?page=2&limit=500&time_period=season` | 5.1 | 5.0 | 10 | 0 | 4.6 / 4.6 | 4.9 / 5.0 | 3.3 / 5.0 |
| `/api/players/?page=1&limit=1200&time_period=custom&start=2026-11-01&end=2026-11-19` | 52.9 | 37.3 | 40 | 30 | 67.9 / 38.4 | 167.1 / 38.9 | 75.0 / 30.0 |
| `/api/estimator/results` | 12.4 | 8.4 | 10 | 10 | 2.9 / 2.1 | 5.3 / 2.7 | 3.3 / 3.3 |
| `/api/injuries/` | 2.1 | 1.7 | 0 | 0 | 1.8 / 1.7 | 2.3 / 2.2 | 1.7 / 0.0 |
| `/api/injuries/notifications` | 1.1 | 1.1 | 0 | 0 | 1.0 / 0.9 | 1.5 / 1.3 | 1.7 / 0.0 |
| `/api/injuries/status` | 1.0 | 0.9 | 0 | 0 | 1.0 / 0.9 | 1.4 / 1.6 | 1.7 / 1.7 |
| `/api/nba-teams/` | 1.3 | 1.2 | 0 | 0 | 1.1 / 1.0 | 1.5 / 1.2 | 0.0 / 0.0 |
| `/api/nba-teams/1/depthchart` | 4.3 | 4.1 | 0 | 0 | 2.3 / 2.0 | 2.7 / 2.3 | 1.7 / 0.0 |
| `/api/nba-teams/2/depthchart` | 3.1 | 3.0 | 10 | 10 | 1.9 / 1.7 | 3.6 / 1.8 | 0.0 / 0.0 |
| `/api/nba-teams/13/depthchart` | 3.1 | 3.0 | 0 | 0 | 1.7 / 1.6 | 2.6 / 1.8 | 0.0 / 1.7 |
| `/api/nba-teams/25/depthchart` | 3.2 | 3.1 | 0 | 0 | 1.8 / 1.5 | 2.3 / 4.4 | 0.0 / 0.0 |
| `/api/nba/schedule` | 38.1 | 36.5 | 40 | 40 | 5.9 / 5.3 | 7.7 / 5.6 | 10.0 / 8.3 |
| `/api/nba/season` | 1.5 | 1.6 | 0 | 0 | 1.4 / 1.0 | 1.6 / 1.2 | 0.0 / 1.7 |
| `/api/nba/scoreboard?date=2026-11-19` | 1.3 | 1.4 | 0 | 0 | 1.7 / 1.2 | 1.9 / 1.6 | 0.0 / 0.0 |
| `/api/nba/scoreboard/values?date=2026-11-19` | 119.0 | 122.6 | 110 | 120 | 10.5 / 8.6 | 14.0 / 8.7 | 10.0 / 6.7 |
| `/api/nba/scoreboard?date=2026-11-20` | 5.8 | 5.4 | 10 | 0 | 1.8 / 1.4 | 2.3 / 1.5 | 3.3 / 1.7 |
| `/api/nba/scoreboard/values?date=2026-11-20` | 76.1 | 73.6 | 70 | 80 | 2.6 / 2.3 | 3.6 / 2.4 | 0.0 / 3.3 |
| `/api/nba/scoreboard?date=2026-11-13` | 2.2 | 2.2 | 0 | 10 | 1.8 / 1.4 | 2.2 / 1.5 | 0.0 / 0.0 |
| `/api/nba/scoreboard/values?date=2026-11-13` | 259.4 | 181.8 | 260 | 170 | 20.2 / 15.3 | 29.6 / 15.9 | 20.0 / 15.0 |
| `/api/nba/games/401910019/boxscore` | 10.2 | 10.9 | 10 | 10 | 11.0 / 9.8 | 16.4 / 14.2 | 13.3 / 10.0 |
| `/api/nba/games/401910020/boxscore` | 9.7 | 10.6 | 10 | 10 | 10.3 / 9.3 | 15.5 / 14.4 | 11.7 / 6.7 |
| `/api/nba/games/401910021/boxscore` | 8.5 | 9.0 | 10 | 10 | 9.4 / 8.6 | 13.1 / 13.3 | 6.7 / 13.3 |
| `/api/nba/with-without/teams` | 1.8 | 2.1 | 0 | 0 | 2.0 / 1.4 | 2.6 / 2.2 | 3.3 / 0.0 |
| `/api/nba/with-without/2` | 12.2 | 12.3 | 10 | 10 | 4.6 / 3.7 | 6.5 / 5.3 | 3.3 / 3.3 |
| `/api/nba/with-without/13` | 9.0 | 9.7 | 10 | 0 | 4.2 / 3.8 | 4.9 / 5.4 | 3.3 / 3.3 |
| `/api/nba/with-without/25` | 8.1 | 10.0 | 0 | 10 | 3.8 / 3.8 | 4.7 / 5.8 | 5.0 / 3.3 |
| `/api/nba-players/3945274` | 1.1 | 1.3 | 0 | 0 | 1.2 / 1.2 | 1.4 / 1.6 | 1.7 / 1.7 |
| `/api/nba-players/3945274/games` | 1103.5 | 1201.8 | 1080 | 1180 | 84.0 / 81.0 | 103.9 / 190.5 | 68.3 / 88.3 |
| `/api/nba-players/3945274/seasons` | 4.2 | 4.1 | 10 | 0 | 2.1 / 1.8 | 2.3 / 2.1 | 3.3 / 5.0 |
| `/api/nba-players/3945274/stats?time_period=season` | 4.4 | 4.1 | 0 | 0 | 3.6 / 3.5 | 4.5 / 4.2 | 3.3 / 0.0 |
| `/api/nba-players/3945274/stats?time_period=last_7` | 2.4 | 2.4 | 0 | 0 | 2.4 / 2.3 | 2.9 / 3.3 | 1.7 / 0.0 |
| `/api/nba-players/3945274/stats?time_period=last_30` | 3.0 | 2.9 | 0 | 0 | 3.0 / 2.8 | 3.2 / 3.5 | 0.0 / 1.7 |
| `/api/nba-players/3945274/stats?time_period=custom&start=2026-11-01&end=2026-11-19` | 2.5 | 2.5 | 0 | 0 | 2.4 / 2.2 | 2.7 / 2.8 | 0.0 / 0.0 |
| `/api/league/players/3945274/history` | 71.2 | 71.8 | 60 | 70 | 10.6 / 9.4 | 120.8 / 10.5 | 35.0 / 11.7 |
| `/api/nba-players/4278073` | 1.3 | 1.4 | 0 | 0 | 1.1 / 1.0 | 1.7 / 1.3 | 0.0 / 1.7 |
| `/api/nba-players/4278073/games` | 605.5 | 618.9 | 590 | 600 | 90.4 / 77.7 | 216.8 / 81.4 | 101.7 / 61.7 |
| `/api/nba-players/4278073/seasons` | 3.1 | 3.1 | 0 | 0 | 2.0 / 1.9 | 2.4 / 2.4 | 1.7 / 0.0 |
| `/api/nba-players/4278073/stats?time_period=season` | 4.3 | 4.0 | 0 | 0 | 4.1 / 3.5 | 7.8 / 5.0 | 1.7 / 0.0 |
| `/api/nba-players/4278073/stats?time_period=last_7` | 2.6 | 2.5 | 0 | 0 | 2.9 / 2.2 | 3.7 / 2.7 | 1.7 / 0.0 |
| `/api/nba-players/4278073/stats?time_period=last_30` | 3.0 | 3.5 | 0 | 10 | 3.1 / 2.7 | 4.0 / 3.7 | 0.0 / 1.7 |
| `/api/nba-players/4278073/stats?time_period=custom&start=2026-11-01&end=2026-11-19` | 2.4 | 2.8 | 0 | 0 | 2.7 / 2.2 | 3.5 / 2.9 | 0.0 / 0.0 |
| `/api/league/players/4278073/history` | 76.7 | 75.5 | 70 | 70 | 10.4 / 9.7 | 15.6 / 10.5 | 11.7 / 10.0 |
| `/api/nba-players/5104157` | 1.3 | 1.3 | 0 | 0 | 1.1 / 1.0 | 1.4 / 1.1 | 0.0 / 0.0 |
| `/api/nba-players/5104157/games` | 155.5 | 159.0 | 140 | 140 | 101.7 / 87.7 | 125.4 / 200.7 | 85.0 / 96.7 |
| `/api/nba-players/5104157/seasons` | 2.6 | 2.7 | 0 | 0 | 2.0 / 1.8 | 2.8 / 2.2 | 3.3 / 1.7 |
| `/api/nba-players/5104157/stats?time_period=season` | 4.9 | 3.9 | 0 | 0 | 4.6 / 3.8 | 5.7 / 4.4 | 0.0 / 0.0 |
| `/api/nba-players/5104157/stats?time_period=last_7` | 3.5 | 2.4 | 0 | 0 | 3.1 / 2.1 | 5.3 / 2.8 | 0.0 / 0.0 |
| `/api/nba-players/5104157/stats?time_period=last_30` | 3.9 | 3.2 | 0 | 0 | 3.5 / 3.2 | 5.0 / 3.7 | 3.3 / 1.7 |
| `/api/nba-players/5104157/stats?time_period=custom&start=2026-11-01&end=2026-11-19` | 3.3 | 2.6 | 0 | 0 | 2.8 / 2.2 | 3.9 / 2.7 | 1.7 / 1.7 |
| `/api/league/players/5104157/history` | 87.5 | 77.7 | 90 | 80 | 11.0 / 9.9 | 18.7 / 11.3 | 11.7 / 11.7 |
| `/api/nba-players/3032977` | 1.4 | 1.3 | 0 | 0 | 1.2 / 1.0 | 1.4 / 1.1 | 0.0 / 0.0 |
| `/api/nba-players/3032977/games` | 425.0 | 391.6 | 400 | 380 | 135.9 / 81.6 | 230.3 / 108.1 | 135.0 / 66.7 |
| `/api/nba-players/3032977/seasons` | 3.4 | 3.3 | 0 | 10 | 2.1 / 2.0 | 2.6 / 2.4 | 1.7 / 3.3 |
| `/api/nba-players/3032977/stats?time_period=season` | 4.0 | 4.3 | 0 | 0 | 3.8 / 4.0 | 4.4 / 4.5 | 0.0 / 1.7 |
| `/api/nba-players/3032977/stats?time_period=last_7` | 2.3 | 2.7 | 0 | 0 | 2.5 / 2.5 | 3.3 / 3.0 | 3.3 / 3.3 |
| `/api/nba-players/3032977/stats?time_period=last_30` | 3.6 | 3.5 | 10 | 0 | 3.2 / 3.1 | 4.2 / 4.3 | 1.7 / 0.0 |
| `/api/nba-players/3032977/stats?time_period=custom&start=2026-11-01&end=2026-11-19` | 2.7 | 2.8 | 0 | 0 | 2.6 / 2.5 | 3.6 / 2.8 | 0.0 / 0.0 |
| `/api/league/players/3032977/history` | 70.5 | 74.6 | 70 | 70 | 12.8 / 10.0 | 15.6 / 13.8 | 11.7 / 13.3 |
| `/api/nba-players/4432187` | 1.4 | 1.4 | 0 | 0 | 1.2 / 1.1 | 1.5 / 1.2 | 1.7 / 0.0 |
| `/api/nba-players/4432187/games` | 12.1 | 15.8 | 10 | 0 | 13.0 / 11.2 | 16.6 / 13.3 | 8.3 / 5.0 |
| `/api/nba-players/4432187/seasons` | 2.3 | 2.2 | 0 | 10 | 1.3 / 1.2 | 1.5 / 1.3 | 0.0 / 0.0 |
| `/api/nba-players/4432187/stats?time_period=season` | 3.6 | 3.7 | 0 | 0 | 3.3 / 2.7 | 4.2 / 3.4 | 0.0 / 1.7 |
| `/api/nba-players/4432187/stats?time_period=last_7` | 5.6 | 2.9 | 10 | 0 | 5.8 / 2.7 | 7.9 / 2.9 | 8.3 / 1.7 |
| `/api/nba-players/4432187/stats?time_period=last_30` | 3.0 | 2.9 | 0 | 0 | 3.2 / 2.6 | 4.1 / 3.1 | 1.7 / 1.7 |
| `/api/nba-players/4432187/stats?time_period=custom&start=2026-11-01&end=2026-11-19` | 2.3 | 2.3 | 0 | 0 | 2.5 / 2.3 | 3.2 / 2.5 | 0.0 / 1.7 |
| `/api/league/players/4432187/history` | 7.2 | 6.8 | 10 | 10 | 5.1 / 4.9 | 8.0 / 5.6 | 5.0 / 1.7 |
| `/api/nba-players/4433076` | 1.1 | 1.1 | 0 | 0 | 1.0 / 1.1 | 1.5 / 1.2 | 0.0 / 3.3 |
| `/api/nba-players/4433076/games` | 10.5 | 11.2 | 10 | 0 | 11.0 / 10.2 | 13.5 / 12.1 | 10.0 / 5.0 |
| `/api/nba-players/4433076/seasons` | 2.3 | 2.2 | 0 | 0 | 1.2 / 1.5 | 1.8 / 1.9 | 0.0 / 0.0 |
| `/api/nba-players/4433076/stats?time_period=season` | 3.5 | 3.5 | 0 | 0 | 3.2 / 2.9 | 3.8 / 5.2 | 1.7 / 0.0 |
| `/api/nba-players/4433076/stats?time_period=last_7` | 6.4 | 3.0 | 10 | 0 | 6.3 / 2.4 | 7.9 / 3.5 | 5.0 / 3.3 |
| `/api/nba-players/4433076/stats?time_period=last_30` | 2.9 | 3.5 | 0 | 0 | 3.0 / 2.5 | 3.3 / 4.3 | 1.7 / 5.0 |
| `/api/nba-players/4433076/stats?time_period=custom&start=2026-11-01&end=2026-11-19` | 2.6 | 2.7 | 0 | 0 | 2.4 / 2.6 | 2.5 / 3.8 | 1.7 / 0.0 |
| `/api/league/players/4433076/history` | 7.0 | 5.3 | 10 | 10 | 5.0 / 4.5 | 7.1 / 6.6 | 1.7 / 1.7 |
| `/api/matchups/dates` | 3.9 | 2.2 | 0 | 0 | 1.9 / 1.8 | 2.3 / 2.9 | 0.0 / 1.7 |
| `/api/matchups/upcoming-dates` | 9.9 | 10.0 | 10 | 10 | 1.1 / 1.1 | 1.5 / 1.6 | 3.3 / 0.0 |
| `/api/matchups/current-slate-date` | 1.7 | 1.5 | 0 | 0 | 1.1 / 1.3 | 1.5 / 1.5 | 3.3 / 1.7 |
| `/api/matchups/today` | 394.7 | 152.6 | 390 | 140 | 5.6 / 5.4 | 7.5 / 7.7 | 3.3 / 6.7 |
| `/api/matchups/today?date=20261121` | 128.8 | 168.2 | 130 | 170 | 4.0 / 4.0 | 5.9 / 5.7 | 1.7 / 3.3 |
| `/api/projections/player/3945274` | 17.4 | 4.5 | 10 | 10 | 10.0 / 4.4 | 13.8 / 5.9 | 10.0 / 5.0 |
| `/api/projections/player/4278073` | 10.8 | 3.8 | 10 | 0 | 8.9 / 4.2 | 15.2 / 5.8 | 11.7 / 3.3 |
| `/api/projections/player/5104157` | 13.4 | 4.0 | 20 | 0 | 9.0 / 3.9 | 14.2 / 4.2 | 11.7 / 5.0 |
| `/api/projections/player/3032977` | 17.3 | 6.3 | 10 | 10 | 9.2 / 3.8 | 10.4 / 3.9 | 6.7 / 1.7 |
| `/api/projections/player/4432187` | 15.1 | 3.8 | 10 | 0 | 8.6 / 3.6 | 9.8 / 4.1 | 10.0 / 5.0 |
| `/api/projections/player/4433076` | 16.8 | 3.7 | 10 | 0 | 8.9 / 3.7 | 10.1 / 3.9 | 6.7 / 5.0 |
| `POST /api/projections/predict {"is_home": true, "minutes": 30.0, "opponent": "BOS", "playe` | 16.7 | 4.2 | 20 | 0 | 9.7 / 3.9 | 10.2 / 4.2 | 5.0 / 0.0 |
| `POST /api/projections/predict {"is_home": false, "minutes": 22.5, "opponent": "LAL", "play` | 10.3 | 3.5 | 10 | 10 | 9.3 / 4.0 | 13.5 / 4.2 | 15.0 / 5.0 |
| `/api/feature-store/players` | 38.9 | 23.0 | 40 | 20 | 30.1 / 23.5 | 47.8 / 31.0 | 35.0 / 25.0 |
| `/api/feature-store/teams` | 2.1 | 1.5 | 0 | 0 | 1.4 / 1.3 | 2.3 / 1.4 | 0.0 / 0.0 |
| `/api/feature-store/players/3945274/state` | 3.1 | 2.5 | 10 | 0 | 2.5 / 2.5 | 4.3 / 2.8 | 0.0 / 1.7 |
| `/api/feature-store/players/4278073/state` | 2.7 | 2.1 | 0 | 0 | 2.6 / 2.1 | 3.7 / 2.3 | 1.7 / 1.7 |
| `/api/feature-store/players/5104157/state` | 2.6 | 2.0 | 0 | 0 | 2.8 / 2.1 | 3.5 / 2.8 | 3.3 / 0.0 |
| `/api/feature-store/teams/1/state` | 1.7 | 1.3 | 0 | 0 | 1.7 / 1.3 | 2.0 / 1.6 | 0.0 / 1.7 |
| `/api/feature-store/teams/13/state` | 1.6 | 1.2 | 0 | 0 | 1.7 / 1.2 | 2.2 / 1.4 | 3.3 / 5.0 |
| `/api/trends/minutes?window_days=5` | 57.4 | 20.2 | 50 | 10 | 56.2 / 14.6 | 176.8 / 19.3 | 78.3 / 10.0 |
| `/api/trends/usage?window_days=5` | 1401.3 | 1058.2 | 460 | 180 | 417.6 / 143.0 | 428.4 / 159.6 | 415.0 / 138.3 |
| `/api/trends/categories?window_days=5` | 509.4 | 170.9 | 510 | 170 | 406.1 / 170.1 | 556.1 / 213.1 | 450.0 / 175.0 |
| `/api/trends/minutes?window_days=15` | 57.0 | 18.8 | 50 | 10 | 4.0 / 4.0 | 4.8 / 4.8 | 0.0 / 5.0 |
| `/api/trends/usage?window_days=15` | 495.6 | 167.8 | 490 | 160 | 5.1 / 4.9 | 5.9 / 6.1 | 6.7 / 5.0 |
| `/api/trends/categories?window_days=15` | 477.9 | 195.1 | 470 | 200 | 4.2 / 4.1 | 5.0 / 4.4 | 3.3 / 1.7 |
| `/api/trends/minutes?window_days=30` | 152.8 | 24.6 | 150 | 10 | 2.9 / 3.0 | 3.4 / 3.4 | 0.0 / 3.3 |
| `/api/trends/usage?window_days=30` | 413.7 | 160.8 | 400 | 160 | 3.8 / 3.8 | 4.6 / 4.0 | 3.3 / 3.3 |
| `/api/trends/categories?window_days=30` | 385.1 | 197.9 | 380 | 190 | 1.3 / 1.3 | 1.6 / 1.5 | 1.7 / 0.0 |
| `/api/trends/minutes?window_days=60` | 65.9 | 26.5 | 60 | 10 | 67.4 / 21.8 | 269.3 / 23.0 | 116.7 / 13.3 |
| `/api/trends/usage?window_days=60` | 420.9 | 171.9 | 410 | 160 | 417.1 / 169.4 | 545.3 / 189.9 | 448.3 / 165.0 |
| `/api/trends/categories?window_days=60` | 410.9 | 186.7 | 400 | 180 | 406.8 / 189.7 | 507.8 / 196.3 | 418.3 / 186.7 |
| `/api/trends/regression?window_days=15&baseline_seasons=2&mode=season` | 126.3 | 59.6 | 60 | 20 | 3.1 / 3.0 | 3.4 / 3.5 | 1.7 / 0.0 |
| `/api/trends/regression?window_days=15&baseline_seasons=0&mode=form` | 56.1 | 13.2 | 50 | 10 | 1.5 / 1.7 | 2.1 / 2.0 | 0.0 / 3.3 |
| `/api/trends/regression?window_days=30&baseline_seasons=1&mode=season` | 186.3 | 37.3 | 160 | 10 | 2.5 / 2.7 | 3.8 / 3.5 | 0.0 / 1.7 |
| `/api/trends/player/3945274/gamelog?window_days=15&baseline_seasons=2&mode=season` | 60.6 | 16.9 | 50 | 10 | 1.3 / 1.5 | 1.5 / 1.9 | 3.3 / 0.0 |
| `/api/trends/player/3945274/gamelog?window_days=15&baseline_seasons=0&mode=form` | 11.6 | 7.7 | 10 | 10 | 1.2 / 1.4 | 1.6 / 1.8 | 3.3 / 0.0 |
| `/api/trends/player/4278073/gamelog?window_days=15&baseline_seasons=2&mode=season` | 10.6 | 6.7 | 10 | 0 | 1.3 / 1.2 | 1.5 / 1.7 | 0.0 / 0.0 |
| `/api/trends/player/4278073/gamelog?window_days=15&baseline_seasons=0&mode=form` | 11.1 | 6.2 | 0 | 0 | 1.2 / 1.2 | 1.3 / 1.7 | 1.7 / 1.7 |
| `/api/trends/player/5104157/gamelog?window_days=15&baseline_seasons=2&mode=season` | 10.4 | 5.8 | 0 | 0 | 1.2 / 1.6 | 1.4 / 5.4 | 0.0 / 1.7 |
| `/api/trends/player/5104157/gamelog?window_days=15&baseline_seasons=0&mode=form` | 10.6 | 6.1 | 10 | 10 | 1.2 / 1.4 | 1.4 / 1.9 | 1.7 / 1.7 |
| `/api/surprises/dates` | 2.7 | 2.3 | 0 | 0 | 1.0 / 1.1 | 1.1 / 1.5 | 0.0 / 0.0 |
| `/api/surprises/latest` | 6.7 | 5.4 | 10 | 0 | 3.5 / 3.6 | 4.0 / 5.6 | 0.0 / 1.7 |
| `/api/surprises/2026-11-19` | 3.9 | 2.7 | 10 | 0 | 3.2 / 3.3 | 3.6 / 4.9 | 5.0 / 1.7 |
| `/api/surprises/2026-11-18` | 13.9 | 9.8 | 10 | 10 | 13.2 / 13.3 | 17.0 / 20.7 | 10.0 / 15.0 |
| `/api/surprises/period?start=2026-11-01&end=2026-11-19&min_score=2.0` | 7.5 | 5.3 | 0 | 0 | 6.1 / 6.3 | 7.8 / 94.0 | 5.0 / 23.3 |
| `/api/surprises/period?start=2026-11-01&end=2026-11-19&min_score=3.0` | 3.4 | 2.8 | 0 | 0 | 3.1 / 3.5 | 3.5 / 5.8 | 0.0 / 3.3 |
| `/api/adp?page=1&page_size=50&sort=blend&sort_dir=asc&ranked_only=true` | 226.7 | 311.5 | 220 | 310 | 4.8 / 4.8 | 5.5 / 8.6 | 5.0 / 5.0 |
| `/api/adp?page=2&page_size=50&sort=espn&sort_dir=desc&ranked_only=true&pos=PG` | 4.1 | 3.7 | 0 | 0 | 4.4 / 4.1 | 4.7 / 6.5 | 3.3 / 0.0 |
| `/api/adp?page=1&page_size=2000&sort=blend&sort_dir=asc&ranked_only=false&include_stats=fal` | 11.1 | 10.7 | 10 | 10 | 12.2 / 12.0 | 14.8 / 20.6 | 11.7 / 15.0 |
| `/api/adp?page=1&page_size=50&sort=blend&sort_dir=asc&ranked_only=true&q=james&metric=rank` | 2.1 | 2.2 | 0 | 0 | 2.5 / 2.4 | 2.8 / 3.5 | 1.7 / 3.3 |
| `/api/adp/index` | 10.1 | 9.9 | 10 | 10 | 10.2 / 9.4 | 14.3 / 16.6 | 8.3 / 10.0 |
| `/api/adp/index?metric=rank` | 8.4 | 8.7 | 10 | 10 | 10.5 / 9.5 | 11.9 / 16.1 | 8.3 / 11.7 |
| `/api/adp/movers?metric=adp&mode=range&top=150&limit=10` | 2.5 | 2.4 | 0 | 0 | 2.7 / 2.2 | 3.0 / 3.4 | 5.0 / 1.7 |
| `/api/adp/movers?metric=adp&mode=since_start&top=150&limit=10` | 1.6 | 1.6 | 0 | 0 | 1.9 / 1.8 | 2.1 / 2.8 | 1.7 / 1.7 |
| `/api/minigames/teams` | 1.5 | 1.3 | 0 | 0 | 1.4 / 1.4 | 1.7 / 2.0 | 1.7 / 1.7 |
| `/api/minigames/who-am-i/leaderboard` | 1.6 | 1.8 | 0 | 0 | 1.6 / 1.5 | 1.9 / 2.4 | 0.0 / 1.7 |

## Endpoints slower after (first hit >10% and >5 ms, CPU >10% and >10 ms, or cached p95 >25% and >5 ms)

- `/api/teams/8?time_period=season` first-hit ms: 71.2 → 121.4
- `/api/teams/8?time_period=season` first-hit CPU ms: 60.0 → 120.0
- `/api/players/?page=1&limit=1200&time_period=season` first-hit ms: 52.5 → 114.8
- `/api/players/?page=1&limit=1200&time_period=season` first-hit CPU ms: 50.0 → 100.0
- `/api/nba-players/3945274/games` cached p95 ms: 103.9 → 190.5
- `/api/nba-players/5104157/games` cached p95 ms: 125.4 → 200.7
- `/api/matchups/today?date=20261121` first-hit ms: 128.8 → 168.2
- `/api/matchups/today?date=20261121` first-hit CPU ms: 130.0 → 170.0
- `/api/surprises/period?start=2026-11-01&end=2026-11-19&min_score=2.0` cached p95 ms: 7.8 → 94.0
- `/api/adp?page=1&page_size=50&sort=blend&sort_dir=asc&ranked_only=true` first-hit ms: 226.7 → 311.5
- `/api/adp?page=1&page_size=50&sort=blend&sort_dir=asc&ranked_only=true` first-hit CPU ms: 220.0 → 310.0
- `/api/adp?page=1&page_size=2000&sort=blend&sort_dir=asc&ranked_only=false&include_stats=false` cached p95 ms: 14.8 → 20.6
