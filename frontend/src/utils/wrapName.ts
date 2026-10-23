// On mobile, only names this long wrap onto a second line, and only between
// words: hyphenated names (Alexander-Walker) get a non-breaking hyphen.
export const LONG_NAME_CHARS = 16
export const isLongName = (name: string) => name.length > LONG_NAME_CHARS
export const wrapFriendlyName = (name: string) => name.replaceAll('-', '‑')

/** Width/wrap classes for a sticky name cell: a long name wraps within 38% of
 * the screen on phones and stays on one line from `sm` up. */
export const nameCellWrapClass = (name: string) =>
  isLongName(name) ? 'max-w-[38vw] whitespace-normal sm:max-w-none sm:whitespace-nowrap' : 'whitespace-nowrap'

/** Standings team-name cell: on phones the name sits in a fixed 34%-wide box and
 * wraps between words onto at most two lines (the fixed width keeps the table
 * from squeezing it when there are many stat columns); from `sm` up it stays on
 * one line. */
export const TEAM_NAME_CELL_CLASS = 'whitespace-normal px-3 sm:whitespace-nowrap sm:px-6'
export const TEAM_NAME_BOX_CLASS =
  'w-[34vw] line-clamp-2 break-words text-[13px] leading-snug sm:w-auto sm:line-clamp-none sm:text-sm'
