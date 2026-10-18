import { describe, expect, it } from 'vitest';
import type { Food, MealEntry, Profile, Settings, WeightEntry } from '../../db/types';
import {
  buildDietCharts,
  dietTargets,
  latestEligibleWeight,
  libraryFoods,
  parseNutritionDraft,
  summarizeDay,
} from './dietLogic';

const settings: Settings = {
  id: 'main',
  weightUnit: 'kg',
  heightUnit: 'cm',
  calendar: 'gregory',
  weekStartsOn: 6,
  persianDigits: false,
  theme: 'dark',
  reminders: false,
  reminderHour: 9,
  onboardingComplete: true,
};
const profile: Profile = {
  id: 'main',
  name: 'آزمایشی',
  sex: 'male',
  age: 30,
  heightCm: 180,
  startWeightKg: 80,
  goalWeightKg: 75,
  activity: 'sedentary',
  goal: 'maintain',
  weeklyPaceKg: 0.25,
  waterGoalMl: 2000,
  workoutGoal: 3,
  specialCondition: false,
};
const meal = (
  id: string,
  date: string,
  calories: number,
  extra: Partial<MealEntry> = {},
): MealEntry => ({
  id,
  date,
  calories,
  meal: 'breakfast',
  name: 'غذا',
  protein: 10,
  carbs: 20,
  fat: 5,
  cheat: false,
  ...extra,
});
const food = (id: string, extra: Partial<Food> = {}): Food => ({
  id,
  name: 'غذا',
  calories: 100,
  protein: 0,
  carbs: 0,
  fat: 0,
  favorite: false,
  lastUsedAt: null,
  ...extra,
});
const weight = (id: string, date: string, time: string, weightKg: number): WeightEntry => ({
  id,
  date,
  time,
  weightKg,
  note: '',
});

describe('diet nutrition drafts', () => {
  it('trims names, accepts zero calories and turns only blank optional macros into zero', () => {
    expect(
      parseNutritionDraft({ name: '  نان  ', calories: '0', protein: '', carbs: '  ', fat: '2.5' }),
    ).toEqual({ ok: true, value: { name: 'نان', calories: 0, protein: 0, carbs: 0, fat: 2.5 } });
  });
  it('accepts finite nonnegative serving values without undocumented upper limits', () => {
    expect(
      parseNutritionDraft({
        name: 'غذای ثبت‌شده',
        calories: '30001',
        protein: '3001',
        carbs: '5001',
        fat: '3001',
      }).ok,
    ).toBe(true);
  });
  it('preserves entered calories instead of deriving them from optional macros', () => {
    expect(
      parseNutritionDraft({
        name: 'برنج',
        calories: '123.5',
        protein: '50',
        carbs: '30',
        fat: '10',
      }),
    ).toEqual({
      ok: true,
      value: { name: 'برنج', calories: 123.5, protein: 50, carbs: 30, fat: 10 },
    });
  });
  it.each([
    { name: '  ', calories: '12', protein: '', carbs: '', fat: '' },
    { name: 'غذا', calories: '', protein: '', carbs: '', fat: '' },
    { name: 'غذا', calories: '-1', protein: '', carbs: '', fat: '' },
    { name: 'غذا', calories: 'NaN', protein: '', carbs: '', fat: '' },
    { name: 'غذا', calories: 'Infinity', protein: '', carbs: '', fat: '' },
    { name: 'غذا', calories: '12', protein: '-2', carbs: '', fat: '' },
    { name: 'غذا', calories: '12', protein: '', carbs: 'NaN', fat: '' },
    { name: 'غذا', calories: '12', protein: '', carbs: '', fat: 'Infinity' },
  ])('rejects invalid name or nutrition %#', (draft) => {
    expect(parseNutritionDraft(draft).ok).toBe(false);
  });
});

describe('selected-day nutrition', () => {
  it('groups and totals exactly one day without double counting and keeps empty groups', () => {
    const result = summarizeDay(
      [
        meal('a', '2026-10-18', 100),
        meal('b', '2026-10-18', 200, { meal: 'lunch', cheat: true }),
        meal('c', '2026-10-17', 900),
        meal('d', '2026-10-18', 0, { meal: 'snack', protein: 0, carbs: 0, fat: 0 }),
      ],
      '2026-10-18',
    );
    expect(result.totals).toEqual({ calories: 300, protein: 20, carbs: 40, fat: 10 });
    expect(result.groups.breakfast.entries.map((entry) => entry.id)).toEqual(['a']);
    expect(result.groups.lunch.totals.calories).toBe(200);
    expect(result.groups.dinner).toEqual({
      entries: [],
      totals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    });
    expect(result.entries).toHaveLength(3);
    expect(result.hasCheatMeal).toBe(true);
  });
  it('returns numeric zero totals and no meal flag on an unrecorded day', () => {
    expect(summarizeDay([], '2026-10-18')).toMatchObject({
      entries: [],
      totals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
      hasCheatMeal: false,
    });
  });
});

describe('food library views', () => {
  it('filters favorites and searches saved serving names without mutation', () => {
    const foods = [
      food('b', { name: 'نان سنگک', favorite: true }),
      food('a', { name: 'برنج', favorite: false }),
    ];
    expect(libraryFoods(foods, '  نان ', 'favorites').map((entry) => entry.id)).toEqual(['b']);
    expect(libraryFoods(foods, 'نان', 'all')).toHaveLength(1);
    expect(foods.map((entry) => entry.id)).toEqual(['b', 'a']);
  });
  it('sorts recent foods by the actual instant rather than the textual timestamp offset', () => {
    expect(
      libraryFoods(
        [
          food('earlier', { lastUsedAt: '2026-10-18T10:00:00+03:30' }),
          food('later', { lastUsedAt: '2026-10-18T08:00:00Z' }),
          food('same', { lastUsedAt: '2026-10-18T11:30:00+03:30' }),
        ],
        '',
        'recent',
      ).map((entry) => entry.id),
    ).toEqual(['later', 'same', 'earlier']);
  });
  it('recent excludes never-used foods and sorts actual timestamps newest first with stable ID ties', () => {
    expect(
      libraryFoods(
        [
          food('z'),
          food('b', { lastUsedAt: '2026-10-17T15:00:00.000Z' }),
          food('c', { lastUsedAt: '2026-10-18T15:00:00.000Z' }),
          food('a', { lastUsedAt: '2026-10-17T15:00:00.000Z' }),
        ],
        '',
        'recent',
      ).map((entry) => entry.id),
    ).toEqual(['c', 'a', 'b']);
  });
});

describe('eligible weight and current-profile estimate', () => {
  it('selects the latest date on or before selection, then latest time within that date', () => {
    expect(
      latestEligibleWeight(
        [
          weight('a', '2026-10-16', '23:00', 90),
          weight('b', '2026-10-18', '07:00', 82),
          weight('c', '2026-10-18', '21:00', 81),
          weight('future', '2026-10-19', '23:00', 70),
        ],
        '2026-10-18',
      ),
    ).toBe(81);
    expect(latestEligibleWeight([], '2026-10-18')).toBeUndefined();
  });
  it('delegates to the shared calculator using eligible weight or profile start weight', () => {
    const fromStart = dietTargets(profile, [], '2026-10-18');
    const fromWeight = dietTargets(profile, [weight('a', '2026-10-18', '08:00', 90)], '2026-10-18');
    expect(fromStart?.bmr).toBe(1780);
    expect(fromWeight?.bmr).toBe(1880);
    expect(
      dietTargets(profile, [weight('future', '2026-10-19', '08:00', 90)], '2026-10-18')?.bmr,
    ).toBe(1780);
  });
  it('keeps missing profiles and unavailable medical estimates null', () => {
    expect(dietTargets(undefined, [], '2026-10-18')).toBeNull();
    expect(dietTargets({ ...profile, specialCondition: true }, [], '2026-10-18')).toBeNull();
  });
});

describe('calendar-bounded diet charts', () => {
  it('returns seven canonical daily keys, real zero consumption, missing nulls and no future records', () => {
    const result = buildDietCharts(
      [
        meal('a', '2026-01-01', 100),
        meal('b', '2026-01-01', 200),
        meal('zero', '2026-01-02', 0),
        meal('future', '2026-01-04', 999),
      ],
      '2026-01-03',
      settings,
      2000,
    );
    expect(result.daily.map((row) => row.date)).toEqual([
      '2025-12-28',
      '2025-12-29',
      '2025-12-30',
      '2025-12-31',
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
    ]);
    expect(result.daily.map((row) => row.calories)).toEqual([null, null, null, null, 300, 0, null]);
    expect(result.daily.map((row) => row.target)).toEqual([
      2000, 2000, 2000, 2000, 2000, 2000, 2000,
    ]);
  });
  it('creates eight Saturday weeks across the year with a one-day final bucket and honest completeness', () => {
    const result = buildDietCharts(
      [
        meal('a', '2025-12-27', 100),
        meal('b', '2025-12-31', 200),
        meal('c', '2026-01-02', 300),
        meal('d', '2026-01-03', 400),
        meal('future', '2026-01-04', 999),
      ],
      '2026-01-03',
      settings,
      2000,
    );
    expect(result.weekly).toHaveLength(8);
    expect(result.weekly[0].date).toBe('2025-11-15');
    expect(result.weekly.at(-2)).toMatchObject({
      date: '2025-12-27',
      endDate: '2026-01-02',
      calories: 600,
      target: 14000,
      recordedDays: 3,
      elapsedDays: 7,
    });
    expect(result.weekly.at(-1)).toMatchObject({
      date: '2026-01-03',
      endDate: '2026-01-03',
      calories: 400,
      target: 2000,
      recordedDays: 1,
      elapsedDays: 1,
    });
    expect(result.weekly[0].calories).toBeNull();
  });
  it('respects nondefault Monday starts and clips the partial week to three days', () => {
    const result = buildDietCharts(
      [
        meal('before', '2025-12-28', 700),
        meal('a', '2025-12-29', 120),
        meal('b', '2025-12-31', 80),
        meal('future', '2026-01-01', 900),
      ],
      '2025-12-31',
      { ...settings, weekStartsOn: 1 },
      1800,
    );
    expect(result.weekly.at(-1)).toMatchObject({
      date: '2025-12-29',
      endDate: '2025-12-31',
      calories: 200,
      target: 5400,
      recordedDays: 2,
      elapsedDays: 3,
    });
    expect(result.weekly.at(-2)?.calories).toBe(700);
  });
  it('keeps absent data null, limits old entries to the window and hides unavailable targets', () => {
    const result = buildDietCharts([meal('old', '2024-01-01', 100)], '2026-10-18', settings, null);
    expect(result.daily.every((row) => row.calories === null && row.target === null)).toBe(true);
    expect(
      result.weekly.every(
        (row) => row.calories === null && row.target === null && row.recordedDays === 0,
      ),
    ).toBe(true);
  });
});
