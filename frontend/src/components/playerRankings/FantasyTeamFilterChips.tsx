import { fantasyTeamOptionLabel, leadWithMyTeam } from '../../myTeam/display'
import type { Team } from '../../types/api'
import {
  fantasyTeamChipSelected,
  fantasyTeamPresetSelected,
  setFantasyTeamPreset,
  toggleFantasyTeamSelection,
  type FantasyTeamFilter,
} from '../../mobile/pages/playerRankings/filters'
import { Chip, ChipRow } from '../../mobile/ui'

interface Props {
  value: FantasyTeamFilter
  onChange: (next: FantasyTeamFilter) => void
  teams: Team[]
  myTeamId: number | null
  isMyTeam: (teamId: number) => boolean
  /** Scroll sideways on narrow desktop; wrap in filter sheets. */
  wrap?: boolean
  className?: string
}

/** All · Rostered · FA/Waivers (exclusive) + multi-select per fantasy team. */
export function FantasyTeamFilterChips({ value, onChange, teams, myTeamId, isMyTeam, wrap = false, className = '' }: Props) {
  return (
    <ChipRow label="Fantasy team" wrap={wrap} className={className}>
      <Chip selected={fantasyTeamPresetSelected(value, null)} onClick={() => onChange(setFantasyTeamPreset(value, null))}>
        All
      </Chip>
      <Chip selected={fantasyTeamPresetSelected(value, 'rostered')} onClick={() => onChange(setFantasyTeamPreset(value, 'rostered'))}>
        Rostered
      </Chip>
      <Chip selected={fantasyTeamPresetSelected(value, 0)} onClick={() => onChange(setFantasyTeamPreset(value, 0))}>
        Free Agents / Waivers
      </Chip>
      {leadWithMyTeam(teams, myTeamId).map((t) => (
        <Chip
          key={t.team_id}
          selected={fantasyTeamChipSelected(value, t.team_id)}
          onClick={() => onChange(toggleFantasyTeamSelection(value, t.team_id))}
        >
          {fantasyTeamOptionLabel(t.team_name, isMyTeam(t.team_id))}
        </Chip>
      ))}
    </ChipRow>
  )
}
