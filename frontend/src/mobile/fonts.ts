const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap'
const LINK_ID = 'mr-fonts'

/**
 * Loads Inter + Space Grotesk the first time the redesign renders, so phones
 * on the old layout and desktop never download them.
 */
export function ensureMobileFonts(doc: Document = document): void {
  if (doc.getElementById(LINK_ID)) return
  const link = doc.createElement('link')
  link.id = LINK_ID
  link.rel = 'stylesheet'
  link.href = FONT_HREF
  doc.head.appendChild(link)
}
