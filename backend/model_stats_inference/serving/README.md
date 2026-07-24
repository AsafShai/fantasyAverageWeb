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

## Tests

```bash
uv run pytest model_stats_inference/serving/      # hermetic, no network
```
