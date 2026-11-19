import anton from '@fontsource/anton/files/anton-latin-400-normal.woff2?inline'
import barlow500 from '@fontsource/barlow-condensed/files/barlow-condensed-latin-500-normal.woff2?inline'
import barlow600 from '@fontsource/barlow-condensed/files/barlow-condensed-latin-600-normal.woff2?inline'
import barlow700 from '@fontsource/barlow-condensed/files/barlow-condensed-latin-700-normal.woff2?inline'

function face(family: string, weight: number, dataUrl: string): string {
  return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:block;src:url(${dataUrl}) format('woff2')}`
}

/** The Daily Recap poster's two typefaces, as data URLs. The PNG is painted
 * from an SVG image of the card, and an SVG image can fetch nothing: a font
 * reaches it only if the rule and the file travel inside the card itself.
 * About 110 KB of base64, so it is imported when the Share menu opens, not
 * with the page. Latin only: other scripts fall back to the system font. */
export const RECAP_FONT_CSS = [
  face('Anton', 400, anton),
  face('Barlow Condensed', 500, barlow500),
  face('Barlow Condensed', 600, barlow600),
  face('Barlow Condensed', 700, barlow700),
].join('')
