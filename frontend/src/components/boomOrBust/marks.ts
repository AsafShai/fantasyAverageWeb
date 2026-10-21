/** Three steps of green or red by how far the stat sits from the player's norm,
 * at the same rarity on both sides. The bad side is compressed by construction
 * (a stat cannot go below zero): on real nights the 95th percentile is 2.9 for
 * good cells and 1.4 for bad ones, so the bars differ per sign.
 *   good: 1.0 clear, 1.5 strong, 2.25 extreme (solid)
 *   bad:  0.7 clear, 0.95 strong, 1.2 extreme (solid) */
const STEPS = { good: [1.5, 2.25], bad: [0.95, 1.2] } as const;

export function markClass(sign: 'good' | 'bad', z: number): string {
  const [strong, extreme] = STEPS[sign];
  const level = Math.abs(z) >= extreme ? 3 : Math.abs(z) >= strong ? 2 : 1;
  const base = 'inline-block rounded-md px-1.5 py-0.5 font-bold tabular-nums';
  const tone = sign === 'good'
    ? ['text-emerald-700 bg-emerald-50 ring-1 ring-emerald-400/40 dark:text-emerald-300 dark:bg-emerald-900/30',
       'text-emerald-800 bg-emerald-100 ring-1 ring-emerald-500/50 dark:text-emerald-200 dark:bg-emerald-800/50',
       'text-white bg-emerald-600 dark:bg-emerald-500'][level - 1]
    // the red runs a notch stronger than the green at each step: a bust should
    // read at a glance, and red loses more than green when WhatsApp recompresses
    : ['text-rose-800 bg-rose-100 ring-1 ring-rose-500/50 dark:text-rose-200 dark:bg-rose-900/40',
       'text-rose-900 bg-rose-200 ring-1 ring-rose-600/60 dark:text-rose-100 dark:bg-rose-800/60',
       'text-white bg-rose-700 dark:bg-rose-600'][level - 1];
  return `${base} ${tone}`;
}
