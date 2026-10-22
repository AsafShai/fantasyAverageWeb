import { useMemo, useState } from 'react';
import { useGetLatestSurprisesQuery, useGetSurprisesForDateQuery, useGetSurpriseDatesQuery, useGetSurpriseRangeQuery, useGetTeamsListQuery } from '../store/api/fantasyApi';
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

const RANGES = [
  { days: null, label: 'Night' },
  { days: 7, label: '7 days' },
  { days: 14, label: '14 days' },
  { days: 28, label: '28 days' },
] as const;

type RangeDays = 7 | 14 | 28;
type TopN = 3 | 5 | 10;

const MIN_GP_OPTIONS = [1, 2, 3, 4, 5] as const;
const TOP_OPTIONS = [3, 5, 10] as const;

/** Rows a card shows. A span can require a minimum number of games, and can
 * list the top of each side instead of everyone past the score bar. */
function shownRows(
  rows: SurpriseRow[], kind: 'good' | 'bad', threshold: number, minGp: number, topN: TopN | null,
): SurpriseRow[] {
  const eligible = minGp > 1 ? rows.filter((r) => (r.games ?? 0) >= minGp) : rows;
  if (topN != null) return eligible.slice(0, topN);
  return kind === 'good' ? eligible.filter((r) => r.score >= threshold) : eligible.filter((r) => r.score <= -threshold);
}

function emptyCopy(perGame: boolean, minGp: number): string {
  if (perGame && minGp > 1) return `Nobody with at least ${minGp} games in this span.`;
  return perGame ? 'Nobody crossed the bar in this span.' : 'Nobody crossed the bar tonight.';
}

function SurpriseCard({
  title, kind, threshold, shown, perGame = false, topN = null, minGp = 1,
}: { title: string; kind: 'good' | 'bad'; threshold: Threshold; shown: SurpriseRow[]; perGame?: boolean; topN?: TopN | null; minGp?: number }) {
  const [page, setPage] = useState(0);
  // A new threshold, games floor, or top-N starts the card on its first page.
  const listKey = `${threshold.value}:${minGp}:${topN ?? 'all'}`;
  const [pagedFor, setPagedFor] = useState(listKey);
  if (listKey !== pagedFor) {
    setPagedFor(listKey);
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
        {topN == null ? (
          <ThresholdSlider
            kind={kind}
            value={threshold.value}
            isDefault={threshold.isDefault}
            onChange={threshold.set}
            onReset={threshold.reset}
          />
        ) : (
          <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">top {topN}</span>
        )}
      </div>
      <SurpriseTable rows={pageRows} kind={kind} startRank={start + 1} perGame={perGame} emptyText={emptyCopy(perGame, minGp)} />
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

/** A fantasy team, or the free-agent pool. `null` means nothing is chosen yet. */
type TeamPick = number | 'fa' | null;

const FA_SIDE = 5;

function byScoreDesc(a: SurpriseRow, b: SurpriseRow): number {
  return b.score - a.score || a.player_name.localeCompare(b.player_name);
}

/** The strongest and weakest free agents, five from each side of zero. */
function freeAgentSides(night: NightSurprises): { up: SurpriseRow[]; down: SurpriseRow[] } {
  const free = [...night.good, ...night.bad].filter((row) => row.fantasy_team_id == null);
  return {
    up: free.filter((row) => row.score >= 0).sort(byScoreDesc).slice(0, FA_SIDE),
    down: free.filter((row) => row.score < 0).sort((a, b) => a.score - b.score || a.player_name.localeCompare(b.player_name)).slice(0, FA_SIDE),
  };
}

function FaSide({
  title, rows, perGame, badges, emptyText, divided = false,
}: {
  title: string
  rows: SurpriseRow[]
  perGame: boolean
  badges: ReadonlyMap<number, 'boom' | 'bust'>
  emptyText: string
  divided?: boolean
}) {
  const tone = title === 'Top 5' ? 'text-blue-600 dark:text-blue-400' : 'text-red-600 dark:text-red-400';
  return (
    <section aria-label={title} className={divided ? 'border-t border-gray-200 dark:border-gray-700' : undefined}>
      <h3 className={`px-4 py-2 text-xs font-semibold uppercase tracking-wider ${tone}`}>
        {title} <span className="font-normal text-gray-500 dark:text-gray-400">({rows.length})</span>
      </h3>
      <SurpriseTable rows={rows} kind="good" perGame={perGame} tone="score" badges={badges} emptyText={emptyText} />
    </section>
  );
}

function TeamScores({
  night, perGame, booms, busts, teamId, onTeam,
}: {
  night: NightSurprises
  perGame: boolean
  booms: SurpriseRow[]
  busts: SurpriseRow[]
  teamId: TeamPick
  onTeam: (id: TeamPick) => void
}) {
  const { data: teams = [] } = useGetTeamsListQuery();
  const roster = useMemo(() => {
    if (teamId == null || teamId === 'fa') return [];
    return [...night.good, ...night.bad]
      .filter((row) => row.fantasy_team_id === teamId)
      .sort(byScoreDesc);
  }, [night, teamId]);
  const freeAgents = useMemo(() => (teamId === 'fa' ? freeAgentSides(night) : null), [night, teamId]);
  const shownCount = freeAgents ? freeAgents.up.length + freeAgents.down.length : roster.length;
  const badges = useMemo(() => {
    const marks = new Map<number, 'boom' | 'bust'>();
    for (const row of booms) marks.set(row.player_id, 'boom');
    for (const row of busts) marks.set(row.player_id, 'bust');
    return marks;
  }, [booms, busts]);
  const ordered = useMemo(
    () => [...teams].sort((a, b) => a.team_name.localeCompare(b.team_name)),
    [teams],
  );
  return (
    <div className="bg-white dark:bg-gray-900 shadow-lg rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          🏀 By team {teamId != null && <span className="text-sm font-normal text-gray-500 dark:text-gray-400">({shownCount})</span>}
        </h2>
        <select
          aria-label="Fantasy team"
          value={teamId ?? ''}
          onChange={(event) => {
            const value = event.target.value;
            onTeam(value === '' ? null : value === 'fa' ? 'fa' : Number(value));
          }}
          className="max-w-full truncate rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
        >
          <option value="">Select a team</option>
          <option value="fa">FA</option>
          {ordered.map((team) => (
            <option key={team.team_id} value={team.team_id}>{team.team_name}</option>
          ))}
        </select>
      </div>
      {teamId == null ? (
        <p className="px-4 py-6 text-sm text-gray-500 dark:text-gray-400">Select a team to see every scored player on it.</p>
      ) : freeAgents ? (
        <div>
          <FaSide
            title="Top 5"
            rows={freeAgents.up}
            perGame={perGame}
            badges={badges}
            emptyText={perGame ? 'No free agents scored above zero in this span.' : 'No free agents scored above zero tonight.'}
          />
          <FaSide
            title="Bottom 5"
            rows={freeAgents.down}
            perGame={perGame}
            badges={badges}
            emptyText={perGame ? 'No free agents scored below zero in this span.' : 'No free agents scored below zero tonight.'}
            divided
          />
        </div>
      ) : (
        <SurpriseTable
          rows={roster}
          kind="good"
          perGame={perGame}
          tone="score"
          badges={badges}
          emptyText={perGame ? 'Nobody on this team has a score in this span.' : 'Nobody on this team has a score tonight.'}
        />
      )}
    </div>
  );
}

type PageTab = 'booms' | 'teams';

/** Cuts on the standard-normal score. 0 is the expected night. */
const SCORE_BANDS = [
  { mark: '≤ −1.8', title: 'Bust', text: 'Far under his usual game', bar: 'bg-red-500' },
  { mark: '−1.8 to −1', title: 'Poor', text: 'Under his usual game', bar: 'bg-red-300' },
  { mark: '−1 to +1', title: 'Usual', text: 'Around his usual game', bar: 'bg-gray-400' },
  { mark: '+1 to +1.8', title: 'Strong', text: 'Above his usual game', bar: 'bg-blue-300' },
  { mark: '≥ +1.8', title: 'Boom', text: 'Far above his usual game', bar: 'bg-blue-500' },
] as const;

function ScoreScale({ perGame }: { perGame: boolean }) {
  return (
    <section aria-label="Score scale" className="rounded-lg border border-gray-200 bg-white px-3 py-3 shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <div className="flex h-2 overflow-hidden rounded-full">
        {SCORE_BANDS.map((band) => (
          <div key={band.title} className={`h-full flex-1 ${band.bar}`} />
        ))}
      </div>
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
      <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
        0 is the game he was expected to have.
        {perGame ? ' On a span, the score is the average of those nights, so it sits closer to 0.' : ''}
      </p>
    </section>
  );
}

function NightBody({
  night, minGp, topN, teamId, onTeam, pageTab,
}: {
  night: NightSurprises
  minGp: number
  topN: TopN | null
  teamId: TeamPick
  onTeam: (id: TeamPick) => void
  pageTab: PageTab
}) {
  const good = useThreshold('good', night.thresholds.good);
  const bad = useThreshold('bad', night.thresholds.bad);
  const booms = useMemo(() => shownRows(night.good, 'good', good.value, minGp, topN), [night.good, good.value, minGp, topN]);
  const busts = useMemo(() => shownRows(night.bad, 'bad', bad.value, minGp, topN), [night.bad, bad.value, minGp, topN]);
  const perGame = night.days != null;
  const dateLabel = perGame && night.start_date
    ? `${fmtDay(night.start_date, false)} – ${fmtDay(night.game_date, false)}`
    : fmtDay(night.game_date, false);
  const shareText = useMemo(
    () => buildShareMessage(dateLabel, booms.slice(0, SHARE_ROWS), busts.slice(0, SHARE_ROWS), `${window.location.origin}/boom-or-bust`),
    [dateLabel, booms, busts],
  );
  return (
    <>
      <ScoreScale perGame={perGame} />
      {pageTab === 'booms' ? (
        <>
          <div className="flex justify-end">
            <ShareCardButton
              title="Boom or Bust"
              shareText={shareText}
              renderCard={({ dark }) => (
                <BoomOrBustShareCard
                  dark={dark}
                  dateLabel={perGame ? dateLabel : fmtDay(night.game_date, true)}
                  games={night.games}
                  booms={booms}
                  busts={busts}
                  thresholds={{ good: good.value, bad: bad.value }}
                  perGame={perGame}
                  eyebrow={perGame ? `${night.days} days` : 'last night'}
                  topN={topN}
                />
              )}
            />
          </div>
          <div className="space-y-6">
            <SurpriseCard title="💥 Booms" kind="good" threshold={good} shown={booms} perGame={perGame} topN={topN} minGp={minGp} />
            <SurpriseCard title="💩 Busts" kind="bad" threshold={bad} shown={busts} perGame={perGame} topN={topN} minGp={minGp} />
          </div>
        </>
      ) : (
        <TeamScores night={night} perGame={perGame} booms={booms} busts={busts} teamId={teamId} onTeam={onTeam} />
      )}
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {perGame
          ? `Each score is that player's nightly scores over these ${night.days} days, added up and divided by the games he played. A night he sat out is left out.`
          : 'Scores compare each player with his own history and with what the model expected for his minutes. Players without a model estimate yet (fewer than 10 games this season) are scored on their own history only.'}
        {' '}Computed {new Date(night.computed_at).toLocaleString('en-US')}.
      </p>
    </>
  );
}

function viewSubtitle(view: NightSurprises): string {
  const scored = `${view.players_scored} of ${view.players_played} players scored · ${view.players_with_estimate} with a model estimate`;
  if (view.days != null && view.start_date) {
    return `${fmtDay(view.start_date, false)} – ${fmtDay(view.game_date, false)} · ${view.days} days · ${view.games} games · ${scored}`;
  }
  return `${fmtDay(view.game_date, true)} · ${view.games} games · ${scored}`;
}

export default function BoomOrBust() {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [rangeDays, setRangeDays] = useState<RangeDays | null>(null);
  const [minGp, setMinGp] = useState(1);
  const [topN, setTopN] = useState<TopN | null>(null);
  const [fantasyTeamId, setFantasyTeamId] = useState<TeamPick>(null);
  const [pageTab, setPageTab] = useState<PageTab>('booms');
  const { data: dates = [] } = useGetSurpriseDatesQuery();
  const latest = useGetLatestSurprisesQuery(undefined, { skip: selectedDate !== null });
  const forDate = useGetSurprisesForDateQuery(selectedDate ?? '', { skip: selectedDate === null });
  const range = useGetSurpriseRangeQuery(
    { days: rangeDays ?? 7, end: null },
    { skip: rangeDays === null },
  );
  // currentData, not data: data keeps the previous view while the next one loads.
  const nightQuery = selectedDate === null ? latest : forDate;
  const active = rangeDays === null ? nightQuery : range;
  const { currentData: night, isLoading, isFetching, error } = active;

  // "No games last night" comes from the nightly's own ledger, not the viewer's
  // clock: the newest run handled a later night than the one shown and found no
  // games. Before the nightly has run for a night, nothing is claimed.
  const noGamesRun = useMemo(() => {
    const run = night?.latest_run;
    return run && run.status === 'no_games' && run.game_date > night.game_date ? run : null;
  }, [night]);

  let body;
  if (isLoading || (isFetching && !night)) {
    body = <LoadingSpinner />;
  } else if (error && isNotFound(error)) {
    body = (
      <div className="bg-white dark:bg-gray-900 shadow-lg rounded-lg border border-gray-200 dark:border-gray-700 p-8 text-center text-gray-500 dark:text-gray-400">
        {rangeDays === null
          ? 'No nights scored yet. The nightly job fills this page every morning.'
          : 'No scored games in this span.'}
      </div>
    );
  } else if (error || !night) {
    body = <ErrorMessage message={rangeDays === null ? "Failed to load last night's surprises." : 'Failed to load this span.'} />;
  } else {
    body = (
      <NightBody
        key={`${night.days ?? 'night'}-${night.game_date}`}
        night={night}
        minGp={rangeDays == null ? 1 : minGp}
        topN={topN}
        teamId={fantasyTeamId}
        onTeam={setFantasyTeamId}
        pageTab={pageTab}
      />
    );
  }

  const rangeBtn = (on: boolean) =>
    `rounded-md px-1.5 py-1.5 text-center text-xs font-medium whitespace-nowrap transition-all duration-200 sm:px-3 ${
      on ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-800'
    }`;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Boom or Bust</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {night ? viewSubtitle(night) : rangeDays ? `Last ${rangeDays} days` : 'Surprises and disappointments of the last NBA night.'}
          </p>
        </div>
        {rangeDays === null && dates.length > 0 && (
          <select
            aria-label="Scored night"
            value={selectedDate ?? dates[0]}
            onChange={(event) => {
              const value = event.target.value;
              setSelectedDate(value === dates[0] ? null : value);
            }}
            className="max-w-full truncate rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
          >
            {dates.map((date, index) => (
              <option key={date} value={date}>
                {index === 0 ? `Latest · ${fmtDay(date, true)}` : fmtDay(date, true)}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="grid w-full grid-cols-4 gap-1.5 rounded-lg bg-gray-100 p-1 sm:flex sm:w-auto" role="group" aria-label="Score span">
          {RANGES.map((rangeOption) => (
            <button
              key={rangeOption.label}
              type="button"
              aria-pressed={rangeDays === rangeOption.days}
              onClick={() => setRangeDays(rangeOption.days)}
              className={rangeBtn(rangeDays === rangeOption.days)}
            >
              {rangeOption.label}
            </button>
          ))}
        </div>
        {rangeDays != null && (
          <div className="flex w-full items-center gap-1.5 rounded-lg bg-gray-100 p-1 sm:w-auto" role="group" aria-label="Minimum games">
            <span className="px-1.5 text-xs font-medium text-gray-500 dark:text-gray-300">Min GP</span>
            {MIN_GP_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={minGp === n}
                aria-label={`At least ${n} ${n === 1 ? 'game' : 'games'}`}
                onClick={() => setMinGp(n)}
                className={`flex-1 sm:flex-none ${rangeBtn(minGp === n)}`}
              >
                {n}
              </button>
            ))}
          </div>
        )}
        {pageTab === 'booms' && (
          <div className="grid w-full grid-cols-4 gap-1.5 rounded-lg bg-gray-100 p-1 sm:flex sm:w-auto" role="group" aria-label="List mode">
            <button
              type="button"
              aria-pressed={topN === null}
              onClick={() => setTopN(null)}
              className={rangeBtn(topN === null)}
            >
              Slider
            </button>
            {TOP_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={topN === n}
                onClick={() => setTopN(n)}
                className={rangeBtn(topN === n)}
              >
                Top {n}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex w-full rounded-lg bg-gray-100 p-1 sm:w-fit" role="tablist" aria-label="View">
        {([
          ['booms', 'Boom or Bust'],
          ['teams', 'By team'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={pageTab === id}
            onClick={() => setPageTab(id)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-all duration-200 sm:flex-none ${
              pageTab === id ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {night && noGamesRun && selectedDate === null && rangeDays === null && (
        <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 rounded-lg px-4 py-3 text-sm">
          No games on {fmtDay(noGamesRun.game_date, false)} — showing the latest night with results ({fmtDay(night.game_date, false)}).
        </div>
      )}

      {body}
    </div>
  );
}
