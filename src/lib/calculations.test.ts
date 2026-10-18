import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, isISODate, startOfWeek } from './dates';
import { fromKg, toKg, toCm, fromCm } from './format';
import {
  bmi,
  nutritionTargets,
  movingAverage,
  metCalories,
  estimateGoalDate,
  habitStreak,
  dayCompletion,
  habitAtDate,
} from './calculations';
import type { Habit, Profile, WeightEntry } from '../db/types';
const profile: Profile = {
  id: 'main',
  name: 'تست',
  sex: 'male',
  age: 30,
  heightCm: 180,
  startWeightKg: 80,
  goalWeightKg: 72,
  activity: 'sedentary',
  goal: 'lose',
  weeklyPaceKg: 2,
  waterGoalMl: 2000,
  workoutGoal: 3,
  specialCondition: false,
};
const habit: Habit = {
  id: 'h',
  name: 'آب',
  icon: 'water',
  color: 'blue',
  days: [6, 1, 3],
  target: 8,
  unit: 'لیوان',
  archived: false,
  order: 0,
  createdAt: '2026-10-10',
  updatedFrom: '2026-10-10',
  history: [],
};
const weight = (date: string, weightKg: number, time = '08:00'): WeightEntry => ({
  id: date + time,
  date,
  time,
  weightKg,
  note: '',
});
describe('local date and canonical units', () => {
  it('rejects impossible calendar days', () => {
    expect(isISODate('2026-02-30')).toBe(false);
    expect(isISODate('2024-02-29')).toBe(true);
    expect(isISODate('2026-2-01')).toBe(false);
  });
  it('handles leap/year boundaries and Saturday weeks', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(startOfWeek('2026-10-18', 6)).toBe('2026-10-17');
  });
  it('round trips pounds and inches', () => {
    expect(toKg(fromKg(80, 'lb'), 'lb')).toBeCloseTo(80, 8);
    expect(toCm(fromCm(180, 'in'), 'in')).toBeCloseTo(180, 8);
  });
});
describe('bounded adult estimates', () => {
  it('uses Mifflin and caps weekly pace', () => {
    const t = nutritionTargets(profile)!;
    expect(t.bmr).toBe(1780);
    expect(t.tdee).toBe(2136);
    expect(t.paceKg).toBeLessThanOrEqual(0.8);
    expect(t.calories).toBeGreaterThanOrEqual(1500);
    expect(t.limited).toBe(true);
  });
  it('does not calculate for minors or special conditions', () => {
    expect(nutritionTargets({ ...profile, age: 17 })).toBeNull();
    expect(nutritionTargets({ ...profile, specialCondition: true })).toBeNull();
  });
  it('maintain ignores requested deficit, macros cover intake', () => {
    const t = nutritionTargets({ ...profile, goal: 'maintain' })!;
    expect(t.calories).toBe(t.tdee);
    expect(t.paceKg).toBe(0);
    expect(4 * (t.protein + t.carbs) + 9 * t.fat).toBeCloseTo(t.calories, -1);
  });
  it('calculates BMI and MET with intensity', () => {
    expect(bmi(80, 180)).toBeCloseTo(24.69, 2);
    expect(metCalories('walk', 30, 'moderate', 80)).toBeGreaterThan(100);
    expect(metCalories('run', 30, 'vigorous', 80)).toBeGreaterThan(
      metCalories('run', 30, 'light', 80),
    );
  });
});
describe('time-based weight trends', () => {
  it('uses seven calendar days not seven samples and latest daily time', () => {
    const v = movingAverage([
      weight('2026-10-01', 100),
      weight('2026-10-10', 90),
      weight('2026-10-10', 88, '09:00'),
    ]);
    expect(v).toHaveLength(2);
    expect(v[1].trend).toBe(88);
  });
  it('never predicts an ETA against trend or too few days', () => {
    expect(
      estimateGoalDate([weight('2026-10-01', 80), weight('2026-10-11', 79)], 75, '2026-10-11'),
    ).toBeTruthy();
    expect(
      estimateGoalDate([weight('2026-10-01', 80), weight('2026-10-11', 81)], 75, '2026-10-11'),
    ).toBeNull();
    expect(estimateGoalDate([weight('2026-10-01', 80)], 75)).toBeNull();
  });
});
describe('scheduled habits and history', () => {
  it('does not penalize unscheduled days and allows pending today', () => {
    const logs = [
      { id: '1', habitId: 'h', date: '2026-10-10', value: 8, target: 8 },
      { id: '2', habitId: 'h', date: '2026-10-12', value: 8, target: 8 },
      { id: '3', habitId: 'h', date: '2026-10-14', value: 8, target: 8 },
    ];
    expect(habitStreak(habit, logs, '2026-10-17')).toBe(3);
    expect(dayCompletion([habit], logs, '2026-10-11').total).toBe(0);
  });
  it('excludes future creation and retains old revision after archive', () => {
    expect(habitAtDate(habit, '2026-10-09')).toBeUndefined();
    const archived = {
      ...habit,
      archived: true,
      updatedFrom: '2026-10-18',
      history: [{ ...habit, from: '2026-10-10' }],
    };
    expect(habitAtDate(archived, '2026-10-17')?.archived).toBe(false);
    expect(habitAtDate(archived, '2026-10-18')?.archived).toBe(true);
  });
  it('uses saved log target not later template target', () => {
    expect(
      dayCompletion(
        [{ ...habit, target: 10 }],
        [{ id: 'l', date: '2026-10-17', habitId: 'h', value: 8, target: 8 }],
        '2026-10-17',
      ).percent,
    ).toBe(100);
  });
});
