import type { TradeStart } from '../../hooks/useTradeState'
import type { Player, Team } from '../../types/api'

/**
 * Trade Analyzer opened from the player sheet, with the player already in it:
 *  - rostered by another team (and My Team is set): My Team ⇄ his team, him on
 *    his team's side;
 *  - on My Team, or no My Team set: his team on side A with him picked;
 *  - free agent / waivers: "vs Free Agents" with him picked (My Team on side A
 *    when set).
 */
export function tradePresetForPlayer(player: Player, teams: Team[], myTeamId: number | null): TradeStart {
  const me = { player_name: player.player_name, player_id: player.player_id ?? null }
  const myTeam = myTeamId != null ? teams.find((t) => t.team_id === myTeamId) ?? null : null
  if (player.status !== 'ONTEAM') {
    return { mode: 'freeAgent', teamA: myTeam, teamB: null, playersA: [], playersB: [], freeAgents: [me] }
  }
  const owner =
    teams.find((t) => t.team_id === player.team_id) ??
    { team_id: player.team_id, team_name: player.fantasy_team_name ?? `Team ${player.team_id}` }
  if (myTeam && myTeam.team_id !== owner.team_id) {
    return { mode: 'team', teamA: myTeam, teamB: owner, playersA: [], playersB: [me] }
  }
  return { mode: 'team', teamA: owner, teamB: null, playersA: [me], playersB: [] }
}

/**
 * Where the sheet's Trade Analyzer button goes: /trade with the preset, on the
 * side that holds the player (the phone Trade page shows one side at a time
 * and keeps it in ?side=).
 */
export function tradeLinkForPlayer(player: Player, teams: Team[], myTeamId: number | null) {
  const preset = tradePresetForPlayer(player, teams, myTeamId)
  const onSideB = preset.playersB.length > 0 || (preset.freeAgents?.length ?? 0) > 0
  return { path: onSideB ? '/trade?side=B' : '/trade', state: { tradePreset: preset } }
}
