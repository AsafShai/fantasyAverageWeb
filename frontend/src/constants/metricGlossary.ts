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
} as const satisfies Record<string, MetricInfo>

export type MetricKey = keyof typeof METRIC_GLOSSARY
