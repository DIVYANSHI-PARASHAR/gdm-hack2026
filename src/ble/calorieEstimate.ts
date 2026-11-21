// Keytel et al. (2005), male equation without measured VO2max.
// https://pubmed.ncbi.nlm.nih.gov/15966347/
export const CALORIE_PROFILE = {
  ageYears: 25,
  weightLb: 189,
  heightIn: 69,
} as const;

/** Estimated total energy expenditure during an interval with a heart-rate reading. */
export function estimateCalories(bpm: number, durationMs: number): number {
  if (!Number.isFinite(bpm) || bpm <= 0 || !Number.isFinite(durationMs) || durationMs <= 0) return 0;
  const weightKg = CALORIE_PROFILE.weightLb * 0.45359237;
  const kilojoulesPerMinute = -55.0969 + 0.6309 * bpm +
    0.1988 * weightKg + 0.2017 * CALORIE_PROFILE.ageYears;
  return Math.max(0, kilojoulesPerMinute) * durationMs / (4.184 * 60_000);
}
