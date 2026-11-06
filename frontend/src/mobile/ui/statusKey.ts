/** Normalises "Out", "out", "DAY-TO-DAY" … to OUT / DAY_TO_DAY keys. */
export function statusKey(status: string): string {
  return status.trim().toUpperCase().replace(/[\s-]+/g, '_')
}
