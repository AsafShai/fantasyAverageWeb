import { Fragment, useRef, useState } from 'react';
import {
  useGetSimUpcomingQuery,
  useInitSimMutation,
  useAdvanceSimMutation,
  usePredictSimPlayerMutation,
} from '../store/api/fantasyApi';
import type { PlayerPrediction } from '../types/simulation';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';

// [statKey, columnLabel]
const STAT_COLS: [string, string][] = [
  ['PTS', 'PTS'], ['REB', 'REB'], ['AST', 'AST'],
  ['FG3M', '3PM'], ['STL', 'STL'], ['BLK', 'BLK'],
];

const fmt = (n: number | undefined, d = 1) => (n == null ? '—' : n.toFixed(d));
const pct = (n: number | undefined) => (n == null ? '—' : `${(n * 100).toFixed(1)}%`);

// Predicted-vs-actual cell coloring thresholds, in units of the per-stat σ
// (Pearson residual spread) learned during validation. Tune here only — the
// coloring logic reads these and never hardcodes numbers.
const EVAL_SIGMA_BANDS = {
  GREEN_MAX: 0.75,   // |z| ≤ GREEN_MAX        → green
  ORANGE_MAX: 2.0,   // GREEN_MAX < |z| ≤ ORANGE_MAX → orange, else red
};

// Color a predicted-vs-actual cell by the magnitude-normalized (Pearson) residual,
// standardized by the learned per-stat σ. No magic numbers — thresholds live in
// EVAL_SIGMA_BANDS above.
function evalColor(pred: number | undefined, actual: number | undefined, sigma: number | undefined) {
  if (pred == null || actual == null || !sigma || sigma <= 0) return { cls: '', z: null as number | null };
  const m = Math.abs(actual - pred) / Math.sqrt(Math.max(pred, 0) + 1);
  const z = m / sigma;
  const cls = z <= EVAL_SIGMA_BANDS.GREEN_MAX ? 'text-green-600 dark:text-green-400'
    : z <= EVAL_SIGMA_BANDS.ORANGE_MAX ? 'text-amber-600 dark:text-amber-400'
    : 'text-red-600 dark:text-red-400';
  return { cls, z };
}

export default function Simulation() {
  const { data, isLoading, isFetching, error } = useGetSimUpcomingQuery();
  const [initSim, { isLoading: initing }] = useInitSimMutation();
  const [advanceSim, { isLoading: advancing }] = useAdvanceSimMutation();
  const [predictPlayer] = usePredictSimPlayerMutation();

  const [minutesById, setMinutesById] = useState<Record<number, number>>({});
  const [overrideById, setOverrideById] = useState<Record<number, PlayerPrediction>>({});
  const [openReason, setOpenReason] = useState<number | null>(null);
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

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
        <div className="ml-auto flex gap-2">
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
                      {STAT_COLS.map(([key]) => (
                        <td key={key} className="px-3 py-2 text-right tabular-nums">{fmt(p.stats[key]?.value)}</td>
                      ))}
                      <td className="px-3 py-2 text-right tabular-nums">{pct(p.stats['FG_PCT']?.value)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{pct(p.stats['FT_PCT']?.value)}</td>
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
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                <tr>
                  <th className="text-left px-3 py-2">Player</th>
                  <th className="px-3 py-2 text-right">Min</th>
                  {STAT_COLS.map(([, label]) => <th key={label} className="px-3 py-2 text-right">{label} (pred→act)</th>)}
                </tr>
              </thead>
              <tbody>
                {lastResults.evaluations.filter((e) => e.eligible).map((e) => (
                  <tr key={e.player_id} className="border-t border-gray-100 dark:border-gray-800 text-gray-900 dark:text-gray-100">
                    <td className="px-3 py-2 font-medium whitespace-nowrap">
                      {e.player_name} <span className="text-gray-400">{e.team_abbr} {e.is_home ? 'vs' : '@'} {e.opponent_abbr}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{e.real_minutes.toFixed(0)}</td>
                    {STAT_COLS.map(([key]) => {
                      const pr = e.predicted[key]; const ac = e.actual[key];
                      const { cls, z } = evalColor(pr, ac, residSigma[key]);
                      return (
                        <td key={key} title={z == null ? undefined : `${z.toFixed(2)}σ (learned scale)`}
                            className={`px-3 py-2 text-right tabular-nums ${cls}`}>
                          {fmt(pr)} → <span className="font-semibold">{fmt(ac, 0)}</span>
                        </td>
                      );
                    })}
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
