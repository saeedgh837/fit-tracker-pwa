import { describe, expect, it, vi } from 'vitest';
import type {
  DailyLog,
  Profile,
  Routine,
  Settings,
  WeightEntry,
  WorkoutEntry,
} from '../../db/types';
import {
  validateMovement,
  validateRoutine,
  validateCount,
  weightAsOf,
  resolveCalories,
  workoutDraft,
  routineDraft,
  createRoutineWorkoutDraft,
  buildWorkout,
  buildRoutine,
  personalRecords,
  weeklySummary,
  weeklyProgress,
} from './exerciseLogic';

const profile: Profile = {
  id: 'main',
  name: 'سعید',
  sex: 'male',
  age: 30,
  heightCm: 180,
  startWeightKg: 80,
  goalWeightKg: 75,
  activity: 'moderate',
  goal: 'lose',
  weeklyPaceKg: 0.5,
  waterGoalMl: 2000,
  workoutGoal: 3,
  specialCondition: false,
};
const settings: Settings = {
  id: 'main',
  weightUnit: 'kg',
  heightUnit: 'cm',
  calendar: 'gregory',
  weekStartsOn: 6,
  persianDigits: false,
  theme: 'light',
  reminders: false,
  reminderHour: 9,
  onboardingComplete: true,
};
const movement = (patch = {}) => ({
  type: 'strength',
  duration: '30',
  intensity: 'moderate',
  exercises: [{ name: ' پرس سینه ', sets: '3', reps: '10', weight: '20' }],
  inputUnit: 'kg' as const,
  ...patch,
});
const workout = (patch: Partial<WorkoutEntry> = {}): WorkoutEntry => ({
  id: 'w1',
  date: '2026-10-18',
  type: 'strength',
  duration: 30,
  intensity: 'moderate',
  calories: 180,
  notes: '',
  exercises: [{ name: 'پرس سینه', sets: 3, reps: 10, weightKg: 20 }],
  ...patch,
});
const weight = (date: string, time: string, weightKg: number, id = date + time): WeightEntry => ({
  id,
  date,
  time,
  weightKg,
  note: '',
});
const day = (date: string, restDay = false): DailyLog => ({
  date,
  restDay,
  waterMl: 500,
  steps: 0,
  sleepHours: null,
  mood: null,
  energy: null,
  note: 'یادداشت',
  adherence: null,
  cheatMeal: false,
});
const routine: Routine = {
  id: 'r1',
  name: 'قدرت پایه',
  type: 'strength',
  duration: 30,
  intensity: 'moderate',
  exercises: [{ name: 'پرس سینه', sets: 3, reps: 10, weightKg: 20 }],
};

describe('movement and routine validation', () => {
  it('trims names, preserves order, accepts empty cardio detail and zero-load exercise', () => {
    const result = validateMovement(
      movement({
        exercises: [
          { name: ' اسکوات ', sets: '2', reps: '12', weight: '0' },
          { name: 'پرس', sets: '3', reps: '10', weight: '20.125' },
          { name: '', sets: '', reps: '', weight: '' },
        ],
      }),
    );
    expect(result).toEqual({
      ok: true,
      value: {
        type: 'strength',
        duration: 30,
        intensity: 'moderate',
        exercises: [
          { name: 'اسکوات', sets: 2, reps: 12, weightKg: 0 },
          { name: 'پرس', sets: 3, reps: 10, weightKg: 20.125 },
        ],
      },
    });
    expect(validateMovement(movement({ type: 'walk', exercises: [] })).ok).toBe(true);
  });
  it.each(['', '0', '-1', '1.5', 'NaN', 'Infinity'])('rejects invalid duration %s', (duration) => {
    expect(validateMovement(movement({ duration })).ok).toBe(false);
  });
  it.each(['type', 'intensity'] as const)('rejects invalid %s enums', (field) => {
    expect(validateMovement(movement({ [field]: 'invalid' })).ok).toBe(false);
  });
  it.each([
    { name: ' ', sets: '1', reps: '2', weight: '0' },
    { name: 'پرس', sets: '', reps: '2', weight: '1' },
    { name: 'پرس', sets: '1', reps: '', weight: '1' },
    { name: 'پرس', sets: '1', reps: '2', weight: '' },
    { name: 'پرس', sets: '0', reps: '2', weight: '1' },
    { name: 'پرس', sets: '1.5', reps: '2', weight: '1' },
    { name: 'پرس', sets: '1', reps: '2.5', weight: '1' },
    { name: 'پرس', sets: '1', reps: '2', weight: '-1' },
    { name: 'پرس', sets: '1', reps: '2', weight: 'NaN' },
    { name: 'پرس', sets: '1', reps: '2', weight: 'Infinity' },
  ])('rejects incomplete or invalid exercise $name/$sets/$reps/$weight', (exercise) => {
    expect(validateMovement(movement({ exercises: [exercise] })).ok).toBe(false);
  });
  it.each(['toString', 'constructor', '__proto__'])(
    'rejects inherited prototype type %s',
    (type) => {
      expect(validateMovement(movement({ type })).ok).toBe(false);
    },
  );
  it('accepts nonnegative integer counts without an arbitrary daily/weekly ceiling', () => {
    expect(validateCount('200001')).toEqual({ ok: true, value: 200001 });
    expect(validateCount('15')).toEqual({ ok: true, value: 15 });
  });
  it('accepts all finite positive durations/sets/reps and nonnegative loads', () => {
    expect(
      validateMovement(
        movement({
          duration: '1441',
          exercises: [{ name: 'پرس', sets: '101', reps: '1001', weight: '2001' }],
        }),
      ).ok,
    ).toBe(true);
  });
  it('validates routine name and reuses movement rules', () => {
    expect(validateRoutine({ ...movement(), name: '  ' }).ok).toBe(false);
    expect(validateRoutine({ ...movement({ duration: '1.2' }), name: 'قدرت' }).ok).toBe(false);
    expect(validateRoutine({ ...movement(), name: ' قدرت ' })).toMatchObject({
      ok: true,
      value: { name: 'قدرت' },
    });
  });
  it.each(['', '-1', '1.5', 'Infinity', 'NaN'])('rejects invalid steps/goal %s', (value) => {
    expect(validateCount(value).ok).toBe(false);
  });
  it('accepts zero steps and disabled zero goal', () => {
    expect(validateCount('0')).toEqual({ ok: true, value: 0 });
    expect(validateCount('12500')).toEqual({ ok: true, value: 12500 });
  });
  it('uses the shared kg/lb boundary once without rounding decimal loads', () => {
    const draft = workoutDraft(
      workout({ exercises: [{ name: 'پرس', sets: 3, reps: 10, weightKg: 20.125 }] }),
      'lb',
    );
    expect(draft.inputUnit).toBe('lb');
    const result = validateMovement(draft);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.exercises[0].weightKg).toBeCloseTo(20.125, 10);
  });
});

describe('historical weight and frozen MET estimates', () => {
  it('takes latest eligible date/time, never a future measurement, with deterministic time ties', () => {
    const weights = [
      weight('2026-10-19', '10:00', 100),
      weight('2026-10-18', '08:00', 81),
      weight('2026-10-17', '23:00', 82),
      weight('2026-10-18', '18:00', 83, 'a'),
      weight('2026-10-18', '18:00', 84, 'b'),
    ];
    expect(weightAsOf(weights, profile, '2026-10-18')).toBe(84);
    expect(weightAsOf(weights, profile, '2026-10-16')).toBe(80);
  });
  it('ignores invalid weights and returns null without eligible measured or starting weight', () => {
    expect(
      weightAsOf(
        [weight('2026-10-18', '10:00', NaN), weight('2026-10-17', '10:00', 0)],
        undefined,
        '2026-10-18',
      ),
    ).toBeNull();
    expect(weightAsOf([], { ...profile, startWeightKg: -1 }, '2026-10-18')).toBeNull();
    expect(weightAsOf([weight('2026-10-19', '10:00', 85)], undefined, '2026-10-18')).toBeNull();
  });
  it('passes type, integer minutes, intensity and canonical weight to the sole estimator', () => {
    const estimator = vi.fn(() => 234.5);
    const result = resolveCalories(
      { type: 'run', duration: 25, intensity: 'vigorous', exercises: [] },
      '2026-10-18',
      [weight('2026-10-17', '12:00', 72.25)],
      profile,
      undefined,
      estimator,
    );
    expect(result).toEqual({ calories: 234.5, weightKg: 72.25, preserved: false });
    expect(estimator).toHaveBeenCalledExactlyOnceWith('run', 25, 'vigorous', 72.25);
  });
  it('preserves a saved estimate on notes/set-only changes even without bodyweight', () => {
    const original = workout();
    const estimator = vi.fn(() => 999);
    expect(
      resolveCalories(
        {
          type: original.type,
          duration: original.duration,
          intensity: original.intensity,
          exercises: [],
        },
        original.date,
        [],
        undefined,
        original,
        estimator,
      ),
    ).toEqual({ calories: 180, weightKg: null, preserved: true });
    expect(estimator).not.toHaveBeenCalled();
    expect(
      resolveCalories(
        { type: 'walk', duration: 30, intensity: 'light', exercises: [] },
        original.date,
        [],
        undefined,
        original,
        estimator,
      ),
    ).toBeNull();
  });
  it('builds new workouts with fresh IDs but preserves original identity/date during edits', () => {
    const draft = { ...movement(), id: undefined, date: '2026-10-18', notes: '  جلسه خوب  ' };
    const created = buildWorkout(draft, 'new-id', [], profile);
    expect(created).toMatchObject({
      ok: true,
      value: { id: 'new-id', date: '2026-10-18', notes: 'جلسه خوب' },
    });
    const original = workout({ id: 'old', date: '2026-10-10', calories: 111 });
    expect(
      buildWorkout({ ...draft, date: '2026-10-19' }, 'ignored-new', [], profile, original),
    ).toMatchObject({ ok: true, value: { id: 'old', date: '2026-10-10', calories: 111 } });
    expect(buildWorkout(draft, 'missing-weight', [], undefined).ok).toBe(false);
  });
});

describe('routine isolation', () => {
  it('opens an independent workout draft for the selected day, without a routine foreign key', () => {
    const draft = createRoutineWorkoutDraft(routine, '2026-09-01', 'kg');
    draft.exercises[0].name = 'اسکوات';
    expect(routine.exercises[0].name).toBe('پرس سینه');
    expect(draft.date).toBe('2026-09-01');
    expect(draft).not.toHaveProperty('id');
    expect(draft).not.toHaveProperty('routineId');
    const saved = buildWorkout(draft, 'fresh', [], profile);
    expect(saved).toMatchObject({
      ok: true,
      value: { id: 'fresh', exercises: [{ name: 'اسکوات' }] },
    });
  });
  it('routine edits cannot mutate saved workouts or original templates', () => {
    const old = workout();
    const draft = routineDraft(routine, 'kg');
    draft.exercises[0].weight = '50';
    expect(buildRoutine(draft, routine.id)).toMatchObject({
      ok: true,
      value: { exercises: [{ weightKg: 50 }] },
    });
    expect(old.exercises[0].weightKg).toBe(20);
    expect(routine.exercises[0].weightKg).toBe(20);
  });
});

describe('personal records and training volume', () => {
  it('normalizes Persian letters and collapsed whitespace; ties take latest date, then ID', () => {
    const workouts = [
      workout({
        id: 'a',
        date: '2026-10-10',
        exercises: [{ name: '  كيك   بك ', sets: 3, reps: 8, weightKg: 25 }],
      }),
      workout({
        id: 'b',
        date: '2026-10-12',
        exercises: [{ name: 'کیک بک', sets: 2, reps: 6, weightKg: 25 }],
      }),
      workout({
        id: 'c',
        date: '2026-10-12',
        exercises: [{ name: 'کیک بک', sets: 4, reps: 5, weightKg: 25 }],
      }),
      workout({
        id: 'future',
        date: '2026-10-19',
        exercises: [{ name: 'کیک بک', sets: 1, reps: 1, weightKg: 100 }],
      }),
      workout({ id: 'body', exercises: [{ name: 'شنا', sets: 3, reps: 12, weightKg: 0 }] }),
    ];
    expect(personalRecords(workouts, '2026-10-18')).toEqual([
      {
        key: 'کیک بک',
        name: 'کیک بک',
        weightKg: 25,
        sets: 4,
        reps: 5,
        date: '2026-10-12',
        workoutId: 'c',
      },
    ]);
    expect(
      personalRecords(
        workouts.filter((w) => w.id !== 'c' && w.id !== 'b'),
        '2026-10-18',
      )[0],
    ).toMatchObject({ workoutId: 'a', reps: 8 });
  });
  it('uses exact weighted volume, retains zero cardio/bodyweight, counts sessions not days', () => {
    const workouts = [
      workout(),
      workout({ id: 'w2', exercises: [{ name: 'پرس', sets: 2, reps: 5, weightKg: 10 }] }),
      workout({ id: 'future', date: '2026-10-19' }),
      workout({
        id: 'body',
        date: '2026-10-17',
        exercises: [{ name: 'شنا', sets: 3, reps: 10, weightKg: 0 }],
      }),
    ];
    const buckets = weeklySummary(
      workouts,
      [day('2026-10-17', true), day('2026-10-18', false), day('2026-10-19', true)],
      '2026-10-18',
      6,
    );
    expect(buckets).toHaveLength(8);
    expect(buckets[7]).toEqual({
      key: '2026-10-17',
      start: '2026-10-17',
      end: '2026-10-18',
      volumeKg: 700,
      restDays: 1,
      sessions: 3,
      loggedDays: 2,
      calendarDays: 2,
    });
    expect(weeklySummary([workout()], [], '2026-10-18', 6)[7].volumeKg).toBe(600);
    expect(weeklyProgress(workouts, '2026-10-18', 6)).toBe(3);
    expect(buckets[0].volumeKg).toBeNull();
    expect(buckets[0].restDays).toBeNull();
  });
  it('buckets nondefault calendar weeks across year boundaries and clips the last week', () => {
    const buckets = weeklySummary(
      [workout({ date: '2025-12-31' }), workout({ id: 'future', date: '2026-01-02' })],
      [day('2025-12-30', true)],
      '2026-01-01',
      1,
    );
    expect(buckets[7]).toMatchObject({
      start: '2025-12-29',
      end: '2026-01-01',
      volumeKg: 600,
      restDays: 1,
      calendarDays: 4,
    });
    expect(buckets[0].start).toBe('2025-11-10');
    expect(
      weeklyProgress(
        [workout({ date: '2025-12-28' }), workout({ date: '2025-12-29' })],
        '2026-01-01',
        1,
      ),
    ).toBe(1);
  });
  it('treats an existing daily log as recorded zero without inventing missing-day rest', () => {
    expect(weeklySummary([], [day('2026-10-18', false)], '2026-10-18', 6)[7]).toMatchObject({
      volumeKg: 0,
      restDays: 0,
      loggedDays: 1,
      calendarDays: 2,
    });
  });
  it('distinguishes recorded zero from no workout/rest data without inventing rest days', () => {
    const buckets = weeklySummary(
      [workout({ date: '2026-10-18', exercises: [] })],
      [day('2026-10-18', false)],
      '2026-10-18',
      settings.weekStartsOn,
    );
    expect(buckets[7]).toMatchObject({ volumeKg: 0, restDays: 0, loggedDays: 1, calendarDays: 2 });
    expect(buckets[6]).toMatchObject({
      volumeKg: null,
      restDays: null,
      sessions: 0,
      loggedDays: 0,
    });
    expect(
      weeklySummary([], [], '2026-10-18', 6).every(
        (b) => b.volumeKg === null && b.restDays === null,
      ),
    ).toBe(true);
  });
});
