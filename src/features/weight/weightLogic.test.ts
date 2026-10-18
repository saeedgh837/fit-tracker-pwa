import { describe, expect, it } from 'vitest';
import type { Profile, WeightEntry } from '../../db/types';
import { fromCm, fromKg } from '../../lib/format';
import {
  buildMeasurementSeries,
  buildWeightSeries,
  createMeasurementDraft,
  createWeightDraft,
  measurementFields,
  rollingChange,
  validateMeasurement,
  validateWeight,
  weightSummary,
} from './weightLogic';

const w = (date: string, weightKg: number, time = '08:00', id = date + time): WeightEntry => ({
  id,
  date,
  time,
  weightKg,
  note: '',
});
const profile: Profile = {
  id: 'main',
  name: '',
  age: 30,
  sex: 'male',
  heightCm: 180,
  startWeightKg: 90,
  goalWeightKg: 75,
  goal: 'lose',
  activity: 'light',
  weeklyPaceKg: 0.5,
  waterGoalMl: 2000,
  workoutGoal: 3,
  specialCondition: false,
};

describe('weight draft boundaries', () => {
  it('starts a new record on the selected historical day and preserves edited identity and time', () => {
    expect(createWeightDraft(undefined, '2024-02-29', 'lb', '23:41')).toMatchObject({
      date: '2024-02-29',
      unit: 'lb',
      time: '23:41',
    });
    const draft = createWeightDraft(w('2026-10-01', 80, '11:20', 'stable'), '2026-10-18', 'lb');
    expect(validateWeight(draft, 'ignored')).toMatchObject({
      value: { id: 'stable', date: '2026-10-01', time: '11:20', weightKg: expect.closeTo(80, 8) },
    });
  });
  it.each(['', '0', '-1', 'Infinity', 'NaN'])('rejects invalid weight %s', (value) => {
    const draft = { ...createWeightDraft(undefined, '2026-10-18', 'kg'), weight: value };
    expect(validateWeight(draft, 'id')).toHaveProperty('errors.weight');
  });
  it.each(['24:00', '12:60', '8:03', '', '00:99'])('rejects invalid time %s', (time) => {
    expect(
      validateWeight(
        { ...createWeightDraft(undefined, '2026-10-18', 'kg'), weight: '80', time },
        'id',
      ),
    ).toHaveProperty('errors.time');
  });
  it('rejects impossible dates and converts only the captured draft unit', () => {
    const draft = {
      ...createWeightDraft(undefined, '2026-02-30', 'lb'),
      weight: String(fromKg(80, 'lb')),
    };
    expect(validateWeight(draft, 'id')).toHaveProperty('errors.date');
    expect(validateWeight({ ...draft, date: '2026-10-01' }, 'id')).toMatchObject({
      value: { weightKg: expect.closeTo(80, 8) },
    });
  });
});

describe('historical range and actual shared weight calculations', () => {
  const entries = [
    w('2026-10-01', 100),
    w('2026-10-06', 94),
    w('2026-10-10', 90, '08:00', 'b'),
    w('2026-10-10', 88, '09:00', 'a'),
    w('2026-10-11', 87),
    w('2026-10-20', 50),
  ];
  it('uses the last time of day and retains preceding calendar context before filtering the seven-day display', () => {
    const view = buildWeightSeries(entries, '2026-10-12', '7', 'kg');
    expect(view.raw.map((x) => x.id)).toEqual(['2026-10-0608:00', 'b', 'a', '2026-10-1108:00']);
    expect(view.points.map((x) => x.date)).toEqual(['2026-10-06', '2026-10-10', '2026-10-11']);
    expect(view.points[0].trend).toBe(97);
    expect(view.points[1].weight).toBe(88);
    expect(view.points[1].trend).toBe(91);
    expect(view.points[2].trend).toBeCloseTo((94 + 88 + 87) / 3);
  });
  it('converts the daily, trend and goal values to the same display unit', () => {
    const view = buildWeightSeries(entries, '2026-10-12', 'all', 'lb');
    expect(view.points[2].weight).toBeCloseTo(fromKg(88, 'lb'));
    expect(view.points[2].trend).toBeCloseTo(fromKg(91, 'lb'));
    expect(weightSummary(entries, profile, '2026-10-12', 'lb').goal).toBeCloseTo(fromKg(75, 'lb'));
  });
  it('uses rolling at-or-before cutoffs with actual dates, including real zero', () => {
    expect(
      rollingChange(
        [w('2026-09-01', 80), w('2026-10-02', 80), w('2026-10-09', 80)],
        '2026-10-10',
        7,
      ),
    ).toEqual({ deltaKg: 0, from: '2026-10-02', to: '2026-10-09' });
    expect(rollingChange([w('2026-10-09', 80)], '2026-10-10', 30)).toBeNull();
    expect(rollingChange([], '2026-10-10', 7)).toBeNull();
  });
  it('does not compute BMI without a valid height or a historical weight', () => {
    expect(weightSummary([], profile, '2026-10-12', 'kg').bmi).toBeNull();
    expect(weightSummary(entries, { ...profile, heightCm: 0 }, '2026-10-12', 'kg').bmi).toBeNull();
    expect(weightSummary(entries, profile, '2026-10-12', 'kg').bmi).toBeCloseTo(87 / 1.8 ** 2);
  });
  it('does not fabricate ETA for insufficient, wrong-direction, invalid or maintenance goals', () => {
    expect(
      weightSummary([w('2026-10-01', 80), w('2026-10-04', 79)], profile, '2026-10-04', 'kg').eta,
    ).toBeNull();
    expect(
      weightSummary([w('2026-10-01', 80), w('2026-10-11', 81)], profile, '2026-10-11', 'kg').eta,
    ).toBeNull();
    expect(
      weightSummary(entries, { ...profile, goalWeightKg: NaN }, '2026-10-12', 'kg').eta,
    ).toBeNull();
    expect(
      weightSummary(entries, { ...profile, goal: 'maintain' }, '2026-10-12', 'kg').eta,
    ).toBeNull();
    expect(
      weightSummary(
        [w('2026-10-01', 80), w('2026-10-11', 79), w('2026-10-20', 150)],
        profile,
        '2026-10-11',
        'kg',
      ).eta,
    ).not.toBeNull();
    expect(weightSummary([w('2026-10-01', 74)], profile, '2026-10-01', 'kg').reached).toBe(true);
  });
});

describe('all five optional body measurements', () => {
  it('requires at least one value and validates each field and date', () => {
    const draft = createMeasurementDraft(undefined, '2026-10-18', 'cm');
    expect(validateMeasurement(draft, 'id')).toHaveProperty('errors.form');
    expect(validateMeasurement({ ...draft, date: '2026-02-30', waist: '80' }, 'id')).toHaveProperty(
      'errors.date',
    );
    for (const field of measurementFields) {
      for (const bad of ['0', '-1', 'Infinity', 'NaN'])
        expect(validateMeasurement({ ...draft, [field.key]: bad }, 'id')).toHaveProperty(
          `errors.${field.key}`,
        );
    }
  });
  it('round trips every inch field, preserves identity and omits cleared fields entirely', () => {
    const entry = {
      id: 'same',
      date: '2026-10-01',
      waist: 80,
      chest: 100,
      hip: 95,
      arm: 32,
      thigh: 55,
    };
    const draft = createMeasurementDraft(entry, '2026-10-18', 'in');
    expect(Number(draft.arm)).toBeCloseTo(fromCm(32, 'in'));
    const result = validateMeasurement({ ...draft, chest: '' }, 'new');
    expect('value' in result && result.value).toEqual({
      id: 'same',
      date: '2026-10-01',
      waist: expect.closeTo(80, 8),
      hip: expect.closeTo(95, 8),
      arm: expect.closeTo(32, 8),
      thigh: expect.closeTo(55, 8),
    });
  });
  it('keeps same-day records distinct, stable, and missing values null rather than zero', () => {
    const input = [
      { id: 'z', date: '2026-10-10', waist: 80 },
      { id: 'a', date: '2026-10-10', arm: 32 },
      { id: 'future', date: '2026-10-20', waist: 10 },
    ];
    const points = buildMeasurementSeries(input, '2026-10-12', '7', 'in');
    expect(points.map((x) => [x.id, x.ordinal])).toEqual([
      ['a', 1],
      ['z', 2],
    ]);
    expect(points[0].waist).toBeNull();
    expect(points[1].arm).toBeNull();
    expect(points[1].waist).toBeCloseTo(fromCm(80, 'in'));
  });
});
