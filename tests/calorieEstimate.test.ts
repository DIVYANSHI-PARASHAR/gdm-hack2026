import { describe, expect, it } from 'vitest';
import { estimateCalories } from '../src/ble/calorieEstimate';

describe('heart-rate calorie estimate', () => {
  it('uses the male Keytel equation with kilograms and active duration', () => {
    expect(estimateCalories(150, 60_000)).toBeCloseTo(14.73, 2);
    expect(estimateCalories(150, 30_000)).toBeCloseTo(7.36, 2);
    expect(estimateCalories(170, 60_000)).toBeGreaterThan(estimateCalories(120, 60_000));
  });

  it('does not add calories for invalid readings or durations', () => {
    expect(estimateCalories(NaN, 60_000)).toBe(0);
    expect(estimateCalories(150, 0)).toBe(0);
    expect(estimateCalories(35, 60_000)).toBe(0);
  });
});
