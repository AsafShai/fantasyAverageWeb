import { liveMoment, type LiveBlock } from './live'

/**
 * Wording for what "tonight" changes on Rankings, Today, the heatmap, date
 * ranges and Rankings Over Time (design canvas, plan section 7 step 4). Every
 * helper returns the official wording, or null, when the response has no
 * `live` block (backend flag off) or tonight is not live, so pages read as
 * they always did.
 */

/** What ▲/▼ and "GP +" mean beside the Rankings title (decision 7). */
export function moversLegend(live?: LiveBlock | null): string {
  const moment = liveMoment(live)
  if (moment === 'live') return '▲/▼ = change tonight so far, GP + = games counted tonight.'
  if (moment === 'final') return '▲/▼ = change tonight, GP + = games played tonight.'
  return '▲/▼ = change since last night, GP + = games played last night.'
}

export type MoversView = 'tonight' | 'yesterday'

/** The line under Today's Rank movers title; null when official (no switch shown). */
export function moversSubtitle(live: LiveBlock | undefined | null, view: MoversView): string | null {
  const moment = liveMoment(live)
  if (!moment) return null
  if (view === 'yesterday') return 'Roto points, latest official day vs the day before'
  return moment === 'live'
    ? 'Roto points now vs this morning’s official standings (finished games)'
    : 'Roto points after tonight vs this morning’s official standings'
}

/** Top 5 Teams' subtitle while its deltas mean tonight; null otherwise. */
export function topTeamsMeta(live?: LiveBlock | null): string | null {
  return liveMoment(live) ? 'pts · change tonight' : null
}

/** "+N" beside a heatmap GP value: games counted tonight. */
export function tonightGpPlus(live: LiveBlock | undefined | null, n: number | undefined): string | null {
  if (!liveMoment(live) || !n || n <= 0) return null
  return `+${n}`
}

/** A Today league-averages tile whose shown value moved tonight (green outline on the canvas). */
export function changedTile(live: LiveBlock | undefined | null, shown: string, official: string | undefined): boolean {
  return !!liveMoment(live) && official !== undefined && shown !== official
}

/** The League averages subtitle. */
export function leagueAveragesSubtitle(live?: LiveBlock | null): string {
  const moment = liveMoment(live)
  if (moment === 'live') return 'per team, season to date · incl. tonight’s finished games'
  if (moment === 'final') return 'per team, season to date · incl. tonight'
  return 'per team, season to date'
}

const day = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/**
 * The note under a date range that ends today. The backend sends a `live`
 * block on a range only when it reaches tonight, so null means "an ordinary
 * past range" (or the flag off).
 */
export function liveRangeNote(live: LiveBlock | undefined | null, start: string | undefined, end: string | undefined): string | null {
  if (!live || !start || !end) return null
  const moment = liveMoment(live)
  if (moment === 'live') return `${day(start)} – tonight (live). Averages count tonight’s finished games; totals include games in progress.`
  if (moment === 'final') return `${day(start)} – ${day(end)}. Tonight is complete; ESPN official pending.`
  if (live.games_total > 0) return `${day(start)} – ${day(end)}. Today is added once the first game starts.`
  return `${day(start)} – ${day(end)}, all ESPN official.`
}

/** The note under Rankings Over Time while tonight's dashed point is drawn. */
export function liveRaceNote(live?: LiveBlock | null): string | null {
  return liveMoment(live) ? 'The dashed segment is tonight. It is not stored; the solid point replaces it after ESPN’s update.' : null
}

/** Suffix of the per-team keys the dashed tonight segment is drawn from. */
export const LIVE_KEY_SUFFIX = '\u0000tonight'

type RaceRow = Record<string, number | string>

/**
 * Splits the race chart's rows so tonight draws as its own dashed segment:
 * on the live row each team's value moves to `<team>${LIVE_KEY_SUFFIX}`, and
 * the last stored row gets the same key with its stored value, so the dashed
 * line starts where the solid one ends.
 */
export function liveRaceSeries<R extends RaceRow>(rows: R[], liveDate: string | null, teams: string[]): R[] {
  if (!liveDate) return rows
  const liveIdx = rows.findIndex(r => r.date === liveDate)
  if (liveIdx < 0) return rows
  return rows.map((row, i) => {
    if (i === liveIdx) {
      const out: RaceRow = { date: row.date }
      teams.forEach(t => { if (row[t] !== undefined) out[t + LIVE_KEY_SUFFIX] = row[t] })
      return out as R
    }
    if (i === liveIdx - 1) {
      const out: RaceRow = { ...row }
      teams.forEach(t => { if (row[t] !== undefined) out[t + LIVE_KEY_SUFFIX] = row[t] })
      return out as R
    }
    return row
  })
}
