import type {
  DailyLog,
  ExerciseSet,
  Intensity,
  Profile,
  Routine,
  WeightEntry,
  WorkoutEntry,
  WorkoutType,
} from '../../db/types';
import { metCalories } from '../../lib/calculations';
import { addDays, dateRange, isISODate, startOfWeek } from '../../lib/dates';
import { fromKg, toKg } from '../../lib/format';

export interface SetDraft {
  name: string;
  sets: string;
  reps: string;
  weight: string;
}
export interface MovementDraft {
  type: string;
  duration: string;
  intensity: string;
  exercises: SetDraft[];
  inputUnit: 'kg' | 'lb';
}
export interface WorkoutDraft extends MovementDraft {
  id?: string;
  date: string;
  notes: string;
}
export interface RoutineDraft extends MovementDraft {
  id?: string;
  name: string;
}
interface Movement {
  type: WorkoutType;
  duration: number;
  intensity: Intensity;
  exercises: ExerciseSet[];
}
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export const workoutNames: Record<WorkoutType, string> = {
  walk: 'پیاده‌روی',
  run: 'دویدن',
  cycle: 'دوچرخه‌سواری',
  swim: 'شنا',
  strength: 'تمرین قدرتی',
  yoga: 'یوگا',
  hiit: 'تمرین تناوبی',
  other: 'سایر فعالیت‌ها',
};
export const intensityNames: Record<Intensity, string> = {
  light: 'سبک',
  moderate: 'متوسط',
  vigorous: 'شدید',
};

export function validateMovement(draft: MovementDraft): Result<Movement> {
  if (!Object.hasOwn(workoutNames, draft.type) || !Object.hasOwn(intensityNames, draft.intensity)) {
    return { ok: false, error: 'نوع و شدت تمرین را از گزینه‌های موجود انتخاب کنید.' };
  }
  const duration = Number(draft.duration);
  if (
    !draft.duration.trim() ||
    !Number.isFinite(duration) ||
    !Number.isInteger(duration) ||
    duration < 1
  ) {
    return { ok: false, error: 'مدت تمرین باید یک عدد صحیح مثبت بر حسب دقیقه باشد.' };
  }
  if (draft.inputUnit !== 'kg' && draft.inputUnit !== 'lb')
    return { ok: false, error: 'واحد وزنه معتبر نیست.' };
  const exercises: ExerciseSet[] = [];
  for (const row of draft.exercises) {
    if (Object.values(row).every((value) => !value.trim())) continue;
    const sets = Number(row.sets),
      reps = Number(row.reps),
      weight = Number(row.weight);
    if (
      !row.name.trim() ||
      !row.sets.trim() ||
      !row.reps.trim() ||
      !row.weight.trim() ||
      !Number.isFinite(sets) ||
      !Number.isInteger(sets) ||
      sets < 1 ||
      !Number.isFinite(reps) ||
      !Number.isInteger(reps) ||
      reps < 1 ||
      !Number.isFinite(weight) ||
      weight < 0
    ) {
      return {
        ok: false,
        error:
          'نام حرکت، تعداد صحیح و مثبت ست و تکرار و وزنهٔ نامنفی را کامل وارد کنید. برای حرکت بدون وزنه، صفر وارد کنید.',
      };
    }
    // Convert each input once at the boundary; never round a canonical load.
    exercises.push({ name: row.name.trim(), sets, reps, weightKg: toKg(weight, draft.inputUnit) });
  }
  return {
    ok: true,
    value: {
      type: draft.type as WorkoutType,
      duration,
      intensity: draft.intensity as Intensity,
      exercises,
    },
  };
}
export function validateRoutine(draft: RoutineDraft): Result<Movement & { name: string }> {
  if (!draft.name.trim()) return { ok: false, error: 'نام برنامه را وارد کنید.' };
  const movement = validateMovement(draft);
  return movement.ok
    ? { ok: true, value: { ...movement.value, name: draft.name.trim() } }
    : movement;
}
export function validateCount(value: string): Result<number> {
  const number = Number(value);
  return value.trim() && Number.isFinite(number) && Number.isInteger(number) && number >= 0
    ? { ok: true, value: number }
    : { ok: false, error: 'یک عدد صحیح نامنفی وارد کنید.' };
}
export function weightAsOf(
  weights: WeightEntry[],
  profile: Profile | undefined,
  date: string,
): number | null {
  const latest = weights
    .filter(
      (weight) => weight.date <= date && Number.isFinite(weight.weightKg) && weight.weightKg > 0,
    )
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) || b.time.localeCompare(a.time) || b.id.localeCompare(a.id),
    )[0];
  return (
    latest?.weightKg ??
    (profile && Number.isFinite(profile.startWeightKg) && profile.startWeightKg > 0
      ? profile.startWeightKg
      : null)
  );
}
export function resolveCalories(
  movement: Movement,
  date: string,
  weights: WeightEntry[],
  profile: Profile | undefined,
  old?: WorkoutEntry,
  estimator = metCalories,
): { calories: number; weightKg: number | null; preserved: boolean } | null {
  const weightKg = weightAsOf(weights, profile, date);
  if (
    old &&
    old.type === movement.type &&
    old.duration === movement.duration &&
    old.intensity === movement.intensity &&
    old.date === date
  ) {
    return { calories: old.calories, weightKg, preserved: true };
  }
  if (weightKg === null) return null;
  const calories = estimator(movement.type, movement.duration, movement.intensity, weightKg);
  return Number.isFinite(calories) && calories >= 0
    ? { calories, weightKg, preserved: false }
    : null;
}
const setDrafts = (exercises: ExerciseSet[], unit: 'kg' | 'lb'): SetDraft[] =>
  exercises.map((row) => ({
    name: row.name,
    sets: String(row.sets),
    reps: String(row.reps),
    weight: String(fromKg(row.weightKg, unit)),
  }));
export function workoutDraft(workout: WorkoutEntry, unit: 'kg' | 'lb'): WorkoutDraft {
  return {
    id: workout.id,
    date: workout.date,
    type: workout.type,
    duration: String(workout.duration),
    intensity: workout.intensity,
    notes: workout.notes,
    exercises: setDrafts(workout.exercises, unit),
    inputUnit: unit,
  };
}
export function routineDraft(routine: Routine, unit: 'kg' | 'lb'): RoutineDraft {
  return {
    id: routine.id,
    name: routine.name,
    type: routine.type,
    duration: String(routine.duration),
    intensity: routine.intensity,
    exercises: setDrafts(routine.exercises, unit),
    inputUnit: unit,
  };
}
export function createRoutineWorkoutDraft(
  routine: Routine,
  date: string,
  unit: 'kg' | 'lb',
): WorkoutDraft {
  return {
    date,
    type: routine.type,
    duration: String(routine.duration),
    intensity: routine.intensity,
    notes: '',
    exercises: setDrafts(routine.exercises, unit),
    inputUnit: unit,
  };
}
export function buildWorkout(
  draft: WorkoutDraft,
  id: string,
  weights: WeightEntry[],
  profile: Profile | undefined,
  old?: WorkoutEntry,
): Result<WorkoutEntry> {
  const movement = validateMovement(draft);
  if (!movement.ok) return movement;
  const date = old?.date ?? draft.date;
  if (!isISODate(date)) return { ok: false, error: 'تاریخ تمرین معتبر نیست.' };
  const estimate = resolveCalories(movement.value, date, weights, profile, old);
  if (!estimate) return { ok: false, error: 'برای برآورد کالری، ابتدا وزن خود را ثبت کنید.' };
  return {
    ok: true,
    value: {
      id: old?.id ?? id,
      date,
      ...movement.value,
      calories: estimate.calories,
      notes: draft.notes.trim(),
    },
  };
}
export function buildRoutine(draft: RoutineDraft, id: string): Result<Routine> {
  const routine = validateRoutine(draft);
  return routine.ok ? { ok: true, value: { id: draft.id ?? id, ...routine.value } } : routine;
}
const normalizedName = (name: string) =>
  name.replaceAll('ي', 'ی').replaceAll('ك', 'ک').trim().replace(/\s+/g, ' ');
export interface PersonalRecord {
  key: string;
  name: string;
  weightKg: number;
  sets: number;
  reps: number;
  date: string;
  workoutId: string;
}
export function personalRecords(workouts: WorkoutEntry[], date: string): PersonalRecord[] {
  const records = new Map<string, PersonalRecord>();
  // On tied loads, latest date then lexically greatest ID wins. Within one
  // workout the last matching row wins, independent of source array order.
  const eligible = workouts
    .filter((workout) => workout.date <= date)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  for (const workout of eligible)
    for (const row of workout.exercises) {
      if (!Number.isFinite(row.weightKg) || row.weightKg <= 0) continue;
      const key = normalizedName(row.name);
      if (!key) continue;
      const old = records.get(key);
      if (!old || row.weightKg >= old.weightKg)
        records.set(key, {
          key,
          name: key,
          weightKg: row.weightKg,
          sets: row.sets,
          reps: row.reps,
          date: workout.date,
          workoutId: workout.id,
        });
    }
  return [...records.values()].sort((a, b) => a.key.localeCompare(b.key, 'fa'));
}
export interface WeeklySummary {
  key: string;
  start: string;
  end: string;
  volumeKg: number | null;
  restDays: number | null;
  sessions: number;
  loggedDays: number;
  calendarDays: number;
}
export function weeklySummary(
  workouts: WorkoutEntry[],
  days: DailyLog[],
  date: string,
  weekStartsOn: number,
): WeeklySummary[] {
  const current = startOfWeek(date, weekStartsOn);
  return Array.from({ length: 8 }, (_, index) => {
    const start = addDays(current, -(7 - index) * 7);
    const fullEnd = addDays(start, 6),
      end = fullEnd > date ? date : fullEnd;
    const calendar = new Set(dateRange(start, end));
    const rows = workouts.filter((workout) => calendar.has(workout.date));
    const logs = days.filter((day) => calendar.has(day.date));
    const loggedDays = new Set([
      ...rows.map((workout) => workout.date),
      ...logs.map((day) => day.date),
    ]).size;
    return {
      key: start,
      start,
      end,
      volumeKg:
        loggedDays > 0
          ? rows.reduce(
              (sum, workout) =>
                sum +
                workout.exercises.reduce(
                  (volume, row) => volume + row.sets * row.reps * row.weightKg,
                  0,
                ),
              0,
            )
          : null,
      restDays: loggedDays > 0 ? logs.filter((day) => day.restDay).length : null,
      sessions: rows.length,
      loggedDays,
      calendarDays: calendar.size,
    };
  });
}
export function weeklyProgress(
  workouts: WorkoutEntry[],
  date: string,
  weekStartsOn: number,
): number {
  const start = startOfWeek(date, weekStartsOn);
  return workouts.filter((workout) => workout.date >= start && workout.date <= date).length;
}
