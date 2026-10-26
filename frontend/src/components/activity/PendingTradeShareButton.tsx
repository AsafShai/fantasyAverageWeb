import { useMemo } from 'react'
import type { Player, TeamDetail } from '../../types/api'
import type { TradePreset } from '../../hooks/useTradeState'
import { useTradeData } from '../../hooks/useTradeData'
import { useMyTeam } from '../../context/MyTeamContext'
import { ShareCardButton } from '../share/ShareCardButton'
import { TradeShareCard, type TradeShareSide } from '../share/TradeShareCard'
import { samePlayer, tradeShareRows } from '../../pages/Trade/utils/tradeShare'

interface PendingTradeShareButtonProps {
  preset: TradePreset
  /** "Processes Tue 11:01 AM", shown under the title. */
  processes: string
}

// The preset's players resolved against the team's season roster, or null
// until the roster loads or when one of them has no stats this season.
function onRoster(team: TeamDetail | undefined, wanted: TradePreset['playersA']): Player[] | null {
  if (!team?.players) return null
  const found = wanted.map(w => team.players!.find(p => samePlayer(p, w)))
  return found.every(p => p !== undefined) ? (found as Player[]) : null
}

/** Shares one pending trade as an image: what each side gets, with the
 * Trade Analyzer's season per-game comparison once the rosters load. */
const PendingTradeShareButton = ({ preset, processes }: PendingTradeShareButtonProps) => {
  const { myTeamId } = useMyTeam()
  const { teamAData, teamBData, playerValue } = useTradeData(preset.teamA, preset.teamB, 'team', 'season')
  const givesA = useMemo(() => onRoster(teamAData, preset.playersA), [teamAData, preset.playersA])
  const givesB = useMemo(() => onRoster(teamBData, preset.playersB), [teamBData, preset.playersB])
  const complete = givesA !== null && givesB !== null

  // Each column is what that team receives: team A gets what team B gives up.
  const sides: [TradeShareSide, TradeShareSide] = [
    {
      heading: `${preset.teamA.team_name} gets`,
      players: givesB?.map(p => ({ name: p.player_name, value: playerValue(p) }))
        ?? preset.playersB.map(p => ({ name: p.player_name })),
    },
    {
      heading: `${preset.teamB.team_name} gets`,
      players: givesA?.map(p => ({ name: p.player_name, value: playerValue(p) }))
        ?? preset.playersA.map(p => ({ name: p.player_name })),
    },
  ]
  const rows = complete ? tradeShareRows(givesB, givesA, 'averages') : []
  const mySide = preset.teamA.team_id === myTeamId ? 0 : preset.teamB.team_id === myTeamId ? 1 : null

  return (
    <ShareCardButton
      title="Trade Accepted"
      highlightOption={mySide !== null}
      contentKey={complete ? 'stats' : 'names'}
      renderCard={({ dark, highlightMyTeam }) => (
        <TradeShareCard
          dark={dark}
          kicker="Pending trade"
          title="Trade Accepted"
          subtitle={complete ? `${processes} · season per game` : processes}
          sides={sides}
          rows={rows}
          mode="averages"
          highlightSide={highlightMyTeam ? mySide : null}
        />
      )}
    />
  )
}

export default PendingTradeShareButton
