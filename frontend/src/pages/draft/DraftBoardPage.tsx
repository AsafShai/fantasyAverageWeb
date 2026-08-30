import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useGetAdpQuery } from '../../store/api/fantasyApi'
import { usePersistedState } from '../../hooks/usePersistedState'
import { useBlendSites } from '../../hooks/useBlendSites'
import { getErrorMessage } from '../../utils/errorMessage'
import LoadingSpinner from '../../components/LoadingSpinner'
import ErrorMessage from '../../components/ErrorMessage'
import PlayerIdentityCell from '../../components/draft/PlayerIdentityCell'
import LeagueSettingsModal from '../../components/draft/LeagueSettingsModal'
import {
  BLEND_LABEL,
  DEFAULT_DRAFT_METRIC,
  DEFAULT_LEAGUE_SETTINGS,
  SITE_LABEL,
  annotateDraftPicks,
  clampLeagueSettings,
  draftTeamColor,
  formatUpdatedAt,
  groupDraftPicksByTeam,
  threeRrDisplayRounds,
  type DraftBoardPick,
  type LeagueBoardSettings,
} from '../../utils/adp'
import type { AdpMetric, AdpPlayer, ProviderMeta } from '../../types/api'

type BoardShowBy = 'round' | 'team'

function BoardPlayerCard({ entry }: { entry: DraftBoardPick<AdpPlayer> }) {
  const { player: p, pick, team, round, pickInRound } = entry
  return (
    <div className={`rounded-md border p-2 ${draftTeamColor(team - 1)}`}>
      <div className="text-[10px] text-gray-600 dark:text-gray-300 mb-1 leading-tight">
        Team {team} · #{pick}
        <div>
          Round {round}, pick {pickInRound}
        </div>
      </div>
      <PlayerIdentityCell
        name={p.name}
        playerId={p.espn_id}
        photoUrl={p.photo_url}
        teamAbbr={p.team_abbr}
        positions={p.positions}
        wrapName
      />
    </div>
  )
}

export default function DraftBoardPage() {
  const [showBy, setShowBy] = usePersistedState<BoardShowBy>('draft.adp.showBy', 'round')
  const [metric, setMetric] = usePersistedState<AdpMetric>('draft.board.metric', DEFAULT_DRAFT_METRIC)
  const [leagueRaw, setLeagueRaw] = usePersistedState<LeagueBoardSettings>(
    'draft.board.league',
    DEFAULT_LEAGUE_SETTINGS,
  )
  const league = useMemo(() => clampLeagueSettings(leagueRaw), [leagueRaw])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const pickCount = league.teams * league.rounds
  const [providers, setProviders] = useState<ProviderMeta[] | undefined>(undefined)
  const { sites, available, toggle, sitesParam, rankSitesParam } = useBlendSites(metric, providers)
  const { data, isLoading, isFetching, error } = useGetAdpQuery({
    page: 1,
    page_size: pickCount,
    sort: 'blend',
    sort_dir: 'asc',
    sites: sitesParam,
    rank_sites: rankSitesParam,
    metric,
    include_stats: false,
  })
  if (data?.providers?.length && data.providers !== providers) setProviders(data.providers)
  const players = data?.players ?? []
  const boardPicks = useMemo(
    () => annotateDraftPicks(players.slice(0, pickCount), league.teams, league.threeRr),
    [players, pickCount, league.teams, league.threeRr],
  )
  const boardRounds = useMemo(() => threeRrDisplayRounds(boardPicks, league.teams), [boardPicks, league.teams])
  const boardTeams = useMemo(() => groupDraftPicksByTeam(boardPicks, league.teams), [boardPicks, league.teams])

  if (isLoading && !data) return <LoadingSpinner />
  if (error) return <ErrorMessage message={getErrorMessage(error, 'Failed to load ADP')} />

  return (
    <div className="max-w-screen-2xl mx-auto px-4 sm:px-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Draft Board</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {league.teams}-team{league.threeRr ? ', 3-round reverse' : ' snake'}, {league.rounds} rounds — top{' '}
            {pickCount} by {BLEND_LABEL[metric]}.
          </p>
          {data?.updated_at ? (
            <p className="text-xs text-gray-400 mt-1">Updated {formatUpdatedAt(data.updated_at)}</p>
          ) : null}
        </div>
        <div className="flex flex-col items-start sm:items-end gap-1">
          <Link to="/draft/rankings-adp" className="text-sm text-blue-700 dark:text-blue-300 hover:underline whitespace-nowrap">
            Rankings &amp; ADP
          </Link>
          <Link to="/draft/rankings" className="text-sm text-blue-700 dark:text-blue-300 hover:underline whitespace-nowrap">
            Open pre-draft rankings
          </Link>
        </div>
      </div>

      <div className="card p-4 mb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Blend sites</span>
          {available.map((site) => (
            <label key={site} className="inline-flex items-center gap-1.5 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={sites.includes(site)}
                onChange={() => toggle(site)}
                className="rounded border-gray-300"
              />
              {SITE_LABEL[site]}
            </label>
          ))}
          <span className="hidden lg:inline text-xs text-gray-400">Shared with the ADP / Rankings page</span>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Order by</span>
            {(['adp', 'rank'] as AdpMetric[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setMetric(key)}
                className={`px-2 py-1 rounded text-xs font-semibold border ${
                  metric === key
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'
                }`}
              >
                {BLEND_LABEL[key]}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Show by</span>
          {(['round', 'team'] as BoardShowBy[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setShowBy(mode)}
              className={`px-2 py-1 rounded text-xs font-semibold border ${
                showBy === mode
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'
              }`}
            >
              {mode === 'round' ? 'Round' : 'Team'}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="ml-auto px-2 py-1 rounded text-xs font-semibold border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300"
          >
            Manage league settings
          </button>
        </div>
      </div>

      <div className={isFetching ? 'opacity-70' : undefined}>
        <div className="space-y-4">
          {showBy === 'team'
            ? boardTeams.map((group) => (
                <div key={group.team} className="card overflow-hidden">
                  <div
                    className={`px-4 py-2 text-xs font-semibold uppercase tracking-wide border-b border-gray-200 dark:border-gray-700 ${draftTeamColor(group.team - 1)}`}
                  >
                    Team {group.team}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 p-3">
                    {group.picks.map((entry) => (
                      <BoardPlayerCard key={entry.player.id} entry={entry} />
                    ))}
                  </div>
                </div>
              ))
            : boardRounds.map((round, i) => (
                <div key={i} className="card overflow-hidden">
                  <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 border-b border-gray-200 dark:border-gray-700">
                    Round {i + 1}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 p-3">
                    {round.map((entry) => (
                      <BoardPlayerCard key={entry.player.id} entry={entry} />
                    ))}
                  </div>
                </div>
              ))}
        </div>
      </div>
      {settingsOpen ? (
        <LeagueSettingsModal
          settings={league}
          onConfirm={(next) => {
            setLeagueRaw(clampLeagueSettings(next))
            setSettingsOpen(false)
          }}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </div>
  )
}
