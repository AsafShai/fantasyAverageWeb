-- Roster by day (team page, Daily mode). A lazy cache of past scoring periods:
-- nothing backfills it; the first request for a past day fetches ESPN once and
-- stores that day for every team, later requests read it from here. Today is
-- never stored (lineups and moves can still change until the day is over).
--
-- One row per rostered player per scoring period, trimmed to what the table
-- shows: the slot at lock and that day's stat line. ~190 rows per period for a
-- 12-team league; measured ~10 MB per season including the primary key.
--
-- stats: the single-day line as a fixed-order array, compact on purpose (a
-- JSONB object with key names was ~2x the size). Order:
--   minutes, fgm, fga, ftm, fta, three_pm, reb, ast, stl, blk, pts, to
-- NULL = ESPN had no line that day (his team did not play); {} = a line
-- without numbers (did not play).
CREATE TABLE IF NOT EXISTS fantasy_roster_day (
    league_id         BIGINT   NOT NULL,
    season_id         INT      NOT NULL,
    scoring_period_id INT      NOT NULL,
    team_id           INT      NOT NULL,
    player_id         BIGINT   NOT NULL,
    player_name       TEXT     NOT NULL DEFAULT '',
    positions         TEXT     NOT NULL DEFAULT '',
    pro_team_id       SMALLINT NOT NULL DEFAULT 0,
    lineup_slot       TEXT     NOT NULL,
    stats             REAL[],
    PRIMARY KEY (league_id, season_id, scoring_period_id, team_id, player_id)
);

-- Adds, drops and trades, every team, keyed by the scoring period ESPN files
-- them under. Small (a few per day); kept so a past day's moves strip and
-- Added/Dropped tags never need ESPN again.
CREATE TABLE IF NOT EXISTS fantasy_roster_moves (
    league_id         BIGINT      NOT NULL,
    season_id         INT         NOT NULL,
    scoring_period_id INT         NOT NULL,
    tx_id             TEXT        NOT NULL,
    kind              TEXT        NOT NULL,   -- FREEAGENT | WAIVER | TRADE_ACCEPT
    at                TIMESTAMPTZ NOT NULL,
    items             JSONB       NOT NULL,   -- [{type, player_id, from_team_id, to_team_id}]
    PRIMARY KEY (league_id, season_id, scoring_period_id, tx_id)
);

-- Which periods are stored completely, per kind ('roster' | 'moves'), so a day
-- that failed half-way through a write is fetched again rather than served short.
CREATE TABLE IF NOT EXISTS fantasy_roster_period_saved (
    league_id         BIGINT      NOT NULL,
    season_id         INT         NOT NULL,
    scoring_period_id INT         NOT NULL,
    kind              TEXT        NOT NULL,
    saved_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (league_id, season_id, scoring_period_id, kind)
);
