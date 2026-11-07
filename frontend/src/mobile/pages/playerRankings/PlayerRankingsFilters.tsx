import type { ReactNode } from 'react'
import { fantasyTeamOptionLabel, leadWithMyTeam } from '../../../myTeam/display'
import type { Team } from '../../../types/api'
import { LIMITS, POSITIONS, type RankingsFilters } from './filters'
import { BottomSheet, Button, Chip, ChipRow } from '../../ui'

interface Props {
  open: boolean
  onClose: () => void
  filters: RankingsFilters
  teams: Team[]
  myTeamId: number | null
  isMyTeam: (teamId: number) => boolean
}

/**
 * Filters sheet: exactly today's Player Rankings filters (Position, Fantasy
 * team, Show, Min GP, Min MPG). Filters apply as they change; "Show results"
 * closes the sheet.
 */
export function PlayerRankingsFilters({ open, onClose, filters: f, teams, myTeamId, isMyTeam }: Props) {
  const reset = () => {
    f.setPosition(null)
    f.setFantasyTeam(null)
    f.setDisplayLimit(null)
    f.setMinGp(0)
    f.setMinMin(0)
  }
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Filters"
      action={<button type="button" className="mr-link" onClick={reset}>Reset</button>}
    >
      <Group label="Position">
        <Chip selected={f.position === null} onClick={() => f.setPosition(null)}>All</Chip>
        {POSITIONS.map((p) => (
          <Chip key={p} selected={f.position === p} onClick={() => f.setPosition(p)}>{p}</Chip>
        ))}
      </Group>
      <Group label="Fantasy team">
        <Chip selected={f.fantasyTeam === null} onClick={() => f.setFantasyTeam(null)}>All</Chip>
        <Chip selected={f.fantasyTeam === 'rostered'} onClick={() => f.setFantasyTeam('rostered')}>Rostered</Chip>
        <Chip selected={f.fantasyTeam === 0} onClick={() => f.setFantasyTeam(0)}>Free Agents / Waivers</Chip>
        {leadWithMyTeam(teams, myTeamId).map((t) => (
          <Chip key={t.team_id} selected={f.fantasyTeam === t.team_id} onClick={() => f.setFantasyTeam(t.team_id)}>
            {fantasyTeamOptionLabel(t.team_name, isMyTeam(t.team_id))}
          </Chip>
        ))}
      </Group>
      <Group label="Show">
        {LIMITS.map((n) => (
          <Chip key={n} selected={f.displayLimit === n} onClick={() => f.setDisplayLimit(n)}>Top {n}</Chip>
        ))}
        <Chip selected={f.displayLimit === null} onClick={() => f.setDisplayLimit(null)}>All</Chip>
      </Group>
      <div className="mr-pr-mins">
        <NumberStep label="Min GP" value={f.minGp} onChange={f.setMinGp} />
        <NumberStep label="Min MPG" value={f.minMin} onChange={f.setMinMin} />
      </div>
      <Button variant="primary" onClick={onClose}>Show results</Button>
    </BottomSheet>
  )
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mr-pr-group">
      <span className="mr-pr-glabel">{label}</span>
      <ChipRow label={label} wrap>{children}</ChipRow>
    </div>
  )
}

function NumberStep({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const set = (n: number) => onChange(Math.max(0, Number.isFinite(n) ? n : 0))
  return (
    <div className="mr-pr-group">
      <span className="mr-pr-glabel">{label}</span>
      <span className="mr-step">
        <button type="button" aria-label={`Decrease ${label}`} disabled={value <= 0} onClick={() => set(value - 1)}>−</button>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          aria-label={label}
          value={value}
          onChange={(e) => set(Number(e.target.value))}
        />
        <button type="button" aria-label={`Increase ${label}`} onClick={() => set(value + 1)}>+</button>
      </span>
    </div>
  )
}
