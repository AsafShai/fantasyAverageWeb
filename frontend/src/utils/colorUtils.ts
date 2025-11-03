export const getHeatmapColor = (normalizedValue: number): string => {
  const adjustedValue = normalizedValue < 0.5
    ? 0.5 * Math.pow(normalizedValue * 2, 1.5)
    : 1 - 0.5 * Math.pow((1 - normalizedValue) * 2, 1.5);

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

export const getTextColor = (normalizedValue: number): string => {
  if (normalizedValue < 0.25) {
    return 'white';
  } else if (normalizedValue > 0.75) {
    return 'white';
  }
  return 'black';
}
