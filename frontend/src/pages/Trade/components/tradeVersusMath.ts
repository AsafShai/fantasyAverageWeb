/** 0–100: how much of the vs-bar fill belongs to the left (by category Z). */
export function versusFillPercent(leftZ: number | null, rightZ: number | null): number {
  if (leftZ == null || rightZ == null || leftZ === rightZ) return 50;
  const a = Math.exp(leftZ);
  const b = Math.exp(rightZ);
  return (a / (a + b)) * 100;
}

/** Length of a row's Z-edge bar, 0–50 (% of the track; it grows from the
 * centre). Scaled so the largest gap among the rows shown fills one half. */
export function zEdgeBarPercent(leftZ: number | null, rightZ: number | null, maxGap?: number): number {
  if (leftZ == null || rightZ == null) return 0;
  const gap = Math.abs(leftZ - rightZ);
  const scale = maxGap && maxGap > 0 ? maxGap : gap;
  if (scale <= 0) return 0;
  return Math.max(4, Math.min(gap / scale, 1) * 50);
}

/** Largest |left − right| Z gap among rows (for one shared bar scale). */
export function maxZGap(pairs: [number | null | undefined, number | null | undefined][]): number {
  return pairs.reduce((max, [a, b]) => (a == null || b == null ? max : Math.max(max, Math.abs(a - b))), 0);
}

export function playerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}
/** Pill style for the shooting rows. */
export function pillClassForLabel(label: string): string | undefined {
  if (label === 'FG' || label === 'FG%') return 'tc-cat-pill--fg';
  if (label === 'FT' || label === 'FT%') return 'tc-cat-pill--ft';
  return undefined;
}
