# Serving — feature store + live inference

Productionized next-game stat prediction (design **b2**: raw rows are the source of
truth; current-state feature vectors are recomputed when new results arrive — no
incremental window surgery).

## Pieces

| file | role |
|------|------|
| `config.py` | `MIN_INFERENCE_GAMES = 10`, store dir, reuses research/training config |
| `errors.py` | `UnknownPlayerError`, `InsufficientHistoryError`, `UnknownTeamError`, `ModelsNotTrainedError` |
| `feature_store.py` | `FeatureStore` — build / load / save / nightly update / `get_player_state` / `get_team_state` |
| `inference.py` | `LiveInference` — `predict(PredictionRequest) -> PredictionResult` |

## Live prediction

```python
from model_stats_inference.serving.feature_store import FeatureStore
from model_stats_inference.serving.inference import LiveInference, PredictionRequest

store = FeatureStore.load()            # or FeatureStore.from_research_cache()
inf = LiveInference(store)             # loads ../models/*.joblib

res = inf.predict(PredictionRequest(
    player_id=1628969, opponent_team_id=1610612737,
    is_home=True, game_date="2026-04-12", minutes=34,   # t = expected minutes
))
res.stats["PTS"].value         # point estimate
res.stats["PTS"].low, .high    # ±RMSE band
res.stats["FG_PCT"].value      # derived FGM/FGA
```

The caller supplies the opponent and the **minutes `t`**; the player's own team comes
from the store. `T_MIN` and every `t*rate` feature are recomputed at predict time, so
varying `t` changes the line (more minutes → more counting stats).

The models are **minutes-exposure** models (`ŷ = t · rate`), so `t = 0` yields an
exactly-zero line on every counting stat and predictions are monotone in minutes —
structurally, not by a special case. See `docs/MINUTES_EXPOSURE.md`.

Players with `< MIN_INFERENCE_GAMES` history raise `InsufficientHistoryError`
(start of season / rookies / just-traded), rather than returning a garbage line.

## Nightly update (b2)

```python
store = FeatureStore.load()
store.update_with_nightly_results(new_player_games, new_team_games)  # append + recompute affected
store.save()
```

`new_*` are raw game-log rows (player + team schema). The store appends them, re-derives
the opponent/own team tables for the new games, and recomputes only the affected
players'/teams' vectors. Counts, recency caps and the include-last-game rule fall out of
recomputing from dated rows — nothing to keep in sync by hand.

> Note: build the production store from **unfiltered** logs (not the research cache,
> which drops players with < 20 games) so early-season players exist and the
> insufficient-history guard applies to them.

## Deploying a model or feature change

Production stores the vectors in **Postgres**, not in the parquet files above
(`serving/store/*.parquet` is local/legacy — production never calls `.save()`/`.load()`).
They live in `fs_player_vectors` / `fs_team_allowed_vectors` / `fs_team_own_vectors`,
each holding all features as a single **JSONB** blob keyed by feature name.

Two consequences:

- **A feature change needs no SQL migration.** New features are new JSON keys; the
  table DDL is unchanged.
- **It does need a re-materialization**, because the vectors are a *precomputed
  cache* rather than something computed per request. This is automatic — see below.

### Deploying is enough: the store self-heals

`run_catchup` starts with `_ensure_vectors_current()`, which compares the features
the deployed models ask for (the union over `training/feature_sets/*.json`, minus the
ones `_assemble_row` derives per request) against the keys stored across **all three**
vector tables. The union matters: a feature row is composed from the player vector
plus the `TEAM_*` and `OPP_ALLOWED_*` team vectors, so checking `fs_player_vectors`
alone would report ~77 team features as permanently missing and rebuild every night.
If the models need something the store lacks, it rebuilds **all** vectors once,
exactly like an init:

```bash
# 1. deploy the branch  (models/*.joblib are git-tracked and ship with it)
# 2. restart the app
# 3. nothing — the next nightly detects the new feature and rebuilds the vectors
```

It is self-limiting: after the rebuild the keys match, so every later night costs three
`LIMIT 1` queries (one per vector table) and does nothing. The rebuild itself is ~2 s
of compute for ~660 players × ~250 columns. If a feature is *still* absent afterwards
the run reports `vectors_refresh_incomplete` and logs an error rather than retrying
nightly — that means the feature sets and the feature engine disagree.

Why the check lives in `run_catchup` and not `_run_for_date`: the per-night path
already rebuilds every vector (`_process_sync` → `FeatureStore.build` over all stored
rows), but only on nights that **have games**. Off-nights return early at `no_games`,
so during the off-season nothing would recompute for months. Hoisting the check above
the loop makes a deploy heal regardless of the calendar.

> Requires `MODEL_NIGHTLY_ENABLED=true` — the scheduler is off by default
> (`app/config.py`). Without it, use the manual script below.

### Manual override

To apply a feature change immediately instead of waiting for the next nightly:

```bash
cd backend    # must run from here: pydantic loads .env (SEASON_ID, LEAGUE_ID) from the CWD
python scripts/refresh_feature_vectors.py --database-url postgresql://... \
    --expect-feature SOME_NEW_FEATURE
```

`DATABASE_URL` (via the flag or the env var) is the only variable you have to supply;
`SEASON_ID` and `LEAGUE_ID` are required by the settings but already live in
`backend/.env`. The feature engineering runs wherever the script runs — not in the
database — so this also works **locally against a remote DB**, using your checkout's
feature code.

Non-destructive: it reads `fs_player_games` / `fs_team_games`, rebuilds all vectors,
and upserts. It does **not** re-fetch from ESPN and truncates nothing.

> Use `scripts/reinit_model_store.py` only for a true migration (e.g. an ID-space
> change). It truncates the `fs_*` tables *and* the prediction history, and re-seeds
> from ESPN — and since `research/data/` is gitignored, the month-parquet cache that
> makes it fast will not exist on a server.

Models are read from disk in `LiveInference.__init__` (`training/config.MODELS_DIR`).
There is no hot-reload, so new `.joblib` files require the restart in step 3.

Verify after deploying:

```sql
SELECT player_id, features->>'USG_w10_mean' FROM fs_player_vectors LIMIT 5;
```

Missing keys or `NULL` means the refresh ran against the old code — redeploy, re-run.

## Tests

```bash
uv run pytest model_stats_inference/serving/      # hermetic, no network
```
