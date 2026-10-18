import { useEffect, useRef } from 'react'
import { useMyTeam } from '../context/MyTeamContext'
import { resolveFollow, USER_PICK } from '../myTeam/follow'

/**
 * Fill an empty team control with My Team, and move it when My Team changes
 * if the control is still on the value this hook last wrote. A manual pick,
 * including clearing the control, stays put.
 */
export function useFollowMyTeamValue<T extends string | number>(
  current: T | null,
  target: T | null,
  onApply: (next: T) => void,
) {
  const applied = useRef<T | null | undefined | typeof USER_PICK>(undefined)
  const onApplyRef = useRef(onApply)
  onApplyRef.current = onApply

  useEffect(() => {
    const result = resolveFollow(current, target, applied.current)
    applied.current = result.applied
    if (result.next != null) onApplyRef.current(result.next)
  }, [current, target])
}

export function useFollowMyTeamId(currentId: number | null, onApply: (id: number) => void) {
  const { myTeamId } = useMyTeam()
  useFollowMyTeamValue(currentId, myTeamId, onApply)
}
