import { describe, expect, it } from 'vitest';
import type { Habit, HabitLog } from '../../db/types';
import { bestHabitStreak, dayCompletion, habitStreak } from '../../lib/calculations';
import { buildDailyHabits, buildHeatmap } from './history';

const habit: Habit = {
  id: 'read',
  name: 'مطالعه',
  unit: 'صفحه',
  icon: 'book',
  color: 'teal',
  target: 8,
  days: [6, 1, 3],
  archived: false,
  order: 0,
  createdAt: '2026-10-10',
  updatedFrom: '2026-10-10',
  history: [],
};
const logs: HabitLog[] = [
  { id: '1', habitId: 'read', date: '2026-10-10', value: 8, target: 8 },
  { id: '2', habitId: 'read', date: '2026-10-12', value: 8, target: 8 },
  { id: '3', habitId: 'read', date: '2026-10-14', value: 8, target: 8 },
];
const archived: Habit = {
  ...habit,
  name: 'مطالعهٔ بیشتر',
  target: 20,
  archived: true,
  updatedFrom: '2026-10-18',
  history: [
    {
      name: habit.name,
      unit: habit.unit,
      icon: habit.icon,
      color: habit.color,
      target: 8,
      days: [6, 1, 3],
      archived: false,
      from: '2026-10-10',
    },
  ],
};

describe('historical daily habits using shared calculations', () => {
  it('excludes dates before creation, off-schedule dates and historical archives', () => {
    expect(buildDailyHabits([habit], [], '2026-10-03')).toEqual([]);
    expect(buildDailyHabits([habit], [], '2026-10-11')).toEqual([]);
    expect(buildDailyHabits([archived], [], '2026-10-19')).toEqual([]);
    expect(dayCompletion([habit], [], '2026-10-03')).toEqual({ done: 0, total: 0, percent: 0 });
  });

  it('retains the historical name, target and completion after archive or target increase', () => {
    const result = buildDailyHabits([archived], logs, '2026-10-14');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      config: { name: 'مطالعه', target: 8, archived: false },
      value: 8,
      target: 8,
      done: true,
      percent: 100,
    });
    expect(dayCompletion([archived], logs, '2026-10-14')).toEqual({
      done: 1,
      total: 1,
      percent: 100,
    });
  });

  it('uses the log snapshot target and retains actual over-target values', () => {
    const result = buildDailyHabits(
      [{ ...habit, target: 20 }],
      [{ id: 'over', habitId: 'read', date: '2026-10-17', target: 8, value: 12 }],
      '2026-10-17',
    );
    expect(result[0]).toMatchObject({ value: 12, target: 8, done: true, percent: 100 });
  });

  it('calls real streak logic with explicit asOf and does not break on off days or pending today', () => {
    expect(habitStreak(habit, logs, '2026-10-17')).toBe(3);
    expect(bestHabitStreak(habit, logs, '2026-10-17')).toBe(3);
    expect(buildDailyHabits([habit], logs, '2026-10-17')[0]).toMatchObject({
      streak: 3,
      bestStreak: 3,
      done: false,
    });
    expect(habitStreak(habit, logs, '2026-10-19')).toBe(0);
  });
});

describe('twelve-week heatmap', () => {
  it('covers 84 inclusive dates ending at the selected day without inventing completed days', () => {
    const cells = buildHeatmap([habit], logs, '2026-10-18');
    expect(cells).toHaveLength(84);
    expect(cells[0].date).toBe('2026-07-27');
    expect(cells[83]).toEqual({ date: '2026-10-18', done: 0, total: 0, percent: 0 });
    expect(cells.find(({ date }) => date === '2026-10-10')).toEqual({
      date: '2026-10-10',
      done: 1,
      total: 1,
      percent: 100,
    });
    expect(cells.find(({ date }) => date === '2026-10-17')).toEqual({
      date: '2026-10-17',
      done: 0,
      total: 1,
      percent: 0,
    });
  });

  it('uses each historical schedule and snapshot target even after current archive', () => {
    const cells = buildHeatmap([archived], logs, '2026-10-19');
    expect(cells.find(({ date }) => date === '2026-10-14')).toEqual({
      date: '2026-10-14',
      done: 1,
      total: 1,
      percent: 100,
    });
    expect(cells.find(({ date }) => date === '2026-10-19')).toEqual({
      date: '2026-10-19',
      done: 0,
      total: 0,
      percent: 0,
    });
  });

  it('filters one habit rather than repainting or including another habit denominator', () => {
    const other = {
      ...habit,
      id: 'other',
      days: [0],
      createdAt: '2026-10-01',
      updatedFrom: '2026-10-01',
    };
    const all = buildHeatmap([habit, other], logs, '2026-10-18');
    const filtered = buildHeatmap([habit, other], logs, '2026-10-18', 'read');
    expect(all[83]).toMatchObject({ total: 1, done: 0 });
    expect(filtered[83]).toMatchObject({ total: 0, done: 0 });
  });
});
