import { useMemo, useState, type ReactNode } from 'react';
import { useGetLatestSurprisesQuery, useGetSurprisesForDateQuery, useGetSurprisesForPeriodQuery, useGetSurpriseDatesQuery } from '../store/api/fantasyApi';
import type { NightSurprises, PeriodSurprises, SurpriseRow } from '../types/api';
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

/** YYYY-MM-DD shifted by `days` calendar days. */
function addDays(s: string, days: number): string {
  const d = parseDay(s);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "Oct 15 – Oct 21, 2026" (the year once when both ends share it). */
function fmtRange(start: string, end: string): string {
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  const left = parseDay(start).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
  return `${left} – ${fmtDay(end, false)}`;
}

/** RTK reports a JSON 404 as `status: 404`, a plain-text one as PARSING_ERROR with `originalStatus: 404`. */
function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { status?: unknown; originalStatus?: unknown };
  return e.status === 404 || e.originalStatus === 404;
}

// 1.4 is already a clearly good/bad night; past 2.2 almost nobody is left.
// The server defaults (boom 2.1, bust 2.2) sit near the top. The score is ranked onto a
// symmetric bell curve, so both sides share the range. A stored value outside
// it (from an older range) is ignored and the default takes over.
const SLIDER_MIN = 1.4;
const SLIDER_MAX = 2.2;
const SLIDER_STEP = 0.1;
const SCORE_LABEL = { good: 'boom score ≥', bad: 'bust score ≤ −' } as const;
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

/** A card's slider. The value applies when the thumb is released, not on
 * every tick: while dragging only the label follows the thumb, so the table
 * under the pointer (and the card below it) stays put until the viewer has
 * chosen a value. Keyboard steps apply on key release, a programmatic change
 * on the next blur. `label` turns the (draft) value into the text beside it. */
function CommitSlider({
  kind, value, min, max, step, label, ariaLabel, isDefault, onChange, onReset,
}: {
  kind: 'good' | 'bad'; value: number; min: number; max: number; step: number;
  label: (v: number) => string; ariaLabel: string;
  isDefault: boolean; onChange: (v: number) => void; onReset: () => void;
}) {
  const id = `threshold-${kind}`;
  // null = no drag in progress: the thumb and label show the applied value
  // (so Reset, or a value restored from storage, shows at once).
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? value;
  const commit = () => {
    if (draft !== null && draft !== value) onChange(draft);
    setDraft(null);
  };
  const accent = kind === 'good' ? 'accent-blue-500' : 'accent-red-500';
  return (
    <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
      <label htmlFor={id} className="tabular-nums whitespace-nowrap">{label(shown)}</label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        aria-label={ariaLabel}
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

function ScoreSlider({ kind, threshold }: { kind: 'good' | 'bad'; threshold: Threshold }) {
  return (
    <CommitSlider
      kind={kind}
      value={threshold.value}
      min={SLIDER_MIN}
      max={SLIDER_MAX}
      step={SLIDER_STEP}
      label={(v) => (kind === 'good' ? `${SCORE_LABEL.good} ${v.toFixed(1)}` : `${SCORE_LABEL.bad}${v.toFixed(1)}`)}
      ariaLabel={kind === 'good' ? 'Surprise threshold' : 'Disappointment threshold'}
      isDefault={threshold.isDefault}
      onChange={threshold.set}
      onReset={threshold.reset}
    />
  );
}

/** A card pages its rows five at a time, and only when there are more than
 * five; the footer is always there so a card's chrome never changes shape. */
const PAGE_SIZE = 5;

/** The rows a card shows: every row past the viewer's threshold (the card pages them). */
function shownRows(rows: SurpriseRow[], kind: 'good' | 'bad', threshold: number): SurpriseRow[] {
  return kind === 'good' ? rows.filter((r) => r.score >= threshold) : rows.filter((r) => r.score <= -threshold);
}

function SurpriseCard({
  title, kind, slider, resetKey, shown, showDate = false,
}: { title: string; kind: 'good' | 'bad'; slider: ReactNode; resetKey: number; shown: SurpriseRow[]; showDate?: boolean }) {
  const [page, setPage] = useState(0);
  // A new bar starts the card on its first page: a viewer on page 2 who
  // raises the bar and lowers it again should not land back on page 2.
  const [pagedFor, setPagedFor] = useState(resetKey);
  if (resetKey !== pagedFor) {
    setPagedFor(resetKey);
    setPage(0);
  }
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);   // the slider can shrink the list under the viewer
  const start = current * PAGE_SIZE;
  const pageRows = shown.slice(start, start + PAGE_SIZE);
  // Over a period a row is one player's game: a performance.
  const unit = showDate ? 'performance' : 'player';
  const pageBtn = 'px-2 py-0.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed';
  return (
    <div className="bg-white dark:bg-gray-900 shadow-lg rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          {title} <span className="text-sm font-normal text-gray-500 dark:text-gray-400">({shown.length})</span>
        </h2>
        {slider}
      </div>
      <SurpriseTable rows={pageRows} kind={kind} startRank={start + 1} showDate={showDate} />
      <div className="flex items-center justify-end gap-2 px-4 py-2 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 min-h-[2.25rem]">
        {pages > 1 ? (
          <>
            <span>{start + 1}–{start + pageRows.length} of {shown.length}</span>
            <button type="button" className={pageBtn} onClick={() => setPage(current - 1)} disabled={current === 0} aria-label="Previous page">‹</button>
            <button type="button" className={pageBtn} onClick={() => setPage(current + 1)} disabled={current >= pages - 1} aria-label="Next page">›</button>
          </>
        ) : (
          <span>{shown.length} {unit}{shown.length === 1 ? '' : 's'}</span>
        )}
      </div>
    </div>
  );
}

const shareUrl = () => `${window.location.origin}/boom-or-bust`;

function NightBody({ night, isLatest }: { night: NightSurprises; isLatest: boolean }) {
  const good = useThreshold('good', night.thresholds.good);
  const bad = useThreshold('bad', night.thresholds.bad);
  const booms = useMemo(() => shownRows(night.good, 'good', good.value), [night, good.value]);
  const busts = useMemo(() => shownRows(night.bad, 'bad', bad.value), [night, bad.value]);
  const dateLabel = fmtDay(night.game_date, false);
  const shareText = useMemo(
    () => buildShareMessage(dateLabel, booms.slice(0, SHARE_ROWS), busts.slice(0, SHARE_ROWS), shareUrl()),
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
              kicker={isLatest ? 'last night' : dateLabel}
              subtitle={`${fmtDay(night.game_date, true)} · ${night.games} game${night.games === 1 ? '' : 's'}`}
              booms={booms}
              busts={busts}
              rules={{ good: `${SCORE_LABEL.good} ${good.value.toFixed(1)}`, bad: `${SCORE_LABEL.bad}${bad.value.toFixed(1)}` }}
            />
          )}
        />
      </div>
      <div className="space-y-6">
        <SurpriseCard title="💥 Booms" kind="good" slider={<ScoreSlider kind="good" threshold={good} />} resetKey={good.value} shown={booms} />
        <SurpriseCard title="💩 Busts" kind="bad" slider={<ScoreSlider kind="bad" threshold={bad} />} resetKey={bad.value} shown={busts} />
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Scores compare each player with his own history and with what the model expected for his minutes.
        Players without a model estimate yet (fewer than 10 games this season) are scored on their own history only.
        {' '}Computed {new Date(night.computed_at).toLocaleString('en-US')}.
      </p>
    </>
  );
}

/** Several nights at once: each boom or bust night is its own row, on the
 * same score bar as a single night, with the same sliders (and the same
 * remembered values). The server sends every player-night past the sliders'
 * lowest point, so moving a slider filters in place, like a night. */
function PeriodBody({ start, end, kicker }: { start: string; end: string; kicker: string }) {
  const { data, isFetching, error } = useGetSurprisesForPeriodQuery({ start, end, minScore: SLIDER_MIN });
  const period: PeriodSurprises | undefined = data && data.start === start && data.end === end ? data : undefined;
  const good = useThreshold('good', period?.thresholds.good ?? 2.1);
  const bad = useThreshold('bad', period?.thresholds.bad ?? 2.2);
  const booms = useMemo(() => (period ? shownRows(period.good, 'good', good.value) : []), [period, good.value]);
  const busts = useMemo(() => (period ? shownRows(period.bad, 'bad', bad.value) : []), [period, bad.value]);
  const label = fmtRange(start, end);
  const shareText = useMemo(
    () => buildShareMessage(label, booms.slice(0, SHARE_ROWS), busts.slice(0, SHARE_ROWS), shareUrl()),
    [label, booms, busts],
  );

  if (!period && isFetching) return <LoadingSpinner />;
  if (!period && error && isNotFound(error)) {
    return (
      <div className="bg-white dark:bg-gray-900 shadow-lg rounded-lg border border-gray-200 dark:border-gray-700 p-8 text-center text-gray-500 dark:text-gray-400">
        No nights scored between {label}.
      </div>
    );
  }
  if (!period) return <ErrorMessage message="Failed to load this period's surprises." />;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {`${period.nights} night${period.nights === 1 ? '' : 's'} · ${period.games} games · ${period.players_scored.toLocaleString('en-US')} performances scored`}
        </p>
        <ShareCardButton
          title="Boom or Bust"
          shareText={shareText}
          renderCard={({ dark }) => (
            <BoomOrBustShareCard
              dark={dark}
              kicker={kicker}
              subtitle={`${label} · ${period.nights} nights · ${period.games} games`}
              booms={booms}
              busts={busts}
              rules={{ good: `${SCORE_LABEL.good} ${good.value.toFixed(1)}`, bad: `${SCORE_LABEL.bad}${bad.value.toFixed(1)}` }}
              showDate
            />
          )}
        />
      </div>
      <div className="space-y-6">
        <SurpriseCard title="💥 Booms" kind="good" slider={<ScoreSlider kind="good" threshold={good} />} resetKey={good.value} shown={booms} showDate />
        <SurpriseCard title="💩 Busts" kind="bad" slider={<ScoreSlider kind="bad" threshold={bad} />} resetKey={bad.value} shown={busts} showDate />
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Every performance between {label} with a score past the bar, the same bar as a single night. A player with
        more than one such game appears once per game.
        {' '}Computed {new Date(period.computed_at).toLocaleString('en-US')}.
      </p>
    </>
  );
}

type Preset = 'night' | '7d' | '30d' | 'season' | 'custom';
const PRESETS: { id: Preset; label: string; kicker: string }[] = [
  { id: 'night', label: 'Last night', kicker: 'last night' },
  { id: '7d', label: 'Last 7 days', kicker: 'last 7 days' },
  { id: '30d', label: 'Last 30 days', kicker: 'last 30 days' },
  { id: 'season', label: 'Season', kicker: 'season so far' },
  { id: 'custom', label: 'Custom', kicker: 'custom period' },
];

/** The first scored night of the season the newest night belongs to (a
 * season starts in October; August is the cut-off between two seasons).
 * `dates` is newest first. */
function seasonStart(dates: string[]): string {
  const latest = dates[0];
  const year = Number(latest.slice(0, 4)) - (Number(latest.slice(5, 7)) < 8 ? 1 : 0);
  const inSeason = dates.filter((d) => d >= `${year}-08-01`);
  return inSeason[inSeason.length - 1] ?? latest;
}

export default function BoomOrBust() {
  const [preset, setPreset] = useState<Preset>('night');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [custom, setCustom] = useState<{ start: string; end: string } | null>(null);
  const { data: dates = [] } = useGetSurpriseDatesQuery();
  const latestDate = dates[0] ?? null;

  // The period on screen: one night (the newest, or one picked with ‹ › or a
  // one-day custom range) or a range of nights.
  const range = useMemo((): { start: string; end: string } | null => {
    if (!latestDate || preset === 'night') return null;
    if (preset === '7d') return { start: addDays(latestDate, -6), end: latestDate };
    if (preset === '30d') return { start: addDays(latestDate, -29), end: latestDate };
    if (preset === 'season') return { start: seasonStart(dates), end: latestDate };
    return custom;
  }, [preset, latestDate, dates, custom]);
  const singleNight = range !== null && range.start === range.end ? range.start : null;
  const isPeriod = range !== null && singleNight === null;
  const nightDate = preset === 'night' ? selectedDate : singleNight;

  const latest = useGetLatestSurprisesQuery(undefined, { skip: isPeriod || nightDate !== null });
  const forDate = useGetSurprisesForDateQuery(nightDate ?? '', { skip: isPeriod || nightDate === null });
  // currentData, not data: data keeps the previous night while the next one
  // loads, and a second ‹ click during that window would pick the same date again.
  const { currentData: night, isLoading, isFetching, error } = nightDate === null ? latest : forDate;

  const shownDate = nightDate ?? night?.game_date ?? null;
  const idx = shownDate ? dates.indexOf(shownDate) : -1;
  const prevDate = idx >= 0 && idx + 1 < dates.length ? dates[idx + 1] : null;
  const nextDate = idx > 0 ? dates[idx - 1] : null;
  const onLatest = nightDate === null || (dates.length > 0 && shownDate === dates[0]);
  // "No games last night" comes from the nightly's own ledger, not the viewer's
  // clock: the newest run handled a later night than the one shown and found no
  // games. Before the nightly has run for a night, nothing is claimed.
  const noGamesRun = useMemo(() => {
    const run = night?.latest_run;
    return run && run.status === 'no_games' && run.game_date > night.game_date ? run : null;
  }, [night]);

  const pick = (p: Preset) => {
    setPreset(p);
    if (p === 'night') setSelectedDate(null);
    if (p === 'custom' && !custom && latestDate) setCustom({ start: addDays(latestDate, -6), end: latestDate });
  };
  // Typing a start after the end (or the reverse) swaps them rather than refusing.
  const setCustomEnd = (which: 'start' | 'end', value: string) => {
    if (!custom || !value) return;
    const next = { ...custom, [which]: value };
    setCustom(next.start <= next.end ? next : { start: next.end, end: next.start });
  };

  const navBtn = 'px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed';
  const chip = (active: boolean) =>
    `px-3 py-1 text-sm rounded-full border ${active
      ? 'bg-blue-600 border-blue-600 text-white'
      : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'}`;
  const dateInput = 'px-2 py-1 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200';

  let body;
  if (isPeriod && range) {
    const kicker = PRESETS.find((p) => p.id === preset)?.kicker ?? 'period';
    body = <PeriodBody key={`${range.start}_${range.end}`} start={range.start} end={range.end} kicker={kicker} />;
  } else if (isLoading || (isFetching && !night)) {
    body = <LoadingSpinner />;
  } else if (error && isNotFound(error)) {
    body = (
      <div className="bg-white dark:bg-gray-900 shadow-lg rounded-lg border border-gray-200 dark:border-gray-700 p-8 text-center text-gray-500 dark:text-gray-400">
        {nightDate ? `No results for ${fmtDay(nightDate, false)}.` : 'No nights scored yet. The nightly job fills this page every morning.'}
      </div>
    );
  } else if (error || !night) {
    body = <ErrorMessage message="Failed to load last night's surprises." />;
  } else {
    body = <NightBody key={night.game_date} night={night} isLatest={night.game_date === latestDate} />;
  }

  let subtitle = 'Surprises and disappointments of the last NBA night.';
  if (isPeriod && range) subtitle = fmtRange(range.start, range.end);
  else if (night) subtitle = `${fmtDay(night.game_date, true)} · ${night.games} games · ${night.players_scored} of ${night.players_played} players scored · ${night.players_with_estimate} with a model estimate`;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Boom or Bust</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>
        </div>
        {preset === 'night' && (
          <div className="flex items-center gap-2">
            <button type="button" className={navBtn} disabled={!prevDate} onClick={() => prevDate && setSelectedDate(prevDate)} aria-label="Previous night">‹</button>
            <button type="button" className={navBtn} disabled={!nextDate} onClick={() => nextDate && setSelectedDate(nextDate)} aria-label="Next night">›</button>
            {!onLatest && (
              <button type="button" className={navBtn} onClick={() => setSelectedDate(null)}>Latest</button>
            )}
          </div>
        )}
      </div>

      {dates.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Period">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" className={chip(preset === p.id)} aria-pressed={preset === p.id} onClick={() => pick(p.id)}>
              {p.label}
            </button>
          ))}
          {preset === 'custom' && custom && (
            <span className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <input type="date" aria-label="From" className={dateInput} value={custom.start}
                min={dates[dates.length - 1]} max={latestDate ?? undefined}
                onChange={(e) => setCustomEnd('start', e.target.value)} />
              –
              <input type="date" aria-label="To" className={dateInput} value={custom.end}
                min={dates[dates.length - 1]} max={latestDate ?? undefined}
                onChange={(e) => setCustomEnd('end', e.target.value)} />
            </span>
          )}
        </div>
      )}

      {night && noGamesRun && preset === 'night' && selectedDate === null && (
        <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 rounded-lg px-4 py-3 text-sm">
          No games on {fmtDay(noGamesRun.game_date, false)} — showing the latest night with results ({fmtDay(night.game_date, false)}).
        </div>
      )}

      {body}
    </div>
  );
}
