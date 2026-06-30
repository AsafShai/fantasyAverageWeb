import { Fragment, useRef, useState } from 'react';
import {
  useGetSimUpcomingQuery,
  useInitSimMutation,
  useAdvanceSimMutation,
  usePredictSimPlayerMutation,
} from '../store/api/fantasyApi';
import type { PlayerPrediction, EvalRow } from '../types/simulation';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';

// [statKey, columnLabel]
const STAT_COLS: [string, string][] = [
  ['PTS', 'PTS'], ['REB', 'REB'], ['AST', 'AST'],
  ['FG3M', '3PM'], ['STL', 'STL'], ['BLK', 'BLK'],
];

// Columns of the Results (eval) table, in display order. A column with mKey/aKey
// is a percentage column (rate + fraction, binomial color); the rest are counts
// (colored by the learned per-stat σ). Drives the header, body, and column picker.
type EvalCol = { key: string; label: string; mKey?: string; aKey?: string };
const EVAL_COLS: EvalCol[] = [
  { key: 'PTS', label: 'PTS' }, { key: 'REB', label: 'REB' }, { key: 'AST', label: 'AST' },
  { key: 'FG3M', label: '3PM' }, { key: 'STL', label: 'STL' }, { key: 'BLK', label: 'BLK' },
  { key: 'FGM', label: 'FG made' }, { key: 'FGA', label: 'FG taken' },
  { key: 'FTM', label: 'FT made' }, { key: 'FTA', label: 'FT taken' },
  { key: 'FG_PCT', label: 'FG%', mKey: 'FGM', aKey: 'FGA' },
  { key: 'FT_PCT', label: 'FT%', mKey: 'FTM', aKey: 'FTA' },
];

const fmt = (n: number | undefined, d = 1) => (n == null ? '—' : n.toFixed(d));
const pct = (n: number | undefined) => (n == null ? '—' : `${(n * 100).toFixed(1)}%`);

// Percentage + makes/attempts for the Results table FG%/FT% columns. The fraction
// follows the display mode — whole numbers in integer mode, one decimal otherwise.
// In integer mode the % is implied by the rounded makes/attempts; 0 attempts → none.
function pctParts(get: (k: string) => number | undefined, key: string, mKey: string, aKey: string, integer: boolean) {
  const mRaw = get(mKey) ?? 0, aRaw = get(aKey) ?? 0;
  if (!(aRaw > 0)) return { pct: '—', m: '', a: '', ok: false };
  if (integer) {
    const m = Math.round(mRaw), a = Math.round(aRaw);
    if (a <= 0) return { pct: '—', m: '', a: '', ok: false };
    return { pct: `${Math.round((m / a) * 100)}%`, m: String(m), a: String(a), ok: true };
  }
  return { pct: pct(get(key)), m: mRaw.toFixed(1), a: aRaw.toFixed(1), ok: true };
}

// Vertical fraction: attempts stacked under makes (narrower than "9/18").
function VFrac({ m, a }: { m: string; a: string }) {
  return (
    <span className="inline-flex flex-col items-center leading-[0.85] text-[10px] align-middle ml-1 text-gray-500 dark:text-gray-400">
      <span>{m}</span>
      <span className="border-t border-current px-0.5">{a}</span>
    </span>
  );
}

// Integer PTS derived from the rounded shooting components, so the displayed whole
// numbers satisfy PTS = 2·FGM + FG3M + FTM exactly (independent rounding can break
// it). `get` reads a stat value from either a StatCell map or a plain number map.
function ptsIntFromComponents(get: (k: string) => number | undefined): number | null {
  const fgm = get('FGM'), fg3 = get('FG3M'), ftm = get('FTM');
  if (fgm == null || fg3 == null || ftm == null) return null;
  return 2 * Math.round(fgm) + Math.round(fg3) + Math.round(ftm);
}

// Render an FG%/FT% cell: a percentage plus the (makes/attempts) behind it.
// In integer mode the makes/attempts are whole numbers (int/int) and the % is
// recomputed from them so the two agree; 0 attempts → '—' (rate undefined).
function shootingCell(
  pctVal: number | undefined,
  made: number | undefined,
  att: number | undefined,
  integer: boolean,
): { pct: string; frac: string | null } {
  if (made == null || att == null) return { pct: pct(pctVal), frac: null };
  if (integer) {
    const m = Math.round(made), a = Math.round(att);
    return { pct: a > 0 ? `${Math.round((m / a) * 100)}%` : '—', frac: `${m}/${a}` };
  }
  return { pct: pct(pctVal), frac: `${made.toFixed(1)}/${att.toFixed(1)}` };
}

// Predicted-vs-actual cell coloring thresholds, in units of the per-stat σ
// (Pearson residual spread) learned during validation. Tune here only — the
// coloring logic reads these and never hardcodes numbers.
const EVAL_SIGMA_BANDS = {
  GREEN_MAX: 0.6,    // |z| ≤ GREEN_MAX        → green
  ORANGE_MAX: 1.2,   // GREEN_MAX < |z| ≤ ORANGE_MAX → orange, else red
};

// Map a σ-distance to a color band. Shared by the count and percentage colorers.
function bandClass(z: number) {
  return z <= EVAL_SIGMA_BANDS.GREEN_MAX ? 'text-green-600 dark:text-green-400'
    : z <= EVAL_SIGMA_BANDS.ORANGE_MAX ? 'text-amber-600 dark:text-amber-400'
    : 'text-red-600 dark:text-red-400';
}

// Color a counting-stat cell by the magnitude-normalized (Pearson) residual,
// standardized by the learned per-stat σ. No magic numbers — thresholds live in
// EVAL_SIGMA_BANDS above.
function evalColor(pred: number | undefined, actual: number | undefined, sigma: number | undefined) {
  if (pred == null || actual == null || !sigma || sigma <= 0) return { cls: '', z: null as number | null };
  const m = Math.abs(actual - pred) / Math.sqrt(Math.max(pred, 0) + 1);
  const z = m / sigma;
  return { cls: bandClass(z), z };
}

// Color an FG%/FT% cell by how many binomial standard errors the predicted rate is
// from the actual, at the game's real attempt volume — so a miss on 3 attempts is
// forgiven and the same miss on 15 attempts is flagged. Same σ-band thresholds.
function evalColorPct(pred: number | undefined, actual: number | undefined, attempts: number | undefined) {
  if (pred == null || actual == null || !attempts || attempts <= 0) return { cls: '', z: null as number | null };
  const p = Math.min(0.999, Math.max(0.001, pred));
  const se = Math.sqrt((p * (1 - p)) / attempts);
  if (se <= 0) return { cls: '', z: null as number | null };
  const z = Math.abs(actual - pred) / se;
  return { cls: bandClass(z), z };
}

export default function Simulation() {
  const { data, isLoading, isFetching, error } = useGetSimUpcomingQuery();
  const [initSim, { isLoading: initing }] = useInitSimMutation();
  const [advanceSim, { isLoading: advancing }] = useAdvanceSimMutation();
  const [predictPlayer] = usePredictSimPlayerMutation();

  const [minutesById, setMinutesById] = useState<Record<number, number>>({});
  const [overrideById, setOverrideById] = useState<Record<number, PlayerPrediction>>({});
  const [openReason, setOpenReason] = useState<number | null>(null);
  const [integerMode, setIntegerMode] = useState(true);    // display estimates as whole numbers (default on)
  // Default: show every column except the FG%/FT% rate columns (the count columns
  // already carry makes/attempts); the user can add them from the picker.
  const [visibleCols, setVisibleCols] = useState<Set<string>>(() => new Set(EVAL_COLS.filter((c) => !c.mKey).map((c) => c.key)));
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const toggleCol = (key: string) =>
    setVisibleCols((s) => {
      const n = new Set(s);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });

  const resetLocal = () => { setMinutesById({}); setOverrideById({}); setOpenReason(null); };

  const onSlider = (pid: number, minutes: number) => {
    setMinutesById((m) => ({ ...m, [pid]: minutes }));
    clearTimeout(timers.current[pid]);
    timers.current[pid] = setTimeout(async () => {
      try {
        const p = await predictPlayer({ player_id: pid, minutes }).unwrap();
        setOverrideById((o) => ({ ...o, [pid]: p }));
      } catch { /* ignore transient predict errors */ }
    }, 350);
  };

  const onAdvance = async () => {
    // Server records the results; the upcoming query refetches and carries them
    // in `last_results`, so the panel survives tab navigation.
    try { await advanceSim().unwrap(); resetLocal(); } catch { /* */ }
  };
  const onReset = async () => {
    try { await initSim().unwrap(); resetLocal(); } catch { /* */ }
  };

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message="Failed to load the simulation. Make sure the backend is running and models are trained." />;

  const state = data?.state;
  const preds = data?.predictions ?? [];
  const lastResults = data?.last_results ?? null;
  const residSigma = data?.resid_sigma ?? {};
  const card = 'bg-white dark:bg-gray-900 shadow-lg rounded-lg border border-gray-200 dark:border-gray-700';

  // One Results-table cell: percentage column (rate + fraction, binomial color) or a
  // count column (colored by learned σ; PTS derived from components in integer mode).
  const tdGrid = 'px-2.5 py-2 text-right tabular-nums whitespace-nowrap border-l border-gray-200 dark:border-gray-700';
  const renderEvalCell = (c: EvalCol, e: EvalRow) => {
    if (c.mKey) {  // percentage column — rate + vertical makes/attempts fraction
      const { cls, z } = evalColorPct(e.predicted[c.key], e.actual[c.key], e.actual[c.aKey!]);
      const p = pctParts((k) => e.predicted[k], c.key, c.mKey, c.aKey!, integerMode);
      const a = pctParts((k) => e.actual[k], c.key, c.mKey, c.aKey!, integerMode);
      return (
        <td key={c.key} title={z == null ? 'no attempts — rate undefined' : `${z.toFixed(2)}σ (binomial, ${(e.actual[c.aKey!] ?? 0).toFixed(0)} att)`}
            className={`${tdGrid} ${cls || 'text-gray-400 dark:text-gray-500'}`}>
          <span className="inline-flex items-center justify-end gap-0.5">
            {p.pct}{p.ok && <VFrac m={p.m} a={p.a} />}
            <span className="text-gray-400 mx-0.5">→</span>
            <span className="font-semibold inline-flex items-center">{a.pct}{a.ok && <VFrac m={a.m} a={a.a} />}</span>
          </span>
        </td>
      );
    }
    const pr = e.predicted[c.key]; const ac = e.actual[c.key];
    const { cls, z } = evalColor(pr, ac, residSigma[c.key]);
    const intPts = integerMode && c.key === 'PTS' ? ptsIntFromComponents((k) => e.predicted[k]) : null;
    return (
      <td key={c.key} title={z == null ? undefined : `${z.toFixed(2)}σ (learned scale)`}
          className={`${tdGrid} ${cls || 'text-gray-400 dark:text-gray-500'}`}>
        {intPts != null ? intPts : fmt(pr, integerMode ? 0 : 1)} → <span className="font-semibold">{fmt(ac, 0)}</span>
      </td>
    );
  };
  const shownCols = EVAL_COLS.filter((c) => visibleCols.has(c.key));

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Model Simulation</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Replay a season day-by-day. The feature store only knows games before the next game day —
          predict the upcoming slate, then advance to reveal real results.
        </p>
      </div>

      {/* Control bar */}
      <div className={`${card} p-4 flex flex-wrap items-center gap-4`}>
        <Stat label="Season" value={state?.season ?? '—'} />
        <Stat label="Current date" value={state?.current_date ?? '— (season start)'} />
        <Stat label="Next game day" value={state?.next_game_day ?? '— (finished)'} />
        <Stat label="Progress" value={state ? `${state.day_index} / ${state.total_days} days` : '—'} />
        <Stat label="Games" value={String(state?.num_games ?? 0)} />
        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer select-none" title="Round estimates to whole numbers (display only — the model still computes decimals)">
            <input
              type="checkbox"
              checked={integerMode}
              onChange={(e) => setIntegerMode(e.target.checked)}
              className="accent-blue-600"
            />
            Integer estimates
          </label>
          <button
            onClick={onReset}
            disabled={initing}
            className="px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
          >
            {initing ? 'Resetting…' : 'Reset to start'}
          </button>
          <button
            onClick={onAdvance}
            disabled={advancing || state?.finished}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {advancing ? 'Advancing…' : state?.finished ? 'Season finished' : 'Advance day ▶'}
          </button>
        </div>
      </div>

      {/* Upcoming predictions */}
      <div className={card}>
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900 dark:text-white">
            Predicted lines for {state?.next_game_day ?? '—'}
          </h2>
          {isFetching && <span className="text-xs text-gray-400">updating…</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
              <tr>
                <th className="px-3 py-2 w-8"></th>
                <th className="text-left px-3 py-2">Player</th>
                <th className="text-left px-3 py-2">Matchup</th>
                <th className="px-3 py-2 w-56">Minutes (t)</th>
                {STAT_COLS.map(([, label]) => <th key={label} className="px-3 py-2 text-right">{label}</th>)}
                <th className="px-3 py-2 text-right">FG%</th>
                <th className="px-3 py-2 text-right">FT%</th>
              </tr>
            </thead>
            <tbody>
              {preds.map((base) => {
                const p = overrideById[base.player_id] ?? base;
                const minutes = minutesById[base.player_id] ?? base.default_minutes;
                const open = openReason === base.player_id;
                const toggle = () => setOpenReason(open ? null : base.player_id);
                const reasonRow = open && base.reason ? (
                  <tr className="bg-amber-50 dark:bg-amber-900/20">
                    <td></td>
                    <td colSpan={STAT_COLS.length + 5} className="px-3 py-2 text-xs text-amber-800 dark:text-amber-300">{base.reason}</td>
                  </tr>
                ) : null;

                if (!base.eligible) {
                  return (
                    <Fragment key={base.player_id}>
                      <tr className="border-t border-gray-100 dark:border-gray-800 text-gray-400">
                        <td className="px-3 py-2 text-center"><StatusDot status="red" onClick={toggle} /></td>
                        <td className="px-3 py-2">{base.player_name}</td>
                        <td className="px-3 py-2">{base.team_abbr} {base.is_home ? 'vs' : '@'} {base.opponent_abbr}</td>
                        <td className="px-3 py-2 italic" colSpan={STAT_COLS.length + 3}>no prediction — insufficient history (click ●)</td>
                      </tr>
                      {reasonRow}
                    </Fragment>
                  );
                }
                return (
                  <Fragment key={base.player_id}>
                    <tr className="border-t border-gray-100 dark:border-gray-800 text-gray-900 dark:text-gray-100">
                      <td className="px-3 py-2 text-center"><StatusDot status={base.status} onClick={toggle} /></td>
                      <td className="px-3 py-2 font-medium whitespace-nowrap">{base.player_name}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-500 dark:text-gray-400">
                        {base.team_abbr} {base.is_home ? 'vs' : '@'} {base.opponent_abbr}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="range" min={0} max={44} step={1} value={Math.round(minutes)}
                            onChange={(e) => onSlider(base.player_id, Number(e.target.value))}
                            className="w-32 accent-blue-600"
                          />
                          <span className="tabular-nums w-8 text-right">{Math.round(minutes)}</span>
                        </div>
                      </td>
                      {STAT_COLS.map(([key]) => {
                        const intPts = integerMode && key === 'PTS' ? ptsIntFromComponents((k) => p.stats[k]?.value) : null;
                        return (
                          <td key={key} className="px-2 py-2 text-right tabular-nums whitespace-nowrap">
                            {intPts != null ? intPts : fmt(p.stats[key]?.value, integerMode ? 0 : 1)}
                          </td>
                        );
                      })}
                      {([['FG_PCT', 'FGM', 'FGA'], ['FT_PCT', 'FTM', 'FTA']] as const).map(([key, mKey, aKey]) => {
                        const v = p.stats[key]?.value;
                        const f = shootingCell(v, p.stats[mKey]?.value, p.stats[aKey]?.value, integerMode);
                        return (
                          <td key={key} className="px-2 py-2 text-right tabular-nums whitespace-nowrap">
                            {f.pct}
                            {f.frac && <span className="text-gray-400 dark:text-gray-500 text-xs"> ({f.frac})</span>}
                          </td>
                        );
                      })}
                    </tr>
                    {reasonRow}
                  </Fragment>
                );
              })}
              {preds.length === 0 && (
                <tr><td colSpan={STAT_COLS.length + 6} className="px-3 py-6 text-center text-gray-400">
                  No upcoming games {state?.finished ? '— season finished.' : '.'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 text-xs text-gray-400 flex flex-wrap items-center gap-4">
          <span>Drag the minutes slider to rescale a projection.</span>
          <span className="flex items-center gap-1"><Dot className="bg-green-500" /> confident</span>
          <span className="flex items-center gap-1"><Dot className="bg-amber-500" /> stale/thin recent form — click for why</span>
          <span className="flex items-center gap-1"><Dot className="bg-red-500" /> no prediction (insufficient history)</span>
        </div>
      </div>

      {/* Evaluation of the day we just advanced past (from the server, so it
          survives navigating away and back). */}
      {lastResults && lastResults.evaluations.length > 0 && (
        <div className={card}>
          <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700">
            <h2 className="font-semibold text-gray-900 dark:text-white">
              Results for {lastResults.played_date} — model vs actual (using real minutes)
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">Each cell shows <span className="tabular-nums">pred → actual</span>. Pick stats to focus the table:</p>
            {/* Column picker — focus on one or a few stats. */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {EVAL_COLS.map((c) => {
                const on = visibleCols.has(c.key);
                return (
                  <button key={c.key} onClick={() => toggleCol(c.key)}
                    className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${on
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-transparent text-gray-500 dark:text-gray-400 border-gray-300 dark:border-gray-600 hover:border-blue-400'}`}>
                    {c.label}
                  </button>
                );
              })}
              <button onClick={() => setVisibleCols(new Set(EVAL_COLS.map((c) => c.key)))}
                className="px-2 py-0.5 rounded-full text-xs text-blue-600 dark:text-blue-400 hover:underline">All</button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border-collapse">
              <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="text-left px-3 py-2 sticky left-0 bg-gray-50 dark:bg-gray-800 z-10">Player</th>
                  <th className="px-2.5 py-2 text-right border-l border-gray-200 dark:border-gray-700">Min</th>
                  {shownCols.map((c) => <th key={c.key} className="px-2.5 py-2 text-right whitespace-nowrap border-l border-gray-200 dark:border-gray-700">{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {lastResults.evaluations.filter((e) => e.eligible).map((e) => (
                  <tr key={e.player_id} className="border-t border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 hover:bg-blue-50/40 dark:hover:bg-gray-800/40">
                    <td className="px-3 py-2 font-medium whitespace-nowrap sticky left-0 bg-white dark:bg-gray-900 z-10">
                      {e.player_name} <span className="text-gray-400">{e.team_abbr} {e.is_home ? 'vs' : '@'} {e.opponent_abbr}</span>
                    </td>
                    <td className="px-2.5 py-2 text-right tabular-nums border-l border-gray-200 dark:border-gray-700">{e.real_minutes.toFixed(0)}</td>
                    {shownCols.map((c) => renderEvalCell(c, e))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-xs text-gray-400">
            Cell color = how far the miss is in <em>expected spreads</em> for that stat, using a
            per-stat scale learned from validation (Pearson residual). <span className="text-green-600 dark:text-green-400">green</span> ≤ {EVAL_SIGMA_BANDS.GREEN_MAX}σ ·
            <span className="text-amber-600 dark:text-amber-400"> orange</span> ≤ {EVAL_SIGMA_BANDS.ORANGE_MAX}σ ·
            <span className="text-red-600 dark:text-red-400"> red</span> &gt; {EVAL_SIGMA_BANDS.ORANGE_MAX}σ. Hover a cell for its σ-distance.
            FG%/FT% are colored by a <em>binomial</em> spread at that game's attempt volume, so low-attempt percentages are forgiven.
          </p>
        </div>
      )}
    </div>
  );
}

function Dot({ className }: { className: string }) {
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${className}`} />;
}

function StatusDot({ status, onClick }: { status: 'green' | 'orange' | 'red'; onClick: () => void }) {
  const color = status === 'green' ? 'bg-green-500' : status === 'orange' ? 'bg-amber-500' : 'bg-red-500';
  if (status === 'green') return <Dot className={color} />;
  return (
    <button
      onClick={onClick}
      title="click for why"
      className={`inline-block w-2.5 h-2.5 rounded-full ${color} hover:ring-2 hover:ring-offset-1 hover:ring-gray-300 dark:hover:ring-gray-600`}
    />
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-gray-400">{label}</div>
      <div className="font-semibold text-gray-900 dark:text-white">{value}</div>
    </div>
  );
}
