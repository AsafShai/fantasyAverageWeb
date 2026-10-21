import { useMemo, useState } from 'react';
import { useGetLatestSurprisesQuery, useGetSurprisesForDateQuery, useGetSurpriseDatesQuery } from '../store/api/fantasyApi';
import type { NightSurprises, SurpriseRow } from '../types/api';
import LoadingSpinner from '../components/LoadingSpinner';
import ErrorMessage from '../components/ErrorMessage';
import { SurpriseTable } from '../components/boomOrBust/SurpriseTable';
import { ShareCardButton } from '../components/share/ShareCardButton';
import { BoomOrBustShareCard } from '../components/share/BoomOrBustShareCard';
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

/** True when `gameDate` is before yesterday (local time). */
function isOlderThanYesterday(gameDate: string, now = new Date()): boolean {
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return parseDay(gameDate).getTime() < yesterday.getTime();
}

/** RTK reports a JSON 404 as `status: 404`, a plain-text one as PARSING_ERROR with `originalStatus: 404`. */
function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { status?: unknown; originalStatus?: unknown };
  return e.status === 404 || e.originalStatus === 404;
}

// 1.0 is already "a clearly good/bad night"; past 2.3 almost nobody is left.
const SLIDER_MIN = 1.0;
const SLIDER_MAX = 2.3;
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

function ThresholdSlider({
  kind, value, isDefault, onChange, onReset,
}: { kind: 'good' | 'bad'; value: number; isDefault: boolean; onChange: (v: number) => void; onReset: () => void }) {
  const id = `threshold-${kind}`;
  const label = kind === 'good' ? `score ≥ ${value.toFixed(1)}` : `score ≤ −${value.toFixed(1)}`;
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
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
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

/** The rows a card shows: past the viewer's threshold, capped at the server's max. */
function shownRows(rows: SurpriseRow[], kind: 'good' | 'bad', threshold: number, maxRows: number): SurpriseRow[] {
  const kept = kind === 'good' ? rows.filter((r) => r.score >= threshold) : rows.filter((r) => r.score <= -threshold);
  return kept.slice(0, Math.max(0, maxRows));
}

function SurpriseCard({
  title, kind, threshold, shown,
}: { title: string; kind: 'good' | 'bad'; threshold: Threshold; shown: SurpriseRow[] }) {
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
      <SurpriseTable rows={shown} kind={kind} />
    </div>
  );
}

function NightBody({ night }: { night: NightSurprises }) {
  const good = useThreshold('good', night.thresholds.good);
  const bad = useThreshold('bad', night.thresholds.bad);
  const booms = useMemo(() => shownRows(night.good, 'good', good.value, night.max_rows), [night, good.value]);
  const busts = useMemo(() => shownRows(night.bad, 'bad', bad.value, night.max_rows), [night, bad.value]);
  const dateLabel = fmtDay(night.game_date, false);
  const shareText = useMemo(
    () => buildShareMessage(dateLabel, booms, busts, `${window.location.origin}/boom-or-bust`),
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
  const { data: night, isLoading, error } = selectedDate === null ? latest : forDate;

  const shownDate = night?.game_date ?? selectedDate;
  const idx = shownDate ? dates.indexOf(shownDate) : -1;
  const prevDate = idx >= 0 && idx + 1 < dates.length ? dates[idx + 1] : null;
  const nextDate = idx > 0 ? dates[idx - 1] : null;
  const onLatest = selectedDate === null || (dates.length > 0 && shownDate === dates[0]);
  const stale = useMemo(
    () => (night && selectedDate === null ? isOlderThanYesterday(night.game_date) : false),
    [night, selectedDate],
  );

  const navBtn = 'px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed';

  let body;
  if (isLoading) {
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
    body = <NightBody night={night} />;
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

      {night && stale && (
        <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 rounded-lg px-4 py-3 text-sm">
          No games last night — showing the latest night with results ({fmtDay(night.game_date, false)}).
        </div>
      )}

      {body}
    </div>
  );
}
