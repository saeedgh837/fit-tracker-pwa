import { describe, expect, it } from 'vitest';
import { periodSummary, achievements } from './insights';
import { defaultSettings, defaultProfile } from '../../db';
import type { AppData } from '../../db/types';
const empty: AppData = {
  profile: defaultProfile,
  settings: defaultSettings,
  habits: [],
  habitLogs: [],
  days: [],
  weights: [],
  measurements: [],
  foods: [],
  meals: [],
  workouts: [],
  routines: [],
};
describe('reports and badges', () => {
  it('distinguishes missing diet days from off-plan and excludes future data', () => {
    const base = {
      waterMl: 0,
      steps: 0,
      sleepHours: null,
      mood: null,
      energy: null,
      note: '',
      restDay: false,
      cheatMeal: false,
    };
    const result = periodSummary(
      {
        ...empty,
        days: [
          { ...base, date: '2026-10-18', adherence: 'full' },
          { ...base, date: '2026-10-17', adherence: 'partial' },
          { ...base, date: '2026-10-19', adherence: 'off' },
        ],
      },
      '2026-10-12',
      '2026-10-18',
    );
    expect(result.dietDays).toBe(2);
    expect(result.adherence).toBe(75);
    expect(result.workouts).toBe(0);
  });
  it('does not award badges for an empty dataset', () => {
    expect(achievements(empty, '2026-10-18').filter((a) => a.earned)).toHaveLength(0);
  });
});
