import type {
  Habit,
  HabitConfig,
  HabitLog,
  Profile,
  WeightEntry,
  WorkoutType,
  Intensity,
} from '../db/types';
import { addDays, dateRange, daysBetween, today, weekday } from './dates.ts';
export function bmi(kg: number, cm: number): number {
  return cm > 0 && kg > 0 ? kg / (cm / 100) ** 2 : 0;
}
const multipliers = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  'very-active': 1.9,
};
export function nutritionTargets(p: Profile, weightKg = p.startWeightKg) {
  if (
    p.age < 18 ||
    p.age > 100 ||
    p.specialCondition ||
    !Number.isFinite(weightKg) ||
    weightKg <= 0 ||
    p.heightCm <= 0
  )
    return null;
  const bmr = Math.round(
    10 * weightKg + 6.25 * p.heightCm - 5 * p.age + (p.sex === 'male' ? 5 : -161),
  );
  const tdee = Math.round(bmr * multipliers[p.activity]);
  const requested = p.goal === 'maintain' ? 0 : Math.max(0, p.weeklyPaceKg);
  const capped = Math.min(requested, weightKg * 0.01);
  const floor = p.sex === 'male' ? 1500 : 1200;
  const sign = p.goal === 'lose' ? -1 : p.goal === 'gain' ? 1 : 0;
  const calories = Math.max(floor, Math.round(tdee + (sign * capped * 7700) / 7));
  const paceKg = sign === 0 ? 0 : Math.max(0, (Math.abs(calories - tdee) * 7) / 7700);
  const protein = Math.round(
    Math.min((calories * 0.35) / 4, weightKg * (p.goal === 'lose' ? 1.8 : 1.6)),
  );
  const fat = Math.round((calories * 0.28) / 9);
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));
  return {
    bmr,
    tdee,
    calories,
    protein,
    carbs,
    fat,
    paceKg: Math.min(capped, paceKg),
    limited: requested > capped || (sign < 0 && calories > tdee - (capped * 7700) / 7 + 0.5),
  };
}
export function movingAverage(
  entries: WeightEntry[],
  windowDays = 7,
): { date: string; weightKg: number; trend: number }[] {
  const latest = new Map<string, WeightEntry>();
  for (const e of [...entries].sort(
    (a, b) =>
      a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.id.localeCompare(b.id),
  ))
    latest.set(e.date, e);
  const rows = [...latest.values()].sort((a, b) => a.date.localeCompare(b.date));
  return rows.map((e) => {
    const window = rows.filter((x) => x.date <= e.date && daysBetween(x.date, e.date) < windowDays);
    return {
      date: e.date,
      weightKg: e.weightKg,
      trend: window.reduce((s, x) => s + x.weightKg, 0) / window.length,
    };
  });
}
export function estimateGoalDate(
  entries: WeightEntry[],
  goalKg: number,
  asOf = today(),
): string | null {
  if (!Number.isFinite(goalKg) || goalKg <= 0) return null;
  const rows = movingAverage(entries.filter((e) => e.date <= asOf && e.date >= addDays(asOf, -30)));
  if (rows.length < 2 || daysBetween(rows[0].date, rows.at(-1)!.date) < 7) return null;
  const first = rows[0],
    last = rows.at(-1)!;
  const delta = (last.trend - first.trend) / daysBetween(first.date, last.date);
  const remaining = goalKg - last.trend;
  if (Math.abs(remaining) < 0.1) return asOf;
  if (Math.abs(delta) < 0.005 || remaining / delta <= 0) return null;
  const days = Math.ceil(remaining / delta);
  return days > 0 && days <= 1095 ? addDays(last.date, days) : null;
}
const mets: Record<WorkoutType, number> = {
  walk: 3.5,
  run: 8.3,
  cycle: 6.8,
  swim: 6,
  strength: 5,
  yoga: 2.5,
  hiit: 9,
  other: 4,
};
export function metCalories(
  type: WorkoutType,
  duration: number,
  intensity: Intensity,
  kg: number,
): number {
  const factor = { light: 0.75, moderate: 1, vigorous: 1.3 }[intensity];
  return Math.max(0, Math.round(((mets[type] * factor * 3.5 * kg) / 200) * duration));
}
export function habitAtDate(h: Habit, date: string): HabitConfig | undefined {
  if (date < h.createdAt) return undefined;
  if (date >= h.updatedFrom) return h;
  return [...h.history]
    .filter((r) => r.from <= date)
    .sort((a, b) => b.from.localeCompare(a.from))[0];
}
export function isHabitScheduled(h: Habit, date: string): boolean {
  const c = habitAtDate(h, date);
  return !!c && !c.archived && c.days.includes(weekday(date));
}
function done(h: Habit, logs: HabitLog[], date: string): boolean {
  const l = logs.find((l) => l.habitId === h.id && l.date === date);
  return !!l && l.value >= l.target;
}
export function habitStreak(h: Habit, logs: HabitLog[], asOf = today()): number {
  let streak = 0;
  for (let d = asOf; d >= h.createdAt; d = addDays(d, -1)) {
    if (!isHabitScheduled(h, d)) continue;
    if (done(h, logs, d)) streak++;
    else if (d !== asOf) break;
  }
  return streak;
}
export function bestHabitStreak(h: Habit, logs: HabitLog[], asOf = today()): number {
  let best = 0,
    current = 0;
  for (const d of dateRange(h.createdAt, asOf)) {
    if (!isHabitScheduled(h, d)) continue;
    current = done(h, logs, d) ? current + 1 : 0;
    best = Math.max(best, current);
  }
  return best;
}
export function dayCompletion(
  habits: Habit[],
  logs: HabitLog[],
  date: string,
): { done: number; total: number; percent: number } {
  const scheduled = habits.filter((h) => isHabitScheduled(h, date));
  const count = scheduled.filter((h) => done(h, logs, date)).length;
  return {
    done: count,
    total: scheduled.length,
    percent: scheduled.length ? Math.round((count / scheduled.length) * 100) : 0,
  };
}
export function dayStreak(habits: Habit[], logs: HabitLog[], asOf = today()): number {
  const earliest = habits.map((h) => h.createdAt).sort()[0];
  if (!earliest) return 0;
  let streak = 0;
  for (let d = asOf; d >= earliest; d = addDays(d, -1)) {
    const c = dayCompletion(habits, logs, d);
    if (!c.total) continue;
    if (c.done === c.total) streak++;
    else if (d !== asOf) break;
  }
  return streak;
}
