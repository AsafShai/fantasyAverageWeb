import type { Team } from '../../../types/api'
import { FantasyTeamFilterChips } from '../../../components/playerRankings/FantasyTeamFilterChips'
import { LIMITS, POSITIONS, type RankingsFilters } from './filters'
import { Chip, ChipRow, FilterGroup, FiltersSheet, PositionFilter } from '../../ui'

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
    f.setPositions([])
    f.setFantasyTeam(null)
    f.setDisplayLimit(null)
    f.setMinGp(0)
    f.setMinMin(0)
  }
  return (
    <FiltersSheet open={open} onClose={onClose} onReset={reset}>
      <PositionFilter options={POSITIONS} selected={f.positions} onChange={f.setPositions} />
      <FilterGroup label="Fantasy team">
        <FantasyTeamFilterChips
          wrap
          value={f.fantasyTeam}
          onChange={f.setFantasyTeam}
          teams={teams}
          myTeamId={myTeamId}
          isMyTeam={isMyTeam}
        />
      </FilterGroup>
      <FilterGroup label="Show">
        <ChipRow label="Show" wrap>
          {LIMITS.map((n) => (
            <Chip key={n} selected={f.displayLimit === n} onClick={() => f.setDisplayLimit(n)}>Top {n}</Chip>
          ))}
          <Chip selected={f.displayLimit === null} onClick={() => f.setDisplayLimit(null)}>All</Chip>
        </ChipRow>
      </FilterGroup>
      <div className="mr-pr-mins">
        <NumberStep label="Min GP" value={f.minGp} onChange={f.setMinGp} />
        <NumberStep label="Min MPG" value={f.minMin} onChange={f.setMinMin} />
      </div>
    </FiltersSheet>
  )
}

function NumberStep({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const set = (n: number) => onChange(Math.max(0, Number.isFinite(n) ? n : 0))
  return (
    <FilterGroup label={label}>
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
    </FilterGroup>
  )
}
