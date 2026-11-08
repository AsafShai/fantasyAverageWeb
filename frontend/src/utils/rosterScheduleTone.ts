/** Tailwind classes for roster schedule grid cells (desktop). */
export function rosterScheduleCellClass(focused: boolean, backToBack: boolean): string {
  if (focused && backToBack) {
    return 'bg-amber-100/90 dark:bg-amber-950/45 ring-1 ring-inset ring-blue-400/70 dark:ring-blue-500/50'
  }
  if (focused) return 'bg-blue-100 dark:bg-blue-950/40'
  if (backToBack) return 'bg-amber-50/90 dark:bg-amber-950/30'
  return ''
}

/** Subtle fill for mobile schedule mini-cells in team roster cards. */
export function rosterScheduleMiniCellClass(focused: boolean, backToBack: boolean): string {
  const parts: string[] = ['shrink-0', 'rounded-md', 'border', 'px-2', 'py-1.5', 'text-center', 'text-[10px]', 'leading-tight']
  if (focused && backToBack) {
    parts.push('border-blue-500', 'bg-amber-50', 'dark:border-blue-500', 'dark:bg-amber-950/40')
  } else if (focused) {
    parts.push('border-blue-500', 'bg-blue-50', 'dark:border-blue-500', 'dark:bg-blue-950/40')
  } else if (backToBack) {
    parts.push('border-amber-200/80', 'bg-amber-50/80', 'dark:border-amber-900/60', 'dark:bg-amber-950/35')
  } else {
    parts.push('border-gray-200', 'dark:border-gray-600')
  }
  return parts.join(' ')
}
