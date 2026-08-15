-- Scope league-specific tables by league_id + season_id. Without this, a DB
-- fallback (ESPN unreachable, or a not-yet-started season with no real ESPN
-- data) silently serves whichever league/season happened to write last —
-- e.g. the real league's April snapshot leaking into a demo-league session.
--
-- Existing rows predate this column and all belong to the real league/season
-- in play at the time they were written — backfilled accordingly below.

-- team_daily_snapshot
ALTER TABLE team_daily_snapshot ADD COLUMN IF NOT EXISTS league_id BIGINT;
ALTER TABLE team_daily_snapshot ADD COLUMN IF NOT EXISTS season_id INT;
UPDATE team_daily_snapshot SET league_id = 660330196, season_id = 2026 WHERE league_id IS NULL;
ALTER TABLE team_daily_snapshot ALTER COLUMN league_id SET NOT NULL;
ALTER TABLE team_daily_snapshot ALTER COLUMN season_id SET NOT NULL;
ALTER TABLE team_daily_snapshot DROP CONSTRAINT IF EXISTS team_daily_snapshot_pkey;
ALTER TABLE team_daily_snapshot ADD PRIMARY KEY (league_id, season_id, scoring_period_id, team_id);

-- team_rankings_averages
ALTER TABLE team_rankings_averages ADD COLUMN IF NOT EXISTS league_id BIGINT;
ALTER TABLE team_rankings_averages ADD COLUMN IF NOT EXISTS season_id INT;
UPDATE team_rankings_averages SET league_id = 660330196, season_id = 2026 WHERE league_id IS NULL;
ALTER TABLE team_rankings_averages ALTER COLUMN league_id SET NOT NULL;
ALTER TABLE team_rankings_averages ALTER COLUMN season_id SET NOT NULL;
ALTER TABLE team_rankings_averages DROP CONSTRAINT IF EXISTS team_rankings_averages_pkey;
ALTER TABLE team_rankings_averages ADD PRIMARY KEY (league_id, season_id, scoring_period_id, team_id);

-- team_rankings_totals
ALTER TABLE team_rankings_totals ADD COLUMN IF NOT EXISTS league_id BIGINT;
ALTER TABLE team_rankings_totals ADD COLUMN IF NOT EXISTS season_id INT;
UPDATE team_rankings_totals SET league_id = 660330196, season_id = 2026 WHERE league_id IS NULL;
ALTER TABLE team_rankings_totals ALTER COLUMN league_id SET NOT NULL;
ALTER TABLE team_rankings_totals ALTER COLUMN season_id SET NOT NULL;
ALTER TABLE team_rankings_totals DROP CONSTRAINT IF EXISTS team_rankings_totals_pkey;
ALTER TABLE team_rankings_totals ADD PRIMARY KEY (league_id, season_id, scoring_period_id, team_id);

-- estimator_prediction (was PRIMARY KEY (team_id) — one row per team, overwritten
-- each run; now scoped so a different league/season doesn't clobber another's row)
ALTER TABLE estimator_prediction ADD COLUMN IF NOT EXISTS league_id BIGINT;
ALTER TABLE estimator_prediction ADD COLUMN IF NOT EXISTS season_id INT;
UPDATE estimator_prediction SET league_id = 660330196, season_id = 2026 WHERE league_id IS NULL;
ALTER TABLE estimator_prediction ALTER COLUMN league_id SET NOT NULL;
ALTER TABLE estimator_prediction ALTER COLUMN season_id SET NOT NULL;
ALTER TABLE estimator_prediction DROP CONSTRAINT IF EXISTS estimator_prediction_pkey;
ALTER TABLE estimator_prediction ADD PRIMARY KEY (league_id, season_id, team_id);

-- estimator_ranking
ALTER TABLE estimator_ranking ADD COLUMN IF NOT EXISTS league_id BIGINT;
ALTER TABLE estimator_ranking ADD COLUMN IF NOT EXISTS season_id INT;
UPDATE estimator_ranking SET league_id = 660330196, season_id = 2026 WHERE league_id IS NULL;
ALTER TABLE estimator_ranking ALTER COLUMN league_id SET NOT NULL;
ALTER TABLE estimator_ranking ALTER COLUMN season_id SET NOT NULL;
ALTER TABLE estimator_ranking DROP CONSTRAINT IF EXISTS estimator_ranking_pkey;
ALTER TABLE estimator_ranking ADD PRIMARY KEY (league_id, season_id, team_id);

-- estimator_rank_probability (was PRIMARY KEY (team_id, rank))
ALTER TABLE estimator_rank_probability ADD COLUMN IF NOT EXISTS league_id BIGINT;
ALTER TABLE estimator_rank_probability ADD COLUMN IF NOT EXISTS season_id INT;
UPDATE estimator_rank_probability SET league_id = 660330196, season_id = 2026 WHERE league_id IS NULL;
ALTER TABLE estimator_rank_probability ALTER COLUMN league_id SET NOT NULL;
ALTER TABLE estimator_rank_probability ALTER COLUMN season_id SET NOT NULL;
ALTER TABLE estimator_rank_probability DROP CONSTRAINT IF EXISTS estimator_rank_probability_pkey;
ALTER TABLE estimator_rank_probability ADD PRIMARY KEY (league_id, season_id, team_id, rank);
