/** 0–100: how much of the vs-bar fill belongs to the left (by category Z). */
export function versusFillPercent(leftZ: number | null, rightZ: number | null): number {
  if (leftZ == null || rightZ == null || leftZ === rightZ) return 50;
  const a = Math.exp(leftZ);
  const b = Math.exp(rightZ);
  return (a / (a + b)) * 100;
}

/** Knob position on a category slider, 8–92. Toward the side with the higher Z. */
export function zSliderKnobPercent(leftZ: number | null, rightZ: number | null): number {
  if (leftZ == null || rightZ == null || leftZ === rightZ) return 50;
  const lean = Math.tanh((rightZ - leftZ) / 1.15);
  return 50 + lean * 42;
}

export function playerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}