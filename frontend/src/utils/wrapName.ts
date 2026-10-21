// On mobile, only names this long wrap onto a second line, and only between
// words: hyphenated names (Alexander-Walker) get a non-breaking hyphen.
export const LONG_NAME_CHARS = 16
export const isLongName = (name: string) => name.length > LONG_NAME_CHARS
export const wrapFriendlyName = (name: string) => name.replaceAll('-', '‑')

/** Width/wrap classes for a sticky name cell: a long name wraps within 38% of
 * the screen on phones and stays on one line from `sm` up. */
export const nameCellWrapClass = (name: string) =>
  isLongName(name) ? 'max-w-[38vw] whitespace-normal sm:max-w-none sm:whitespace-nowrap' : 'whitespace-nowrap'
