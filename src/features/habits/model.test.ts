import { describe, expect, it } from 'vitest';
import type { Habit } from '../../db/types';
import { compareHabits, orderedWeekdays, validateHabitDraft, validateHabitValue } from './model';

const draft = {
  name: '  مطالعه  ',
  unit: '  صفحه  ',
  target: '10',
  days: [6, 0, 2],
  icon: 'book' as const,
  color: 'teal' as const,
};
const habit = (id: string, order: number): Habit => ({
  id,
  order,
  name: 'مطالعه',
  unit: 'صفحه',
  target: 10,
  days: [0, 6],
  icon: 'book',
  color: 'teal',
  archived: false,
  createdAt: '2026-10-10',
  updatedFrom: '2026-10-10',
  history: [],
});

describe('habit form validation', () => {
  it('trims names and units and parses a finite positive target', () => {
    expect(validateHabitDraft(draft)).toEqual({
      valid: true,
      config: {
        name: 'مطالعه',
        unit: 'صفحه',
        target: 10,
        days: [6, 0, 2],
        icon: 'book',
        color: 'teal',
      },
    });
  });

  it.each([
    ['name', { name: '   ' }],
    ['unit', { unit: '   ' }],
    ['target', { target: '' }],
    ['target', { target: '0' }],
    ['target', { target: '-1' }],
    ['target', { target: 'Infinity' }],
    ['target', { target: 'NaN' }],
    ['days', { days: [] }],
    ['days', { days: [0, 0] }],
    ['days', { days: [-1, 6] }],
    ['days', { days: [7] }],
    ['days', { days: [1.5] }],
    ['icon', { icon: 'invalid' }],
    ['color', { color: 'invalid' }],
  ])('rejects invalid %s without dropping the draft', (field, patch) => {
    const input = { ...draft, ...patch };
    const before = structuredClone(input);
    const result = validateHabitDraft(input);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors[field as keyof typeof result.errors]).toBeTruthy();
    expect(input).toEqual(before);
  });

  it.each(['', '  ', 'Infinity', 'NaN', '-0.1'])('rejects invalid daily value %s', (value) => {
    expect(validateHabitValue(value).valid).toBe(false);
  });

  it.each([
    ['0', 0],
    ['10.5', 10.5],
    ['150', 150],
  ])('accepts nonnegative daily value %s including over-target values', (input, value) => {
    expect(validateHabitValue(input)).toEqual({ valid: true, value });
  });
});

describe('weekday identity and ordering', () => {
  it('only changes display order for Saturday-first weeks', () => {
    expect(orderedWeekdays(6).map(({ value }) => value)).toEqual([6, 0, 1, 2, 3, 4, 5]);
    expect(orderedWeekdays(6).map(({ label }) => label)).toEqual([
      'شنبه',
      'یکشنبه',
      'دوشنبه',
      'سه‌شنبه',
      'چهارشنبه',
      'پنجشنبه',
      'جمعه',
    ]);
  });

  it('keeps Sunday zero for Sunday-first weeks', () => {
    expect(orderedWeekdays(0).map(({ value }) => value)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(orderedWeekdays(0)[0].label).toBe('یکشنبه');
  });

  it('uses a stable ID tie-break without mutating its input', () => {
    const list = [habit('z', 2), habit('b', 0), habit('a', 0)];
    expect([...list].sort(compareHabits).map(({ id }) => id)).toEqual(['a', 'b', 'z']);
    expect(list.map(({ id }) => id)).toEqual(['z', 'b', 'a']);
  });
});
