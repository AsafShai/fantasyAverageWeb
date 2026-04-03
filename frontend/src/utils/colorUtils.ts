export const getHeatmapColor = (normalizedValue: number, isDark = false): string => {
  const adjustedValue = normalizedValue < 0.5
    ? 0.5 * Math.pow(normalizedValue * 2, 1.5)
    : 1 - 0.5 * Math.pow((1 - normalizedValue) * 2, 1.5);

  if (isDark) {
    // Dark mode: muted palette, darker midpoint so white cells don't glare
    // Red end: deep muted red   Mid: dark slate   Green end: muted teal-green
    if (adjustedValue <= 0.5) {
      const ratio = adjustedValue * 2;
      const r = Math.round(153 + (45 - 153) * ratio);  // 153→45
      const g = Math.round(27  + (55 - 27)  * ratio);  // 27→55
      const b = Math.round(27  + (72 - 27)  * ratio);  // 27→72
      return `rgb(${r}, ${g}, ${b})`;
    } else {
      const ratio = (adjustedValue - 0.5) * 2;
      const r = Math.round(45  + (22  - 45)  * ratio); // 45→22
      const g = Math.round(55  + (160 - 55)  * ratio); // 55→160
      const b = Math.round(72  + (75  - 72)  * ratio); // 72→75
      return `rgb(${r}, ${g}, ${b})`;
    }
  }

  if (adjustedValue <= 0.5) {
    const ratio = adjustedValue * 2;
    const r = Math.round(215 + (255 - 215) * ratio);
    const g = Math.round(48 + (255 - 48) * ratio);
    const b = Math.round(39 + (255 - 39) * ratio);
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    const ratio = (adjustedValue - 0.5) * 2;
    const r = Math.round(255 - (255 - 34) * ratio);
    const g = Math.round(255 - (255 - 197) * ratio);
    const b = Math.round(255 - (255 - 94) * ratio);
    return `rgb(${r}, ${g}, ${b})`;
  }
}

export const getTextColor = (normalizedValue: number, isDark = false): string => {
  if (isDark) {
    if (normalizedValue < 0.3 || normalizedValue > 0.7) return 'white';
    return '#cbd5e1';
  }
  if (normalizedValue < 0.25 || normalizedValue > 0.75) return 'white';
  return 'black';
}
