import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMyTeam } from '../../context/MyTeamContext'
import {
  useGetBoxSlateValuesQuery,
  useGetRankChangesQuery,
  useGetRankingsQuery,
  useGetSurprisesForDateQuery,
  useGetTodayHubQuery,
} from '../../store/api/fantasyApi'
import { slatePlayerValues } from '../boxScores/slateValues'
import { ShareCardButton, type ShareCardOptions } from '../share/ShareCardButton'
import { DailyRecapLoadingCard, DailyRecapShareCard } from '../share/DailyRecapShareCard'
import { toLocalIso } from '../../utils/dateRange'
import { buildDailyRecap, dailyRecapMessage, isOffNight, recapNightLabel, RECAP_SURPRISE_BAR } from '../../utils/dailyRecap'

interface QueryState {
  data?: unknown
  isError: boolean
  isLoading: boolean
  isFetching: boolean
  isUninitialized: boolean
}

/** Still waiting on a query that has not failed. A skipped query is not waiting. */
function pending(query: QueryState, enabled: boolean): boolean {
  if (!enabled) return false
  return query.data == null && !query.isError && (query.isLoading || query.isFetching || query.isUninitialized)
}

/** The day after an ISO date, in the viewer's calendar. */
function dayAfter(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() + 1)
  return toLocalIso(date)
}

function DailyRecapLoader({ dark, highlightMyTeam, seasonStart, onReady }: ShareCardOptions & {
  seasonStart?: string
  onReady: (key: string, text: string | undefined) => void
}) {
  const { myTeam } = useMyTeam()
  // Opening Share refetches the hub, so the night is the one the nightly job
  // has finished, not a slate that has only just tipped.
  const hub = useGetTodayHubQuery(undefined, { refetchOnMountOrArgChange: true })
  const hubWaiting = !hub.isError && (hub.isUninitialized || hub.isLoading || hub.isFetching || hub.data == null)
  const nightly = hub.data?.last_nightly
  const night = nightly?.game_date ?? null
  // An off night has no slate and no new standings. Rank changes would
  // otherwise repeat the previous scoring period on this poster.
  const offNight = isOffNight(nightly?.status)
  const start = night == null ? '' : (seasonStart && night < seasonStart ? seasonStart : night)
  const end = night == null ? '' : dayAfter(night)
  const rangeOk = !hubWaiting && !offNight && start !== '' && start < end
  const rankings = useGetRankingsQuery({ startDate: start, endDate: end, settled: true }, { skip: !rangeOk })
  const moves = useGetRankChangesQuery({ mode: 'averages', settled: true }, { skip: hubWaiting || offNight })
  const surprises = useGetSurprisesForDateQuery(night ?? '', { skip: !night || hubWaiting || offNight })
  const slate = useGetBoxSlateValuesQuery(night ?? '', { skip: !night || hubWaiting || offNight })

  const players = useMemo(
    () => (slate.data?.categories != null ? slatePlayerValues(slate.data) : []),
    [slate.data],
  )
  const recap = useMemo(() => buildDailyRecap(offNight ? {
    rankings: [],
    categories: [],
    moves: [],
    players: [],
    good: [],
    bad: [],
    thresholds: RECAP_SURPRISE_BAR,
  } : {
    rankings: rankings.data?.averages_rankings ?? [],
    categories: rankings.data?.categories ?? [],
    moves: moves.data?.teams ?? [],
    players,
    good: surprises.data?.good ?? [],
    bad: surprises.data?.bad ?? [],
    thresholds: RECAP_SURPRISE_BAR,
  }), [offNight, rankings.data, moves.data, players, surprises.data])

  // The poster's typefaces ride inside the card (see recapFonts.ts). Loaded
  // here so they cost nothing until someone opens Share; if the chunk fails
  // the poster still goes out, in the system's condensed faces.
  const [fontCss, setFontCss] = useState<string | null>(null)
  const [fontsSettled, setFontsSettled] = useState(false)
  useEffect(() => {
    let live = true
    import('../share/recapFonts')
      .then(fonts => { if (live) setFontCss(fonts.RECAP_FONT_CSS) })
      .catch(() => undefined)
      .finally(() => { if (live) setFontsSettled(true) })
    return () => { live = false }
  }, [])

  const waiting = hubWaiting
    || !fontsSettled
    || pending(rankings, rangeOk)
    || pending(moves, !hubWaiting)
    || pending(surprises, !!night && !hubWaiting)
    || pending(slate, !!night && !hubWaiting)
  const label = recapNightLabel(
    offNight ? null : rankings.data?.actual_start_date,
    offNight ? null : rankings.data?.actual_end_date,
    night,
  )
  const subtitle = label.linesNote ? `${label.headline} · lines ${label.linesNote}` : label.headline
  const key = waiting ? 'loading' : [
    label.headline,
    label.linesNote ?? '',
    recap.best?.teamId, recap.best?.total,
    recap.worst?.teamId, recap.worst?.total,
    recap.rise?.teamId, recap.rise?.totalDelta,
    recap.fall?.teamId, recap.fall?.totalDelta,
    recap.lines.map(player => player.id).join(','),
    recap.freeAgents.map(player => player.id).join(','),
    recap.started?.id ?? '',
    recap.benched?.id ?? '',
    recap.boom.shown.map(row => row.id).join(','),
    recap.bust.shown.map(row => row.id).join(','),
  ].join('|')
  const text = waiting ? undefined : dailyRecapMessage(label.headline, recap.best, `${window.location.origin}/`)

  useEffect(() => { onReady(key, text) }, [key, text, onReady])

  if (waiting) return <DailyRecapLoadingCard dark={dark} fontCss={fontCss ?? undefined} />
  return (
    <DailyRecapShareCard
      dark={dark}
      subtitle={subtitle}
      recap={recap}
      highlight={highlightMyTeam}
      myTeam={myTeam}
      fontCss={fontCss ?? undefined}
    />
  )
}

/** Share button for the Today page. Requests start when the menu opens.
 * The night is the last one the nightly job finished, never the live slate. */
export function DailyRecapShare({ sheet = false, seasonStart }: { sheet?: boolean; seasonStart?: string }) {
  const [contentKey, setContentKey] = useState('loading')
  const [shareText, setShareText] = useState<string | undefined>()
  const onReady = useCallback((key: string, text: string | undefined) => {
    setContentKey(prev => (prev === key ? prev : key))
    setShareText(prev => (prev === text ? prev : text))
  }, [])

  return (
    <ShareCardButton
      title="Fantasy Daily Recap"
      contentKey={contentKey}
      pending={contentKey === 'loading'}
      shareText={shareText}
      highlightOption
      sheet={sheet}
      variant="neutral"
      renderCard={options => (
        <DailyRecapLoader {...options} seasonStart={seasonStart} onReady={onReady} />
      )}
    />
  )
}
