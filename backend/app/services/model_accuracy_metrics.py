"""Pure accuracy math for the Model vs. Reality page — no I/O, so every number
the page shows can be tested from a hand-built frame.

Both modes are normalized to one frame shape before anything here runs:
``pred_<s>`` / ``base_<s>`` / ``actual_<s>`` for every stat in STATS, plus
``pred_fg_pct`` / ``pred_ft_pct`` (fractions), ``proj_min`` / ``base_min`` /
``actual_min``, ``outcome`` ('played' | 'dnp'), ``game_date`` (date),
``player_id``, ``player_name``, ``actual_pf``, ``team_margin``,
``injury_status``. Retro rows carry NaN where pre-game-only fields don't apply.
"""

from __future__ import annotations

import math
from datetime import date, timedelta
from typing import Optional

import numpy as np
import pandas as pd

from app.utils.team_abbr_map import TEAM_ID_TO_ABBR

STATS = ['pts', 'reb', 'ast', 'fg3m', 'stl', 'blk', 'fgm', 'fga', 'ftm', 'fta']

# (key, label, hit band). The band is the "within X" for the hit rate — counting
# stats in their own units, FG%/FT% in percentage points.
CATEGORIES: list[tuple[str, str, float]] = [
    ('pts', 'PTS', 4),
    ('reb', 'REB', 2),
    ('ast', 'AST', 2),
    ('fg3m', '3PM', 1),
    ('stl', 'STL', 1),
    ('blk', 'BLK', 1),
    ('fg_pct', 'FG%', 10),
    ('ft_pct', 'FT%', 15),
]
MINUTES_BAND = 5.0
COUNTING = ['pts', 'reb', 'ast', 'fg3m', 'stl', 'blk']
# A single game's FG%/FT% is noise below this many attempts.
FG_MIN_ATTEMPTS = 5
FT_MIN_ATTEMPTS = 2

# Rough per-game spread of each counting stat for a rotation player: the unit
# that turns "missed by 6 points and 2 steals" into one comparable number.
Z_SCALE = {'pts': 6.5, 'reb': 3.0, 'ast': 2.2, 'fg3m': 1.3, 'stl': 0.9, 'blk': 0.8}

# Beating / trailing: at least this many of the last games went one way, and
# the average composite is beyond the threshold.
FLAG_GAMES = 8
FLAG_MIN_SAME_SIDE = 5
FLAG_AVG_THRESHOLD = 0.5

MINUTES_GAP = 8.0
BLOWOUT_MARGIN = 20.0
BLOWOUT_MIN_SHORT = 5.0
FOUL_TROUBLE_PF = 5
SHOOTING_FG_PCT_GAP = 15.0
SHOOTING_FG3M_GAP = 3.0


def _abbr(team_id) -> str:
    return TEAM_ID_TO_ABBR.get(int(team_id), '')


def season_start_for(day: date) -> date:
    """NBA seasons straddle the new year; Aug 1 is safely between two of them."""
    year = day.year if day.month >= 8 else day.year - 1
    return date(year, 8, 1)


def week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


def window_bounds(window: str, latest: date) -> tuple[date, date]:
    """[start, end] for a window, anchored on the newest date that has data
    (so 'This week' early on a Monday still shows last week rather than nothing)."""
    if window == 'week':
        return week_start(latest), latest
    if window == 'd30':
        return latest - timedelta(days=29), latest
    return season_start_for(latest), latest


def _f(v) -> Optional[float]:
    if v is None:
        return None
    v = float(v)
    return None if math.isnan(v) else v


def _pct_triplet(df: pd.DataFrame, made: str, att: str, min_att: int, pred_col: str):
    """(pred, base, actual) in percentage points for games with enough attempts."""
    rows = df[df[f'actual_{att}'] >= min_att]
    actual = rows[f'actual_{made}'] / rows[f'actual_{att}'] * 100
    pred = rows[pred_col] * 100
    with np.errstate(divide='ignore', invalid='ignore'):
        base = rows[f'base_{made}'] / rows[f'base_{att}'].where(rows[f'base_{att}'] > 0) * 100
    return pred, base, actual


def _triplet(df: pd.DataFrame, key: str):
    if key == 'fg_pct':
        return _pct_triplet(df, 'fgm', 'fga', FG_MIN_ATTEMPTS, 'pred_fg_pct')
    if key == 'ft_pct':
        return _pct_triplet(df, 'ftm', 'fta', FT_MIN_ATTEMPTS, 'pred_ft_pct')
    if key == 'min':
        return df['proj_min'], df['base_min'], df['actual_min']
    return df[f'pred_{key}'], df[f'base_{key}'], df[f'actual_{key}']


def error_stats(df: pd.DataFrame, key: str, band: float) -> dict:
    """Model and baseline MAE over the games where both exist (same games for
    both, so the comparison is fair), plus the model's within-band hit rate."""
    pred, base, actual = _triplet(df, key)
    ok = pred.notna() & base.notna() & actual.notna()
    n = int(ok.sum())
    if n == 0:
        return {'model_mae': None, 'baseline_mae': None, 'hit_rate': None, 'games': 0}
    model_err = (pred[ok] - actual[ok]).abs()
    base_err = (base[ok] - actual[ok]).abs()
    return {
        'model_mae': round(float(model_err.mean()), 3),
        'baseline_mae': round(float(base_err.mean()), 3),
        'hit_rate': round(float((model_err <= band + 1e-9).mean()), 4),
        'games': n,
    }


def played(df: pd.DataFrame) -> pd.DataFrame:
    return df[df['outcome'] == 'played']


def category_summary(df: pd.DataFrame) -> list[dict]:
    rows = played(df)
    return [
        {'key': key, 'label': label, 'band': band, **error_stats(rows, key, band)}
        for key, label, band in CATEGORIES
    ]


def minutes_summary(df: pd.DataFrame) -> dict:
    return {'key': 'min', 'label': 'MIN', 'band': MINUTES_BAND, **error_stats(played(df), 'min', MINUTES_BAND)}


def weekly(df: pd.DataFrame) -> list[dict]:
    rows = played(df)
    if rows.empty:
        return []
    weeks = rows['game_date'].map(week_start)
    out = []
    for wk, group in rows.groupby(weeks):
        cats = {}
        for key, _, band in CATEGORIES:
            s = error_stats(group, key, band)
            cats[key] = {'model_mae': s['model_mae'], 'baseline_mae': s['baseline_mae']}
        out.append({'week_start': wk.isoformat(), 'games': int(len(group)), 'categories': cats})
    return out


def composite(df: pd.DataFrame) -> pd.Series:
    """Signed per-game miss in spread units, summed over the counting stats:
    positive = the player beat his projection. A DNP counts as all zeros."""
    total = pd.Series(0.0, index=df.index)
    for s in COUNTING:
        actual = df[f'actual_{s}'].fillna(0.0)
        total = total + (actual - df[f'pred_{s}']) / Z_SCALE[s]
    return total


def miss_reason(row: dict) -> tuple[str, str]:
    """(label, detail) for why a projection missed, in the order the data can
    prove it: no game → blowout → foul trouble → minutes → shooting → unknown."""
    proj_min = _f(row.get('proj_min')) or 0.0
    if row.get('outcome') == 'dnp':
        injury = row.get('injury_status')
        detail = f'Projected {proj_min:.0f} min'
        detail += f'; listed {injury} at snapshot' if injury else '; not on the injury report at snapshot'
        return 'DNP', detail
    actual_min = _f(row.get('actual_min')) or 0.0
    short = proj_min - actual_min
    margin = _f(row.get('team_margin'))
    pf = _f(row.get('actual_pf')) or 0.0
    if margin is not None and abs(margin) >= BLOWOUT_MARGIN and short >= BLOWOUT_MIN_SHORT:
        verb = 'Won' if margin > 0 else 'Lost'
        return 'Blowout', f'{verb} by {abs(margin):.0f}; played {actual_min:.0f} of projected {proj_min:.0f} min'
    if pf >= FOUL_TROUBLE_PF and short >= BLOWOUT_MIN_SHORT:
        return 'Foul trouble', f'{pf:.0f} PF in {actual_min:.0f} min'
    if abs(short) >= MINUTES_GAP:
        return 'Minutes gap', f'Played {actual_min:.0f} of projected {proj_min:.0f} min'
    fga = _f(row.get('actual_fga')) or 0.0
    if fga >= FG_MIN_ATTEMPTS:
        fg_pct = (_f(row.get('actual_fgm')) or 0.0) / fga * 100
        pred_pct = (_f(row.get('pred_fg_pct')) or 0.0) * 100
        if abs(fg_pct - pred_pct) >= SHOOTING_FG_PCT_GAP:
            return 'Shooting variance', f'{fg_pct:.0f}% FG vs {pred_pct:.0f}% projected; minutes on projection'
    fg3m_gap = (_f(row.get('actual_fg3m')) or 0.0) - (_f(row.get('pred_fg3m')) or 0.0)
    if abs(fg3m_gap) >= SHOOTING_FG3M_GAP:
        return 'Shooting variance', f'{_f(row.get("actual_fg3m")) or 0:.0f} threes vs {_f(row.get("pred_fg3m")) or 0:.1f} projected'
    return 'No clear cause', 'Minutes, margin and fouls all normal'


def _line(row: dict) -> list[dict]:
    """The stats worth showing for a miss: minutes plus the two counting stats
    that missed by the most spread units."""
    gaps = sorted(
        COUNTING,
        key=lambda s: -abs(((_f(row.get(f'actual_{s}')) or 0.0) - row[f'pred_{s}']) / Z_SCALE[s]),
    )[:2]
    out = [{'stat': 'MIN', 'proj': round(float(row['proj_min']), 1), 'actual': round(_f(row.get('actual_min')) or 0.0, 1)}]
    labels = {k: label for k, label, _ in CATEGORIES}
    for s in gaps:
        out.append({'stat': labels[s], 'proj': round(float(row[f'pred_{s}']), 1), 'actual': round(_f(row.get(f'actual_{s}')) or 0.0, 1)})
    return out


def biggest_misses(df: pd.DataFrame, limit: int = 6) -> list[dict]:
    if df.empty:
        return []
    df = df.assign(_z=composite(df))
    df = df.reindex(df['_z'].abs().sort_values(ascending=False).index).head(limit)
    out = []
    for row in df.to_dict('records'):
        label, detail = miss_reason(row)
        out.append({
            'player_id': int(row['player_id']),
            'player_name': row['player_name'],
            'game_date': row['game_date'].isoformat(),
            'team_id': int(row['team_id']),
            'team': _abbr(row['team_id']),
            'opponent_team_id': int(row['opponent_team_id']),
            'opponent': _abbr(row['opponent_team_id']),
            'is_home': bool(row['is_home']),
            'z': round(float(row['_z']), 2),
            'line': _line(row),
            'reason': label,
            'reason_detail': detail,
        })
    return out


def flag_for(zs: list[float]) -> str:
    recent = zs[-FLAG_GAMES:]
    if not recent:
        return 'flat'
    avg = sum(recent) / len(recent)
    ups = sum(1 for z in recent if z > 0)
    downs = len(recent) - ups
    if ups >= FLAG_MIN_SAME_SIDE and avg > FLAG_AVG_THRESHOLD:
        return 'up'
    if downs >= FLAG_MIN_SAME_SIDE and avg < -FLAG_AVG_THRESHOLD:
        return 'down'
    return 'flat'


def _games(group: pd.DataFrame) -> list[dict]:
    zs = composite(group)
    return [
        {
            'game_date': r['game_date'].isoformat(),
            'opponent_team_id': int(r['opponent_team_id']),
            'opponent': _abbr(r['opponent_team_id']),
            'z': round(float(z), 2),
            'proj_pts': round(float(r['pred_pts']), 1),
            'actual_pts': round(float(r['actual_pts']), 1),
            'proj_min': round(float(r['proj_min']), 1),
            'actual_min': round(float(r['actual_min']), 1),
        }
        for r, z in zip(group.to_dict('records'), zs)
    ]


def player_rows(df: pd.DataFrame, games: int = FLAG_GAMES, min_games: int = 3) -> list[dict]:
    """One row per player: their last `games` played games against projection.
    DNPs are left out of the strip (a missed game isn't under-performance) but
    counted, since they are still projections that didn't happen."""
    if df.empty:
        return []
    out = []
    df = df.sort_values('game_date')
    for pid, group in df.groupby('player_id'):
        games_played = played(group).tail(games)
        if len(games_played) < min_games:
            continue
        g = _games(games_played)
        out.append({
            'player_id': int(pid),
            'player_name': str(group['player_name'].iloc[-1]),
            'team_id': int(group['team_id'].iloc[-1]),
            'team': _abbr(group['team_id'].iloc[-1]),
            'games': g,
            'dnp': int((group.tail(games)['outcome'] == 'dnp').sum()),
            'proj_pts': round(float(games_played['pred_pts'].mean()), 1),
            'actual_pts': round(float(games_played['actual_pts'].mean()), 1),
            'proj_min': round(float(games_played['proj_min'].mean()), 1),
            'actual_min': round(float(games_played['actual_min'].mean()), 1),
            'flag': flag_for([x['z'] for x in g]),
        })
    out.sort(key=lambda r: r['player_name'])
    return out


def player_detail(df: pd.DataFrame, games: int = 10) -> Optional[dict]:
    """Per-category projected vs actual averages over a player's last games."""
    rows = played(df.sort_values('game_date')).tail(games)
    if rows.empty:
        return None
    cats = []
    for key, label, _ in CATEGORIES:
        if key == 'fg_pct':
            proj = rows['pred_fg_pct'].mean() * 100
            fga = rows['actual_fga'].sum()
            actual = rows['actual_fgm'].sum() / fga * 100 if fga else None
        elif key == 'ft_pct':
            proj = rows['pred_ft_pct'].mean() * 100
            fta = rows['actual_fta'].sum()
            actual = rows['actual_ftm'].sum() / fta * 100 if fta else None
        else:
            proj = rows[f'pred_{key}'].mean()
            actual = rows[f'actual_{key}'].mean()
        cats.append({
            'key': key, 'label': label,
            'proj': round(float(proj), 1),
            'actual': None if actual is None else round(float(actual), 1),
        })
    g = _games(rows)
    return {
        'games': g,
        'categories': cats,
        'proj_min': round(float(rows['proj_min'].mean()), 1),
        'actual_min': round(float(rows['actual_min'].mean()), 1),
        'beat_count': sum(1 for x in g if x['z'] > 0),
        'flag': flag_for([x['z'] for x in g]),
    }


def retro_frame(evals: pd.DataFrame, fs: pd.DataFrame) -> pd.DataFrame:
    """Normalize model_eval_results rows to the shared frame. The baseline gets
    the same advantage the retro model has — actual minutes — by scaling each
    player's last-10 per-minute rates (games before this one) by them.

    evals: model_eval_results rows (lowercase columns, eligible only).
    fs: fs_player_games rows for the same players, reaching back far enough to
    fill a 10-game window before the first eval date.
    """
    if evals.empty:
        return evals
    fs = fs[fs['min'] > 0].sort_values(['player_id', 'game_date', 'game_id'])
    roll_cols = ['min'] + STATS
    rolled = (
        fs.groupby('player_id')[roll_cols]
        .transform(lambda s: s.shift(1).rolling(10, min_periods=1).sum())
    )
    rates = fs[['player_id', 'game_id']].copy()
    for s in STATS:
        rates[f'rate_{s}'] = rolled[s] / rolled['min'].where(rolled['min'] > 0)
    out = evals.merge(rates, on=['player_id', 'game_id'], how='left')
    for s in STATS:
        out[f'base_{s}'] = out[f'rate_{s}'] * out['minutes']
    out = out.drop(columns=[f'rate_{s}' for s in STATS])
    with np.errstate(divide='ignore', invalid='ignore'):
        out['pred_fg_pct'] = out['pred_fgm'] / out['pred_fga'].where(out['pred_fga'] > 0)
        out['pred_ft_pct'] = out['pred_ftm'] / out['pred_fta'].where(out['pred_fta'] > 0)
    out['outcome'] = 'played'
    out['actual_min'] = out['minutes']
    out['proj_min'] = out['minutes']
    out['base_min'] = np.nan
    return out
