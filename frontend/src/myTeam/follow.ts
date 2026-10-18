/** A value the user chose. Later My Team changes do not overwrite it. */
export const USER_PICK = Symbol('user-pick')

/**
 * undefined means this control has not been filled automatically yet.
 * USER_PICK means the user already had a value, so it stays theirs.
 */
export function resolveFollow<T>(
  current: T | null,
  target: T | null,
  applied: T | null | undefined | typeof USER_PICK,
): { applied: T | null | undefined | typeof USER_PICK; next: T | null } {
  if (target == null) return { applied, next: null }
  if (applied === USER_PICK) return { applied, next: null }
  if (applied === undefined) {
    if (current != null) return { applied: USER_PICK, next: null }
    return { applied: target, next: target }
  }
  if (current === applied && current !== target) return { applied: target, next: target }
  return { applied, next: null }
}
