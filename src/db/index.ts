import Dexie, { type EntityTable } from 'dexie';
import type {
  Profile,
  Settings,
  Habit,
  HabitLog,
  DailyLog,
  WeightEntry,
  MeasurementEntry,
  Food,
  MealEntry,
  WorkoutEntry,
  Routine,
  Photo,
  HabitConfig,
} from './types';
import { today } from '../lib/dates';
import { habitAtDate } from '../lib/calculations';
export const defaultSettings: Settings = {
  id: 'main',
  weightUnit: 'kg',
  heightUnit: 'cm',
  calendar: 'persian',
  weekStartsOn: 6,
  persianDigits: true,
  theme: 'auto',
  reminders: true,
  reminderHour: 18,
  onboardingComplete: false,
};
export const defaultProfile: Profile = {
  id: 'main',
  name: '',
  sex: 'female',
  age: 30,
  heightCm: 165,
  startWeightKg: 70,
  goalWeightKg: 65,
  activity: 'light',
  goal: 'lose',
  weeklyPaceKg: 0.25,
  waterGoalMl: 2000,
  workoutGoal: 3,
  specialCondition: false,
};
export const db = new Dexie('hamgam-fit-tracker-v1') as Dexie & {
  profiles: EntityTable<Profile, 'id'>;
  settings: EntityTable<Settings, 'id'>;
  habits: EntityTable<Habit, 'id'>;
  habitLogs: EntityTable<HabitLog, 'id'>;
  days: EntityTable<DailyLog, 'date'>;
  weights: EntityTable<WeightEntry, 'id'>;
  measurements: EntityTable<MeasurementEntry, 'id'>;
  foods: EntityTable<Food, 'id'>;
  meals: EntityTable<MealEntry, 'id'>;
  workouts: EntityTable<WorkoutEntry, 'id'>;
  routines: EntityTable<Routine, 'id'>;
  photos: EntityTable<Photo, 'id'>;
};
db.version(1).stores({
  profiles: 'id',
  settings: 'id',
  habits: 'id,order,createdAt',
  habitLogs: 'id,&[habitId+date],date,habitId',
  days: 'date',
  weights: 'id,date',
  measurements: 'id,date',
  foods: 'id,name,lastUsedAt',
  meals: 'id,date,foodId',
  workouts: 'id,date',
  routines: 'id',
  photos: 'id,date',
});
db.on('versionchange', () => {
  db.close();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('fit-db-versionchange'));
});
export function uid(): string {
  return crypto.randomUUID();
}
export function emptyDay(date: string): DailyLog {
  return {
    date,
    waterMl: 0,
    steps: 0,
    sleepHours: null,
    mood: null,
    energy: null,
    note: '',
    adherence: null,
    restDay: false,
    cheatMeal: false,
  };
}
export async function initializeDB(): Promise<void> {
  await db.open();
  await db.transaction('rw', db.settings, async () => {
    if (!(await db.settings.get('main'))) await db.settings.put(defaultSettings);
  });
}
export async function updateDay(
  date: string,
  patch: Partial<Omit<DailyLog, 'date'>>,
): Promise<void> {
  await db.transaction('rw', db.days, async () => {
    const existing = await db.days.get(date);
    await db.days.put({ ...emptyDay(date), ...existing, ...patch, date });
  });
}
export async function changeWater(date: string, deltaMl: number): Promise<void> {
  if (!Number.isFinite(deltaMl)) throw new Error('مقدار آب معتبر نیست.');
  await db.transaction('rw', db.days, async () => {
    const day = (await db.days.get(date)) ?? emptyDay(date);
    await db.days.put({ ...day, waterMl: Math.max(0, Math.min(20000, day.waterMl + deltaMl)) });
  });
}
function config(h: Habit): HabitConfig {
  return {
    name: h.name,
    icon: h.icon,
    color: h.color,
    days: [...h.days],
    target: h.target,
    unit: h.unit,
    archived: h.archived,
  };
}
export async function saveHabit(habit: Habit): Promise<void> {
  await db.transaction('rw', db.habits, async () => {
    const old = await db.habits.get(habit.id);
    const now = today();
    if (!old) {
      await db.habits.put({ ...habit, createdAt: now, updatedFrom: now, history: [] });
      return;
    }
    const changed = JSON.stringify(config(old)) !== JSON.stringify(config(habit));
    if (!changed) {
      await db.habits.put({ ...old, order: habit.order });
      return;
    }
    const history =
      old.updatedFrom < now
        ? [...old.history, { ...config(old), from: old.updatedFrom }]
        : old.history;
    await db.habits.put({ ...habit, createdAt: old.createdAt, updatedFrom: now, history });
  });
}
export async function setHabitValue(habit: Habit, date: string, value: number): Promise<void> {
  if (!Number.isFinite(value) || value < 0) throw new Error('مقدار عادت معتبر نیست.');
  const cfg = habitAtDate(habit, date);
  if (!cfg) throw new Error('این عادت در تاریخ انتخاب‌شده وجود ندارد.');
  await db.transaction('rw', db.habitLogs, async () => {
    const existing = await db.habitLogs.where('[habitId+date]').equals([habit.id, date]).first();
    await db.habitLogs.put({
      id: existing?.id ?? uid(),
      date,
      habitId: habit.id,
      value,
      target: existing?.target ?? cfg.target,
    });
  });
}
export async function removeHabit(id: string): Promise<void> {
  await db.transaction('rw', db.habits, db.habitLogs, async () => {
    await db.habitLogs.where('habitId').equals(id).delete();
    await db.habits.delete(id);
  });
}
export function defaultHabits(date = today()): Habit[] {
  const entries: Pick<Habit, 'name' | 'icon' | 'color' | 'target' | 'unit'>[] = [
    { name: 'آب کافی', icon: 'water', color: 'blue', target: 8, unit: 'لیوان' },
    { name: 'پایبندی به برنامهٔ غذایی', icon: 'food', color: 'teal', target: 1, unit: 'بار' },
    { name: 'تحرک روزانه', icon: 'workout', color: 'orange', target: 1, unit: 'بار' },
    { name: 'خواب کافی', icon: 'sleep', color: 'violet', target: 7, unit: 'ساعت' },
    { name: 'قدم‌های امروز', icon: 'steps', color: 'teal', target: 7000, unit: 'قدم' },
    { name: 'ویتامین طبق توصیهٔ پزشک', icon: 'vitamin', color: 'rose', target: 1, unit: 'بار' },
    { name: 'بدون قند افزوده', icon: 'sugar', color: 'orange', target: 1, unit: 'بار' },
  ];
  return entries.map((e, order) => ({
    ...e,
    id: uid(),
    days: [0, 1, 2, 3, 4, 5, 6],
    archived: false,
    order,
    createdAt: date,
    updatedFrom: date,
    history: [],
  }));
}
