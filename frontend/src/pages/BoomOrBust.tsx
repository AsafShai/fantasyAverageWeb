import { useMemo, useState, type ReactNode } from 'react';
import { useGetLatestSurprisesQuery, useGetSurprisesForDateQuery, useGetSurprisesForPeriodQuery, useGetSurprisesFormQuery, useGetSurpriseDatesQuery, useGetTeamsListQuery } from '../store/api/fantasyApi';
import type { FormSurprises, NightSurprises, PeriodSurprises, SurpriseRow } from '../types/api';
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
// The server default (1.8) sits in the middle. A stored value outside the
// range (from an older range) is ignored and the default takes over.
const SLIDER_MIN = 1.4;
const SLIDER_MAX = 2.2;
const SLIDER_STEP = 0.1;
// Each view keeps its own: a night's bar and a period's form bar are separate choices.
type ThresholdScope = 'night' | 'form';
const STORAGE_KEYS: Record<ThresholdScope, Record<'good' | 'bad', string>> = {
  night: { good: 'boomOrBust.goodThreshold', bad: 'boomOrBust.badThreshold' },
  form: { good: 'boomOrBust.form.goodThreshold', bad: 'boomOrBust.form.badThreshold' },
};

function readStoredThreshold(kind: 'good' | 'bad', scope: ThresholdScope): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS[scope][kind]);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= SLIDER_MIN && n <= SLIDER_MAX ? n : null;
  } catch {
    return null;
  }
}

function writeStoredThreshold(kind: 'good' | 'bad', scope: ThresholdScope, value: number | null): void {
  try {
    if (value === null) localStorage.removeItem(STORAGE_KEYS[scope][kind]);
    else localStorage.setItem(STORAGE_KEYS[scope][kind], value.toFixed(1));
  } catch {
    /* storage unavailable (private window, blocked site data) — the slider still works for this view */
  }
}

/** Per-viewer threshold: a stored value wins over the server default; Reset clears it. */
function useThreshold(kind: 'good' | 'bad', serverDefault: number, scope: ThresholdScope = 'night') {
  const [override, setOverride] = useState<number | null>(() => readStoredThreshold(kind, scope));
  const value = override ?? serverDefault;
  const set = (v: number) => {
    setOverride(v);
    writeStoredThreshold(kind, scope, v);
  };
  const reset = () => {
    setOverride(null);
    writeStoredThreshold(kind, scope, null);
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
      label={(v) => (kind === 'good' ? `score ≥ ${v.toFixed(1)}` : `score ≤ −${v.toFixed(1)}`)}
      ariaLabel={kind === 'good' ? 'Surprise threshold' : 'Disappointment threshold'}
      isDefault={threshold.isDefault}
      onChange={threshold.set}
      onReset={threshold.reset}
    />
  );
}

/** Over several nights the bar is a percentile of every scored player-night in
 * the period instead of a score: p97.5 (top 2.5% each side) by default, from
 * p85 (top 15%) to p99.9 (top 0.1%). The steps get finer towards the top,
 * where an even step would jump from 1% straight to nothing. */
const PCT_STEPS = [85, 90, 95, 97.5, 99, 99.5, 99.9];
const DEFAULT_PCT = PCT_STEPS.indexOf(97.5);
const topShare = (pct: number) => `${+(100 - pct).toFixed(1)}%`;

function PercentileSlider({ kind, index, onChange }: { kind: 'good' | 'bad'; index: number; onChange: (i: number) => void }) {
  return (
    <CommitSlider
      kind={kind}
      value={index}
      min={0}
      max={PCT_STEPS.length - 1}
      step={1}
      label={(i) => `${kind === 'good' ? 'top' : 'bottom'} ${topShare(PCT_STEPS[i])}`}
      ariaLabel={kind === 'good' ? 'Surprise percentile' : 'Disappointment percentile'}
      isDefault={index === DEFAULT_PCT}
      onChange={onChange}
      onReset={() => onChange(DEFAULT_PCT)}
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
  title, kind, slider, resetKey, shown, showDate = false, perGame = false, emptyText,
}: {
  title: string; kind: 'good' | 'bad'; slider: ReactNode; resetKey: number | string; shown: SurpriseRow[];
  showDate?: boolean; perGame?: boolean; emptyText?: string;
}) {
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
  const unit = showDate ? 'night' : 'player';
  const pageBtn = 'px-2 py-0.5 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed';
  return (
    <div className="bg-white dark:bg-gray-900 shadow-lg rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          {title} <span className="text-sm font-normal text-gray-500 dark:text-gray-400">({shown.length})</span>
        </h2>
        {slider}
      </div>
      <SurpriseTable rows={pageRows} kind={kind} startRank={start + 1} showDate={showDate} perGame={perGame} emptyText={emptyText} />
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

/** The score's bands (Dor Zilberman's legend), folded away until asked for. */
const SCORE_BANDS = [
  { mark: '≤ −1.8', title: 'Bust', text: 'Far under his usual game', bar: 'bg-red-500' },
  { mark: '−1.8 to −1', title: 'Poor', text: 'Under his usual game', bar: 'bg-red-300' },
  { mark: '−1 to +1', title: 'Usual', text: 'Around his usual game', bar: 'bg-gray-400' },
  { mark: '+1 to +1.8', title: 'Strong', text: 'Above his usual game', bar: 'bg-blue-300' },
  { mark: '≥ +1.8', title: 'Boom', text: 'Far above his usual game', bar: 'bg-blue-500' },
] as const;

function ScoreScale() {
  return (
    <details className="group rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <summary className="flex cursor-pointer list-none items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
        <span className="flex h-1.5 w-24 shrink-0 overflow-hidden rounded-full">
          {SCORE_BANDS.map((band) => <span key={band.title} className={`h-full flex-1 ${band.bar}`} />)}
        </span>
        <span>What the score means</span>
        <span className="ml-auto transition-transform group-open:rotate-180" aria-hidden="true">▾</span>
      </summary>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-5 sm:gap-3">
        {SCORE_BANDS.map((band) => (
          <div key={band.title} className="flex items-baseline justify-between gap-3 sm:block">
            <div className="text-xs font-semibold tabular-nums text-gray-900 dark:text-white">{band.mark}</div>
            <p className="text-xs text-gray-500 dark:text-gray-400 sm:mt-0.5">
              <span className="font-medium text-gray-800 dark:text-gray-200">{band.title}.</span> {band.text}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-2 mb-1 text-[11px] text-gray-500 dark:text-gray-400">
        0 is the game he was expected to have. Over a period, a player's form adds up his nights and divides by the
        square root of his games, so the same bands still apply; his plain average per game is shown beside it.
      </p>
    </details>
  );
}

/** A fantasy team, or the free-agent pool. `null` means nothing is chosen yet. */
type TeamPick = number | 'fa' | null;
const FA_SIDE = 5;
const byScoreDesc = (a: SurpriseRow, b: SurpriseRow) => b.score - a.score || a.player_name.localeCompare(b.player_name);

/** Players who are also in the booms or busts list, marked 💥 / 💩 by team. */
function badgesFor(booms: SurpriseRow[], busts: SurpriseRow[]): Map<number, 'boom' | 'bust'> {
  const marks = new Map<number, 'boom' | 'bust'>();
  for (const row of booms) marks.set(row.player_id, 'boom');
  for (const row of busts) marks.set(row.player_id, 'bust');
  return marks;
}

/** Every scored player of one fantasy team (or the best and worst free agents)
 * for the night or period on screen (after Dor Zilberman's team view). */
function ByTeam({
  rows, perGame, badges, teamId, onTeam, when,
}: {
  rows: SurpriseRow[]; perGame: boolean; badges: ReadonlyMap<number, 'boom' | 'bust'>;
  teamId: TeamPick; onTeam: (id: TeamPick) => void; when: string;
}) {
  const { data: teams = [] } = useGetTeamsListQuery();
  const ordered = useMemo(() => [...teams].sort((a, b) => a.team_name.localeCompare(b.team_name)), [teams]);
  const roster = useMemo(
    () => (typeof teamId === 'number' ? rows.filter((r) => r.fantasy_team_id === teamId).sort(byScoreDesc) : []),
    [rows, teamId],
  );
  const free = useMemo(() => {
    if (teamId !== 'fa') return null;
    const fa = rows.filter((r) => r.fantasy_team_id == null);
    return {
      up: fa.filter((r) => r.score >= 0).sort(byScoreDesc).slice(0, FA_SIDE),
      down: fa.filter((r) => r.score < 0).sort((a, b) => a.score - b.score).slice(0, FA_SIDE),
    };
  }, [rows, teamId]);
  const count = free ? free.up.length + free.down.length : roster.length;
  return (
    <div className="bg-white dark:bg-gray-900 shadow-lg rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          🏀 By team {teamId != null && <span className="text-sm font-normal text-gray-500 dark:text-gray-400">({count})</span>}
        </h2>
        <select
          aria-label="Fantasy team"
          value={teamId ?? ''}
          onChange={(e) => onTeam(e.target.value === '' ? null : e.target.value === 'fa' ? 'fa' : Number(e.target.value))}
          className="max-w-full truncate rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
        >
          <option value="">Select a team</option>
          <option value="fa">Free agents</option>
          {ordered.map((t) => <option key={t.team_id} value={t.team_id}>{t.team_name}</option>)}
        </select>
      </div>
      {teamId == null ? (
        <p className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400">Pick a team to see every one of its players scored {when}.</p>
      ) : free ? (
        <>
          <h3 className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
            Best {FA_SIDE} <span className="font-normal text-gray-500 dark:text-gray-400">({free.up.length})</span>
          </h3>
          <SurpriseTable rows={free.up} kind="good" perGame={perGame} badges={badges} emptyText={`No free agent scored above zero ${when}.`} />
          <h3 className="border-t border-gray-200 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-red-600 dark:border-gray-700 dark:text-red-400">
            Worst {FA_SIDE} <span className="font-normal text-gray-500 dark:text-gray-400">({free.down.length})</span>
          </h3>
          <SurpriseTable rows={free.down} kind="bad" perGame={perGame} badges={badges} emptyText={`No free agent scored below zero ${when}.`} />
        </>
      ) : (
        <SurpriseTable rows={roster} kind="good" perGame={perGame} badges={badges} emptyText={`Nobody on this team has a score ${when}.`} />
      )}
    </div>
  );
}

function NightBody({ night, isLatest, teamId, onTeam }: { night: NightSurprises; isLatest: boolean; teamId: TeamPick; onTeam: (id: TeamPick) => void }) {
  const good = useThreshold('good', night.thresholds.good);
  const bad = useThreshold('bad', night.thresholds.bad);
  const booms = useMemo(() => shownRows(night.good, 'good', good.value), [night, good.value]);
  const busts = useMemo(() => shownRows(night.bad, 'bad', bad.value), [night, bad.value]);
  const dateLabel = fmtDay(night.game_date, false);
  const shareText = useMemo(
    () => buildShareMessage(dateLabel, booms.slice(0, SHARE_ROWS), busts.slice(0, SHARE_ROWS), shareUrl()),
    [dateLabel, booms, busts],
  );
  const allRows = useMemo(() => [...night.good, ...night.bad], [night]);
  const badges = useMemo(() => badgesFor(booms, busts), [booms, busts]);
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
              rules={{ good: `score ≥ ${good.value.toFixed(1)}`, bad: `score ≤ −${bad.value.toFixed(1)}` }}
            />
          )}
        />
      </div>
      <div className="space-y-6">
        <SurpriseCard title="💥 Booms" kind="good" slider={<ScoreSlider kind="good" threshold={good} />} resetKey={good.value} shown={booms} />
        <SurpriseCard title="💩 Busts" kind="bad" slider={<ScoreSlider kind="bad" threshold={bad} />} resetKey={bad.value} shown={busts} />
      </div>
      <ByTeam
        rows={allRows}
        perGame={false}
        badges={badges}
        teamId={teamId}
        onTeam={onTeam}
        when={isLatest ? 'last night' : `on ${dateLabel}`}
      />
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Scores compare each player with his own history and with what the model expected for his minutes.
        Players without a model estimate yet (fewer than 10 games this season) are scored on their own history only.
        {' '}Computed {new Date(night.computed_at).toLocaleString('en-US')}.
      </p>
    </>
  );
}

/** Several nights at once: each boom or bust night is its own row, ranked by
 * percentile against every scored player-night in the period. The server
 * filters at the chosen percentiles, so a slider change is a new request; the
 * previous result stays on screen, dimmed, until it lands. */
function PeriodBody({ start, end, kicker, teamId, onTeam }: { start: string; end: string; kicker: string; teamId: TeamPick; onTeam: (id: TeamPick) => void }) {
  const [goodIdx, setGoodIdx] = useState(DEFAULT_PCT);
  const [badIdx, setBadIdx] = useState(DEFAULT_PCT);
  const { data, isFetching, error } = useGetSurprisesForPeriodQuery({
    start, end, goodPct: PCT_STEPS[goodIdx], badPct: PCT_STEPS[badIdx],
  });
  const period: PeriodSurprises | undefined = data && data.start === start && data.end === end ? data : undefined;
  const label = fmtRange(start, end);
  const rules = period && {
    good: `top ${topShare(period.percentiles.good)} · score ≥ ${period.thresholds.good.toFixed(1)}`,
    bad: `bottom ${topShare(period.percentiles.bad)} · score ≤ −${period.thresholds.bad.toFixed(1)}`,
  };
  const shareText = useMemo(
    () => (period ? buildShareMessage(label, period.good.slice(0, SHARE_ROWS), period.bad.slice(0, SHARE_ROWS), shareUrl()) : ''),
    [label, period],
  );
  // By team lists each player once over the period: his form (shared with the Form view's request).
  const { data: form } = useGetSurprisesFormQuery({ start, end });
  const teamRows = useMemo(() => (form ? [...form.good, ...form.bad] : []), [form]);
  const badges = useMemo(() => (period ? badgesFor(period.good, period.bad) : new Map<number, 'boom' | 'bust'>()), [period]);

  if (!period && isFetching) return <LoadingSpinner />;
  if (!period && error && isNotFound(error)) {
    return (
      <div className="bg-white dark:bg-gray-900 shadow-lg rounded-lg border border-gray-200 dark:border-gray-700 p-8 text-center text-gray-500 dark:text-gray-400">
        No nights scored between {label}.
      </div>
    );
  }
  if (!period || !rules) return <ErrorMessage message="Failed to load this period's surprises." />;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {`${period.nights} night${period.nights === 1 ? '' : 's'} · ${period.games} games · ${period.players_scored.toLocaleString('en-US')} player-nights scored · ranked against each other`}
        </p>
        <ShareCardButton
          title="Boom or Bust"
          shareText={shareText}
          renderCard={({ dark }) => (
            <BoomOrBustShareCard
              dark={dark}
              kicker={kicker}
              subtitle={`${label} · ${period.nights} nights · ${period.games} games`}
              booms={period.good}
              busts={period.bad}
              rules={rules}
              showDate
            />
          )}
        />
      </div>
      <div className={`space-y-6 transition-opacity ${isFetching ? 'opacity-60' : ''}`}>
        <SurpriseCard title="💥 Booms" kind="good" slider={<PercentileSlider kind="good" index={goodIdx} onChange={setGoodIdx} />} resetKey={goodIdx} shown={period.good} showDate />
        <SurpriseCard title="💩 Busts" kind="bad" slider={<PercentileSlider kind="bad" index={badIdx} onChange={setBadIdx} />} resetKey={badIdx} shown={period.bad} showDate />
      </div>
      <ByTeam rows={teamRows} perGame badges={badges} teamId={teamId} onTeam={onTeam} when={`between ${label}`} />
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Over several nights the bar is a share of the period: top {topShare(period.percentiles.good)} = the best
        {' '}{topShare(period.percentiles.good)} of every scored player-night between {label}. A player with more than one
        such night appears once per night.
        {' '}Computed {new Date(period.computed_at).toLocaleString('en-US')}.
      </p>
    </>
  );
}

const MIN_GP_OPTIONS = [1, 2, 3, 4, 5] as const;
const DEFAULT_MIN_GP = 2;

/** A period seen as form (Dor Zilberman's per-player span): one row per player,
 * his nightly scores combined over his games, the line per game. Its own
 * filters: a minimum of games (default 2, so one lucky night isn't form) and
 * the score sliders, on the same bands as a night. */
function FormBody({ start, end, kicker, teamId, onTeam }: { start: string; end: string; kicker: string; teamId: TeamPick; onTeam: (id: TeamPick) => void }) {
  const [minGp, setMinGp] = useState<number>(DEFAULT_MIN_GP);
  const { data, isFetching, error } = useGetSurprisesFormQuery({ start, end });
  const form: FormSurprises | undefined = data && data.start === start && data.end === end ? data : undefined;
  const good = useThreshold('good', form?.thresholds.good ?? 1.8, 'form');
  const bad = useThreshold('bad', form?.thresholds.bad ?? 1.8, 'form');
  const enough = (r: SurpriseRow) => (r.games ?? 0) >= minGp;
  const booms = useMemo(() => (form ? shownRows(form.good.filter(enough), 'good', good.value) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form, good.value, minGp]);
  const busts = useMemo(() => (form ? shownRows(form.bad.filter(enough), 'bad', bad.value) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [form, bad.value, minGp]);
  const teamRows = useMemo(() => (form ? [...form.good, ...form.bad] : []), [form]);
  const badges = useMemo(() => badgesFor(booms, busts), [booms, busts]);
  const label = fmtRange(start, end);
  const shareText = useMemo(
    () => buildShareMessage(label, booms.slice(0, SHARE_ROWS), busts.slice(0, SHARE_ROWS), shareUrl()),
    [label, booms, busts],
  );

  if (!form && isFetching) return <LoadingSpinner />;
  if (!form && error && isNotFound(error)) {
    return (
      <div className="bg-white dark:bg-gray-900 shadow-lg rounded-lg border border-gray-200 dark:border-gray-700 p-8 text-center text-gray-500 dark:text-gray-400">
        No nights scored between {label}.
      </div>
    );
  }
  if (!form) return <ErrorMessage message="Failed to load this period's form." />;

  const withGames = form.good.filter(enough).length + form.bad.filter(enough).length;
  const empty = withGames === 0
    ? `No player has ${minGp}+ games in this period yet. Try a lower Min GP or a longer period.`
    : minGp > 1 ? `Nobody with ${minGp}+ games past the bar. Try moving the slider.` : 'Nobody past the bar in this period.';
  const gpRule = minGp > 1 ? ` · ${minGp}+ games` : '';
  const chip = (active: boolean) =>
    `px-2.5 py-0.5 text-xs rounded-full border ${active
      ? 'bg-blue-600 border-blue-600 text-white'
      : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'}`;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {`${form.nights} night${form.nights === 1 ? '' : 's'} · ${form.games} games · ${form.players_scored} players`}
          </p>
          <div className="flex items-center gap-1.5" role="group" aria-label="Minimum games">
            <span className="text-xs text-gray-500 dark:text-gray-400">Min GP</span>
            {MIN_GP_OPTIONS.map((n) => (
              <button key={n} type="button" className={chip(minGp === n)} aria-pressed={minGp === n}
                aria-label={`At least ${n} ${n === 1 ? 'game' : 'games'}`} onClick={() => setMinGp(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>
        <ShareCardButton
          title="Boom or Bust"
          shareText={shareText}
          renderCard={({ dark }) => (
            <BoomOrBustShareCard
              dark={dark}
              kicker={`form · ${kicker}`}
              subtitle={`${label} · ${form.nights} nights · ${form.games} games`}
              booms={booms}
              busts={busts}
              rules={{ good: `form ≥ ${good.value.toFixed(1)}${gpRule}`, bad: `form ≤ −${bad.value.toFixed(1)}${gpRule}` }}
              perGame
              note="Form = his nightly scores over the period added up and divided by the square root of his games, so a night's bands still apply; the line is per game."
            />
          )}
        />
      </div>
      <div className={`space-y-6 transition-opacity ${isFetching ? 'opacity-60' : ''}`}>
        <SurpriseCard title="💥 In form" kind="good" slider={<ScoreSlider kind="good" threshold={good} />} resetKey={`${good.value}:${minGp}`} shown={booms} perGame emptyText={empty} />
        <SurpriseCard title="💩 Out of form" kind="bad" slider={<ScoreSlider kind="bad" threshold={bad} />} resetKey={`${bad.value}:${minGp}`} shown={busts} perGame emptyText={empty} />
      </div>
      <ByTeam rows={teamRows} perGame badges={badges} teamId={teamId} onTeam={onTeam} when={`between ${label}`} />
      <p className="text-xs text-gray-500 dark:text-gray-400">
        Form adds up a player's nightly scores between {label} and divides by the square root of his games, so it stays on a
        night's scale and rewards a run of good nights over one lucky one; "avg" beside it is his plain average per game. A night he
        sat out is left out. Computed {new Date(form.computed_at).toLocaleString('en-US')}.
      </p>
    </>
  );
}

type PeriodView = 'nights' | 'form';

type Preset = 'night' | '7d' | '30d' | 'season' | 'custom';
const PRESETS: { id: Preset; label: string; kicker: string }[] = [
  { id: 'night', label: 'Night', kicker: 'last night' },
  { id: '7d', label: '7 days', kicker: 'last 7 days' },
  { id: '30d', label: '30 days', kicker: 'last 30 days' },
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

/** One segmented control style for every choice on the page: a soft grey
 * track, the picked option raised in white. Full width on a phone. */
function Segmented<T extends string>({
  label, value, options, onChange, cols,
}: { label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; cols: string }) {
  return (
    <div role="group" aria-label={label} className={`grid ${cols} gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800 sm:inline-flex sm:w-auto`}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={`whitespace-nowrap rounded-md px-2 py-1.5 text-sm font-medium sm:px-3 transition-colors ${value === o.id
            ? 'bg-white text-blue-600 shadow-sm dark:bg-gray-900 dark:text-blue-400'
            : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const VIEWS: { id: PeriodView; label: string; hint: string }[] = [
  { id: 'nights', label: '🔥 Biggest nights', hint: 'Every big night in the period, ranked against all the others: one row per player-night.' },
  { id: 'form', label: '📈 Form', hint: "Each player's run over the period: his nights combined, one row per player." },
];

export default function BoomOrBust() {
  const [preset, setPreset] = useState<Preset>('night');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [custom, setCustom] = useState<{ start: string; end: string } | null>(null);
  const [view, setView] = useState<PeriodView>('nights');
  const [teamId, setTeamId] = useState<TeamPick>(null);
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

  const navBtn = 'h-8 w-8 rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700';
  const dateInput = 'rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200';

  let body;
  if (isPeriod && range) {
    const kicker = PRESETS.find((p) => p.id === preset)?.kicker ?? 'period';
    const Body = view === 'form' ? FormBody : PeriodBody;
    body = <Body key={`${view}_${range.start}_${range.end}`} start={range.start} end={range.end} kicker={kicker} teamId={teamId} onTeam={setTeamId} />;
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
    body = <NightBody key={night.game_date} night={night} isLatest={night.game_date === latestDate} teamId={teamId} onTeam={setTeamId} />;
  }

  let subtitle = 'Who beat their usual game, and who fell short.';
  if (isPeriod && range) subtitle = fmtRange(range.start, range.end);
  else if (night) subtitle = `${fmtDay(night.game_date, true)} · ${night.games} games · ${night.players_scored} of ${night.players_played} players scored · ${night.players_with_estimate} with a model estimate`;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">💥 Boom or Bust</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{subtitle}</p>
      </div>

      {dates.length > 0 && (
        <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-900">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <Segmented
              label="Period"
              value={preset}
              options={PRESETS.map((p) => ({ id: p.id, label: p.label }))}
              onChange={pick}
              cols="grid-cols-5"
            />
            {preset === 'night' && (
              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                <button type="button" className={navBtn} disabled={!prevDate} onClick={() => prevDate && setSelectedDate(prevDate)} aria-label="Previous night">‹</button>
                <span className="min-w-[7.5rem] text-center tabular-nums">{shownDate ? fmtDay(shownDate, false) : ''}</span>
                <button type="button" className={navBtn} disabled={!nextDate} onClick={() => nextDate && setSelectedDate(nextDate)} aria-label="Next night">›</button>
                {!onLatest && (
                  <button type="button" className="text-sm text-blue-600 hover:underline dark:text-blue-400" onClick={() => setSelectedDate(null)}>Latest</button>
                )}
              </div>
            )}
            {preset === 'custom' && custom && (
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <input type="date" aria-label="From" className={dateInput} value={custom.start}
                  min={dates[dates.length - 1]} max={latestDate ?? undefined}
                  onChange={(e) => setCustomEnd('start', e.target.value)} />
                –
                <input type="date" aria-label="To" className={dateInput} value={custom.end}
                  min={dates[dates.length - 1]} max={latestDate ?? undefined}
                  onChange={(e) => setCustomEnd('end', e.target.value)} />
              </div>
            )}
          </div>
          {isPeriod && (
            <div className="flex flex-col gap-2 border-t border-gray-100 pt-3 dark:border-gray-800 sm:flex-row sm:items-center sm:gap-4">
              <Segmented label="View" value={view} options={VIEWS} onChange={setView} cols="grid-cols-2" />
              <p className="text-xs text-gray-500 dark:text-gray-400">{VIEWS.find((v) => v.id === view)?.hint}</p>
            </div>
          )}
        </div>
      )}

      <ScoreScale />

      {night && noGamesRun && preset === 'night' && selectedDate === null && (
        <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 rounded-lg px-4 py-3 text-sm">
          No games on {fmtDay(noGamesRun.game_date, false)} — showing the latest night with results ({fmtDay(night.game_date, false)}).
        </div>
      )}

      {body}
    </div>
  );
}
