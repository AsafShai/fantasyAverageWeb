export interface MetricInfo {
  title: string
  body: string
  formula?: string
}

export const METRIC_GLOSSARY = {
  totalZ: {
    title: 'Z-score columns',
    body: 'How far above average, overall or per category. Higher is better. Green = above average, red = below.',
    formula: '0 = average',
  },
  categoryZ: {
    title: 'Category Z-score',
    body: 'How far above average in this stat. Green = above, red = below.',
  },
  slotRate: {
    title: 'Slot rate',
    body: 'Games used here vs the NBA average pace. High = burning this slot fast.',
  },
  slotMax: {
    title: 'Slot max',
    body: "Most games this slot can still reach. Below cap means that ceiling's gone.",
  },
  slotEstimated: {
    title: 'Slot estimated',
    body: 'Realistic projection for this slot by season end — plan around this number.',
  },
  scheduleTotal: {
    title: 'Total games',
    body: 'Published regular-season games for this team in the schedule currently available from ESPN.',
  },
  scheduleB2B: {
    title: 'Back-to-backs',
    body: 'Games played with no rest day since the previous game. A back-to-back has rest days = 0.',
  },
  scheduleHighVolume: {
    title: 'High-volume games',
    body: 'Games on nights with at least 10 NBA games league-wide. This is a sparse slate-density flag, not a recommendation.',
  },
  slateSize: {
    title: 'Games per night',
    body: 'NBA games league-wide on that date. Fifteen is the theoretical maximum; a real night runs 2 to 13.',
  },
  slateDelta: {
    title: 'Games vs typical',
    body: 'Whole games above or below the count most teams have in this window. A dash means ordinary. Over short windows almost every team is ordinary, so this only separates the extremes.',
  },
  slateB2B: {
    title: 'Back-to-backs in window',
    body: 'Games this team plays on the night straight after another game, inside the selected window.',
  },
} as const satisfies Record<string, MetricInfo>

export type MetricKey = keyof typeof METRIC_GLOSSARY
