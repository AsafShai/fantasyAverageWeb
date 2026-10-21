/** Three steps of green or red by how far the stat sits from the player's norm:
 * |z| from 1 (clear), 1.5 (strong), 2.25 (extreme: solid fill). */
export function markClass(sign: 'good' | 'bad', z: number): string {
  const level = Math.abs(z) >= 2.25 ? 3 : Math.abs(z) >= 1.5 ? 2 : 1;
  const base = 'inline-block rounded-md px-1.5 py-0.5 font-bold tabular-nums';
  const tone = sign === 'good'
    ? ['text-emerald-700 bg-emerald-50 ring-1 ring-emerald-400/40 dark:text-emerald-300 dark:bg-emerald-900/30',
       'text-emerald-800 bg-emerald-100 ring-1 ring-emerald-500/50 dark:text-emerald-200 dark:bg-emerald-800/50',
       'text-white bg-emerald-600 dark:bg-emerald-500'][level - 1]
    : ['text-rose-700 bg-rose-50 ring-1 ring-rose-400/40 dark:text-rose-300 dark:bg-rose-900/30',
       'text-rose-800 bg-rose-100 ring-1 ring-rose-500/50 dark:text-rose-200 dark:bg-rose-800/50',
       'text-white bg-rose-600 dark:bg-rose-500'][level - 1];
  return `${base} ${tone}`;
}
