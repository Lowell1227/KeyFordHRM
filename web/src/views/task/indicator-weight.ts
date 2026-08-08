export interface DisplayedWeightTotal {
  hundredths: number;
  percentText: string;
  isExactlyOneHundredPercent: boolean;
}

export function normalizeDisplayedWeightTotal(totalWeight: number): DisplayedWeightTotal {
  const finiteWeight = Number.isFinite(totalWeight) ? totalWeight : 0;
  const roundedHundredths = Math.round(finiteWeight * 10_000);
  const hundredths = Object.is(roundedHundredths, -0) ? 0 : roundedHundredths;
  return {
    hundredths,
    percentText: (hundredths / 100).toFixed(2),
    isExactlyOneHundredPercent: hundredths === 10_000,
  };
}
