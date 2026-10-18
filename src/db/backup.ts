import { z } from 'zod';
import { db } from './index';
import { isISODate } from '../lib/dates';
const id = z.string().min(1).max(120);
const date = z.string().refine(isISODate, 'تاریخ معتبر نیست.');
const num = (max = 1e6) => z.number().finite().min(0).max(max);
const text = z.string().max(10000);
const name = z.string().trim().min(1).max(120);
const nutrition = { calories: num(30000), protein: num(3000), carbs: num(5000), fat: num(3000) };
const habitConfig = {
  name,
  icon: z.enum([
    'water',
    'food',
    'workout',
    'sleep',
    'steps',
    'vitamin',
    'sugar',
    'heart',
    'book',
    'sun',
  ]),
  color: z.enum(['teal', 'blue', 'orange', 'violet', 'rose']),
  days: z
    .array(z.number().int().min(0).max(6))
    .min(1)
    .max(7)
    .refine((v) => new Set(v).size === v.length),
  target: z.number().finite().positive().max(1e6),
  unit: z.string().min(1).max(40),
  archived: z.boolean(),
};
const exercises = z
  .array(
    z.strictObject({
      name,
      sets: z.number().int().min(1).max(100),
      reps: z.number().int().min(1).max(1000),
      weightKg: num(2000),
    }),
  )
  .max(100);
const workout = {
  type: z.enum(['walk', 'run', 'cycle', 'swim', 'strength', 'yoga', 'hiit', 'other']),
  duration: z.number().finite().positive().max(1440),
  intensity: z.enum(['light', 'moderate', 'vigorous']),
  exercises,
};
export const profileSchema = z.strictObject({
  id: z.literal('main'),
  name: z.string().max(120),
  sex: z.enum(['female', 'male']),
  age: z.number().int().min(18).max(100),
  heightCm: z.number().finite().min(100).max(250),
  startWeightKg: z.number().finite().min(30).max(400),
  goalWeightKg: z.number().finite().min(30).max(400),
  activity: z.enum(['sedentary', 'light', 'moderate', 'active', 'very-active']),
  goal: z.enum(['lose', 'maintain', 'gain']),
  weeklyPaceKg: num(4),
  waterGoalMl: z.number().int().min(250).max(8000),
  workoutGoal: z.number().int().min(0).max(14),
  specialCondition: z.boolean(),
});
export const settingsSchema = z.strictObject({
  id: z.literal('main'),
  weightUnit: z.enum(['kg', 'lb']),
  heightUnit: z.enum(['cm', 'in']),
  calendar: z.enum(['persian', 'gregory']),
  weekStartsOn: z.number().int().min(0).max(6),
  persianDigits: z.boolean(),
  theme: z.enum(['light', 'dark', 'auto']),
  reminders: z.boolean(),
  reminderHour: z.number().int().min(0).max(23),
  onboardingComplete: z.boolean(),
});
const schemas = {
  profiles: profileSchema,
  settings: settingsSchema,
  habits: z.strictObject({
    id,
    ...habitConfig,
    order: z.number().int().min(0),
    createdAt: date,
    updatedFrom: date,
    history: z.array(z.strictObject({ ...habitConfig, from: date })).max(10000),
  }),
  habitLogs: z.strictObject({
    id,
    date,
    habitId: id,
    value: num(),
    target: z.number().finite().positive().max(1e6),
  }),
  days: z.strictObject({
    date,
    waterMl: num(20000),
    steps: z.number().int().min(0).max(200000),
    sleepHours: num(24).nullable(),
    mood: z.number().int().min(1).max(5).nullable(),
    energy: z.number().int().min(1).max(5).nullable(),
    note: text,
    adherence: z.enum(['full', 'partial', 'off']).nullable(),
    restDay: z.boolean(),
    cheatMeal: z.boolean(),
  }),
  weights: z.strictObject({
    id,
    date,
    time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    weightKg: z.number().finite().min(20).max(500),
    note: text,
  }),
  measurements: z.strictObject({
    id,
    date,
    waist: z.number().finite().positive().max(500).optional(),
    chest: z.number().finite().positive().max(500).optional(),
    hip: z.number().finite().positive().max(500).optional(),
    arm: z.number().finite().positive().max(500).optional(),
    thigh: z.number().finite().positive().max(500).optional(),
  }),
  foods: z.strictObject({
    id,
    name,
    ...nutrition,
    favorite: z.boolean(),
    lastUsedAt: z.string().max(40).nullable(),
  }),
  meals: z.strictObject({
    id,
    date,
    meal: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
    name,
    ...nutrition,
    cheat: z.boolean(),
    foodId: id.optional(),
  }),
  workouts: z.strictObject({ id, date, ...workout, calories: num(30000), notes: text }),
  routines: z.strictObject({ id, name, ...workout }),
  photos: z.strictObject({
    id,
    date,
    dataUrl: z
      .string()
      .max(710000)
      .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/),
    note: text,
  }),
};
export const tableNames = Object.keys(schemas) as (keyof typeof schemas)[];
const backupSchema = z.strictObject({
  app: z.literal('hamgam-fit-tracker'),
  version: z.literal(1),
  exportedAt: z.string().datetime(),
  data: z.strictObject({
    profiles: z.array(schemas.profiles).max(1),
    settings: z.array(schemas.settings).max(1),
    habits: z.array(schemas.habits),
    habitLogs: z.array(schemas.habitLogs),
    days: z.array(schemas.days),
    weights: z.array(schemas.weights),
    measurements: z.array(schemas.measurements),
    foods: z.array(schemas.foods),
    meals: z.array(schemas.meals),
    workouts: z.array(schemas.workouts),
    routines: z.array(schemas.routines),
    photos: z.array(schemas.photos).max(100),
  }),
});
export type Backup = z.infer<typeof backupSchema>;
export const MAX_BACKUP_BYTES = 40 * 1024 * 1024;
export async function exportBackup(): Promise<Backup> {
  return db.transaction('r', db.tables, async () => {
    const data = Object.fromEntries(
      await Promise.all(tableNames.map(async (n) => [n, await db.table(n).toArray()])),
    );
    return backupSchema.parse({
      app: 'hamgam-fit-tracker',
      version: 1,
      exportedAt: new Date().toISOString(),
      data,
    });
  });
}
export function validateBackup(raw: string): Backup {
  if (new Blob([raw]).size > MAX_BACKUP_BYTES)
    throw new Error('حجم پشتیبان بیشتر از ۴۰ مگابایت است.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('فایل JSON معتبر نیست.');
  }
  const result = backupSchema.safeParse(parsed);
  if (!result.success) throw new Error('ساختار، نسخه یا مقادیر فایل پشتیبان معتبر نیست.');
  const b = result.data;
  let count = 0;
  for (const n of tableNames) {
    const records = b.data[n];
    count += records.length;
    const ids = records.map((r) => ('id' in r ? r.id : r.date));
    if (new Set(ids).size !== ids.length) throw new Error('پشتیبان شناسهٔ تکراری دارد.');
  }
  if (count > 50000) throw new Error('پشتیبان بیش از ۵۰ هزار رکورد دارد.');
  const habits = new Set(b.data.habits.map((h) => h.id));
  const foods = new Set(b.data.foods.map((f) => f.id));
  const pairs = new Set<string>();
  for (const l of b.data.habitLogs) {
    const key = `${l.habitId}/${l.date}`;
    if (!habits.has(l.habitId) || pairs.has(key)) throw new Error('ارتباط سوابق عادت معتبر نیست.');
    pairs.add(key);
  }
  for (const m of b.data.meals)
    if (m.foodId && !foods.has(m.foodId)) throw new Error('ارتباط غذاهای پشتیبان معتبر نیست.');
  for (const h of b.data.habits) {
    if (
      h.updatedFrom < h.createdAt ||
      h.history.some((r) => r.from < h.createdAt || r.from >= h.updatedFrom) ||
      new Set(h.history.map((r) => r.from)).size !== h.history.length
    )
      throw new Error('تاریخچهٔ عادت معتبر نیست.');
  }
  if (b.data.settings[0]?.onboardingComplete && !b.data.profiles.length)
    throw new Error('پروفایل پشتیبان وجود ندارد.');
  for (const m of b.data.measurements)
    if (!['waist', 'chest', 'hip', 'arm', 'thigh'].some((k) => k in m))
      throw new Error('اندازه‌های بدن خالی است.');
  for (const p of b.data.photos) {
    let binary: string;
    try {
      binary = atob(p.dataUrl.split(',')[1]);
    } catch {
      throw new Error('عکس پشتیبان معتبر نیست.');
    }
    if (binary.length > 512 * 1024 || binary.charCodeAt(0) !== 255 || binary.charCodeAt(1) !== 216)
      throw new Error('عکس پشتیبان باید JPEG فشرده و معتبر باشد.');
  }
  return b;
}
async function checkPhoto(dataUrl: string): Promise<void> {
  const image = new Image();
  image.src = dataUrl;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('خواندن عکس پشتیبان انجام نشد.')), 10000);
    image.onload = () => {
      clearTimeout(timer);
      if (
        image.naturalWidth <= 0 ||
        image.naturalHeight <= 0 ||
        Math.max(image.naturalWidth, image.naturalHeight) > 1280
      )
        reject(new Error('ابعاد عکس پشتیبان معتبر نیست.'));
      else resolve();
    };
    image.onerror = () => {
      clearTimeout(timer);
      reject(new Error('عکس پشتیبان خراب است.'));
    };
  });
}
export async function importBackup(raw: string): Promise<void> {
  const backup = validateBackup(raw);
  for (const photo of backup.data.photos) await checkPhoto(photo.dataUrl);
  await db.transaction('rw', db.tables, async () => {
    for (const n of tableNames) {
      await db.table(n).clear();
      await db.table(n).bulkPut(backup.data[n]);
    }
  });
}
export async function resetData(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) await t.clear();
  });
}
function csvCell(value: unknown): string {
  let str = typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(str)) str = `'${str}`;
  return `"${str.replaceAll('"', '""')}"`;
}
export async function exportCSV(): Promise<string> {
  const b = await exportBackup();
  const rows: unknown[][] = [['table', 'id', 'date', 'field', 'value']];
  for (const n of tableNames) {
    if (n === 'photos') continue;
    for (const record of b.data[n])
      for (const [field, value] of Object.entries(record)) {
        rows.push([
          n,
          'id' in record ? record.id : '',
          'date' in record ? record.date : '',
          field,
          value,
        ]);
      }
  }
  return '﻿' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}
