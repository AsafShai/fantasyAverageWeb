import { useMemo, useState } from 'react';
import { useGetLatestSurprisesQuery, useGetSurprisesForDateQuery, useGetSurpriseDatesQuery } from '../store/api/fantasyApi';
import type { NightSurprises, SurpriseRow } from '../types/api';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import { SurpriseTable } from '../components/boomOrBust/SurpriseTable';
import { ShareCardButton } from '../components/share/ShareCardButton';
import { BoomOrBustShareCard, SHARE_ROWS } from '../components/share/BoomOrBustShareCard';
import { buildShareMessage } from '../components/share/boomOrBustMessage';

/** Parse YYYY-MM-DD as a local calendar date (no timezone shift). */
function parseDay(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function fmtDay(s: string, withWeekday: boolean): string {
  return parseDay(s).toLocaleDateString('en-US', {
    ...(withWeekday ? { weekday: 'long' } : {}),
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** RTK reports a JSON 404 as `status: 404`, a plain-text one as PARSING_ERROR with `originalStatus: 404`. */
function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { status?: unknown; originalStatus?: unknown };
  return e.status === 404 || e.originalStatus === 404;
}

// 1.4 is already a clearly good/bad night; past 2.2 almost nobody is left.
// The server default (1.8) sits in the middle. A stored value outside the
// range (from an older range) is ignored and the default takes over.
const SLIDER_MIN = 1.4;
const SLIDER_MAX = 2.2;
const SLIDER_STEP = 0.1;
const STORAGE_KEYS = { good: 'boomOrBust.goodThreshold', bad: 'boomOrBust.badThreshold' } as const;

function readStoredThreshold(kind: 'good' | 'bad'): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS[kind]);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= SLIDER_MIN && n <= SLIDER_MAX ? n : null;
  } catch {
    return null;
  }
}

function writeStoredThreshold(kind: 'good' | 'bad', value: number | null): void {
  try {
    if (value === null) localStorage.removeItem(STORAGE_KEYS[kind]);
    else localStorage.setItem(STORAGE_KEYS[kind], value.toFixed(1));
  } catch {
    /* storage unavailable (private window, blocked site data) — the slider still works for this view */
  }
}

/** Per-viewer threshold: a stored value wins over the server default; Reset clears it. */
function useThreshold(kind: 'good' | 'bad', serverDefault: number) {
  const [override, setOverride] = useState<number | null>(() => readStoredThreshold(kind));
  const value = override ?? serverDefault;
  const set = (v: number) => {
    setOverride(v);
    writeStoredThreshold(kind, v);
  };
  const reset = () => {
    setOverride(null);
    writeStoredThreshold(kind, null);
  };
  return { value, set, reset, isDefault: override === null || Math.abs(override - serverDefault) < 1e-9 };
}

/** The threshold applies when the thumb is released, not on every tick: while
 * dragging only the label follows the thumb, so the table under the pointer
 * (and the card below it) stays put until the viewer has chosen a value.
 * Keyboard steps apply on key release, a programmatic change on the next
 * blur. */
function ThresholdSlider({
  kind, value, isDefault, onChange, onReset,
}: { kind: 'good' | 'bad'; value: number; isDefault: boolean; onChange: (v: number) => void; onReset: () => void }) {
  const id = `threshold-${kind}`;
  // null = no drag in progress: the thumb and label show the applied value
  // (so Reset, or a value restored from storage, shows at once).
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? value;
  const commit = () => {
    if (draft !== null && draft !== value) onChange(draft);
    setDraft(null);
  };
  const label = kind === 'good' ? `score ≥ ${shown.toFixed(1)}` : `score ≤ −${shown.toFixed(1)}`;
  const accent = kind === 'good' ? 'accent-blue-500' : 'accent-red-500';
  return (
    <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
      <label htmlFor={id} className="tabular-nums whitespace-nowrap">{label}</label>
      <input
        id={id}
        type="range"
        min={SLIDER_MIN}
        max={SLIDER_MAX}
        step={SLIDER_STEP}
        value={shown}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        aria-label={kind === 'good' ? 'Surprise threshold' : 'Disappointment threshold'}
        className={`w-24 sm:w-32 ${accent}`}
      />
      {!isDefault && (
        <button
          type="button"
          onClick={onReset}
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
        >
          Reset
        </button>
      )}
    </div>
  );
}

type Threshold = ReturnType<typeof useThreshold>;

/** A card pages its rows five at a time, and only when there are more than
 * five; the footer is always there so a card's chrome never changes shape. */
const PAGE_SIZE = 5;

/** The rows a card shows: every row past the viewer's threshold (the card pages them). */
function shownRows(rows: SurpriseRow[], kind: 'good' | 'bad', threshold: number): SurpriseRow[] {
  return kind === 'good' ? rows.filter((r) => r.score >= threshold) : rows.filter((r) => r.score <= -threshold);
}

function SurpriseCard({
  title, kind, threshold, shown,
}: { title: string; kind: 'good' | 'bad'; threshold: Threshold; shown: SurpriseRow[] }) {
  const [page, setPage] = useState(0);
  // A new threshold starts the card on its first page: a viewer on page 2 who
  // raises the bar and lowers it again should not land back on page 2.
  const [pagedFor, setPagedFor] = useState(threshold.value);
  if (threshold.value !== pagedFor) {
    setPagedFor(threshold.value);
    setPage(0);
  }
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);   // the slider can shrink the list under the viewer
  const start = current * PAGE_SIZE;
  const pageRows = shown.slice(start, start + PAGE_SIZE);
  const pageBtn = 'px-2 py-0.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed';
  return (
    <div className="bg-white dark:bg-gray-900 shadow-lg rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          {title} <span className="text-sm font-normal text-gray-500 dark:text-gray-400">({shown.length})</span>
        </h2>
        <ThresholdSlider
          kind={kind}
          value={threshold.value}
          isDefault={threshold.isDefault}
          onChange={threshold.set}
          onReset={threshold.reset}
        />
      </div>
      <SurpriseTable rows={pageRows} kind={kind} startRank={start + 1} />
      <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 min-h-[2.25rem]">
        {pages > 1 ? (
          <>
            <span>{start + 1}–{start + pageRows.length} of {shown.length}</span>
            <button type="button" className={pageBtn} onClick={() => setPage(current - 1)} disabled={current === 0} aria-label="Previous page">‹</button>
            <button type="button" className={pageBtn} onClick={() => setPage(current + 1)} disabled={current >= pages - 1} aria-label="Next page">›</button>
          </>
        ) : (
          <span>{shown.length === 1 ? '1 player' : `${shown.length} players`}</span>
        )}
      </div>
    </div>
  );
}

function NightBody({ night }: { night: NightSurprises }) {
  const good = useThreshold('good', night.thresholds.good);
  const bad = useThreshold('bad', night.thresholds.bad);
  const booms = useMemo(() => shownRows(night.good, 'good', good.value), [night, good.value]);
  const busts = useMemo(() => shownRows(night.bad, 'bad', bad.value), [night, bad.value]);
  const dateLabel = fmtDay(night.game_date, false);
  const shareText = useMemo(
    () => buildShareMessage(dateLabel, booms.slice(0, SHARE_ROWS), busts.slice(0, SHARE_ROWS), `${window.location.origin}/boom-or-bust`),
    [dateLabel, booms, busts],
  );
  return (
    <>
      <div className="flex justify-end">
        <ShareCardButton
          title="Boom or Bust"
          shareText={shareText}
          renderCard={({ dark }) => (
            <BoomOrBustShareCard
              dark={dark}
              dateLabel={fmtDay(night.game_date, true)}
              games={night.games}
              booms={booms}
              busts={busts}
              thresholds={{ good: good.value, bad: bad.value }}
            />
          )}
        />
      </div>
      <div className="space-y-6">
        <SurpriseCard title="💥 Booms" kind="good" threshold={good} shown={booms} />
        <SurpriseCard title="💩 Busts" kind="bad" threshold={bad} shown={busts} />
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Scores compare each player with his own history and with what the model expected for his minutes.
        Players without a model estimate yet (fewer than 10 games this season) are scored on their own history only.
        {' '}Computed {new Date(night.computed_at).toLocaleString('en-US')}.
      </p>
    </>
  );
}

export default function BoomOrBust() {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const { data: dates = [] } = useGetSurpriseDatesQuery();
  const latest = useGetLatestSurprisesQuery(undefined, { skip: selectedDate !== null });
  const forDate = useGetSurprisesForDateQuery(selectedDate ?? '', { skip: selectedDate === null });
  // currentData, not data: data keeps the previous night while the next one
  // loads, and a second ‹ click during that window would pick the same date again.
  const { currentData: night, isLoading, isFetching, error } = selectedDate === null ? latest : forDate;

  const shownDate = selectedDate ?? night?.game_date ?? null;
  const idx = shownDate ? dates.indexOf(shownDate) : -1;
  const prevDate = idx >= 0 && idx + 1 < dates.length ? dates[idx + 1] : null;
  const nextDate = idx > 0 ? dates[idx - 1] : null;
  const onLatest = selectedDate === null || (dates.length > 0 && shownDate === dates[0]);
  // "No games last night" comes from the nightly's own ledger, not the viewer's
  // clock: the newest run handled a later night than the one shown and found no
  // games. Before the nightly has run for a night, nothing is claimed.
  const noGamesRun = useMemo(() => {
    const run = night?.latest_run;
    return run && run.status === 'no_games' && run.game_date > night.game_date ? run : null;
  }, [night]);

  const navBtn = 'px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed';

  let body;
  if (isLoading || (isFetching && !night)) {
    body = <LoadingSpinner />;
  } else if (error && isNotFound(error)) {
    body = (
      <div className="bg-white dark:bg-gray-900 shadow-lg rounded-lg border border-gray-200 dark:border-gray-700 p-8 text-center text-gray-500 dark:text-gray-400">
        No nights scored yet. The nightly job fills this page every morning.
      </div>
    );
  } else if (error || !night) {
    body = <ErrorMessage message="Failed to load last night's surprises." />;
  } else {
    body = <NightBody key={night.game_date} night={night} />;
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Boom or Bust</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {night
              ? `${fmtDay(night.game_date, true)} · ${night.games} games · ${night.players_scored} of ${night.players_played} players scored · ${night.players_with_estimate} with a model estimate`
              : 'Surprises and disappointments of the last NBA night.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className={navBtn} disabled={!prevDate} onClick={() => prevDate && setSelectedDate(prevDate)} aria-label="Previous night">‹</button>
          <button type="button" className={navBtn} disabled={!nextDate} onClick={() => nextDate && setSelectedDate(nextDate)} aria-label="Next night">›</button>
          {!onLatest && (
            <button type="button" className={navBtn} onClick={() => setSelectedDate(null)}>Latest</button>
          )}
        </div>
      </div>

      {night && noGamesRun && selectedDate === null && (
        <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 rounded-lg px-4 py-3 text-sm">
          No games on {fmtDay(noGamesRun.game_date, false)} — showing the latest night with results ({fmtDay(night.game_date, false)}).
        </div>
      )}

      {body}
    </div>
  );
}
