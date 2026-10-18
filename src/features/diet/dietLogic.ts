import type { Food, MealEntry, Nutrition, Profile, Settings, WeightEntry } from '../../db/types';
import { nutritionTargets } from '../../lib/calculations';
import { addDays, dateRange, shortDate, startOfWeek, daysBetween } from '../../lib/dates';
export interface NutritionDraft {
  name: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
}
export type ParsedNutrition =
  | { ok: true; value: Nutrition & { name: string } }
  | { ok: false; error: string; field: keyof NutritionDraft };
export type LibraryView = 'all' | 'favorites' | 'recent';
export interface MealGroup {
  entries: MealEntry[];
  totals: Nutrition;
}
export interface DayNutrition {
  entries: MealEntry[];
  totals: Nutrition;
  groups: Record<MealEntry['meal'], MealGroup>;
  hasCheatMeal: boolean;
}
export interface DietChartRow extends Record<string, string | number | null> {
  date: string;
  label: string;
  calories: number | null;
  target: number | null;
  recordedDays: number;
  elapsedDays: number;
}
export interface WeeklyDietChartRow extends DietChartRow {
  endDate: string;
}
export function parseNutritionDraft(draft: NutritionDraft): ParsedNutrition {
  const name = draft.name.trim();
  if (!name) return { ok: false, field: 'name', error: 'نام غذا را وارد کنید.' };
  if (!draft.calories.trim())
    return { ok: false, field: 'calories', error: 'کالری را وارد کنید؛ صفر هم پذیرفته می‌شود.' };
  const value: Nutrition & { name: string } = { name, calories: 0, protein: 0, carbs: 0, fat: 0 };
  const labels = { calories: 'کالری', protein: 'پروتئین', carbs: 'کربوهیدرات', fat: 'چربی' };
  for (const key of ['calories', 'protein', 'carbs', 'fat'] as const) {
    const number = draft[key].trim() ? Number(draft[key]) : 0;
    if (!Number.isFinite(number) || number < 0)
      return { ok: false, field: key, error: `${labels[key]} باید عددی معتبر و نامنفی باشد.` };
    value[key] = number;
  }
  return { ok: true, value };
}
const empty = (): Nutrition => ({ calories: 0, protein: 0, carbs: 0, fat: 0 });
export function summarizeDay(meals: MealEntry[], date: string): DayNutrition {
  const group = (): MealGroup => ({ entries: [], totals: empty() });
  const groups = { breakfast: group(), lunch: group(), dinner: group(), snack: group() };
  const entries = meals.filter((m) => m.date === date);
  const totals = empty();
  for (const m of entries) {
    groups[m.meal].entries.push(m);
    for (const k of ['calories', 'protein', 'carbs', 'fat'] as const) {
      totals[k] += m[k];
      groups[m.meal].totals[k] += m[k];
    }
  }
  return { entries, totals, groups, hasCheatMeal: entries.some((m) => m.cheat) };
}
export function libraryFoods(foods: Food[], search: string, view: LibraryView): Food[] {
  return foods
    .filter(
      (f) =>
        f.name.includes(search.trim()) &&
        (view !== 'favorites' || f.favorite) &&
        (view !== 'recent' || f.lastUsedAt !== null),
    )
    .sort((a, b) =>
      view === 'recent'
        ? Date.parse(b.lastUsedAt!) - Date.parse(a.lastUsedAt!) || a.id.localeCompare(b.id)
        : a.name.localeCompare(b.name, 'fa') || a.id.localeCompare(b.id),
    );
}
export function latestEligibleWeight(weights: WeightEntry[], date: string): number | undefined {
  return [...weights]
    .filter((w) => w.date <= date)
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) || b.time.localeCompare(a.time) || b.id.localeCompare(a.id),
    )[0]?.weightKg;
}
export function dietTargets(profile: Profile | undefined, weights: WeightEntry[], date: string) {
  return profile
    ? nutritionTargets(profile, latestEligibleWeight(weights, date) ?? profile.startWeightKg)
    : null;
}
export function buildDietCharts(
  meals: MealEntry[],
  date: string,
  settings: Settings,
  target: number | null,
): { daily: DietChartRow[]; weekly: WeeklyDietChartRow[] } {
  const total = (start: string, end: string) => {
    const rows = meals.filter((m) => m.date >= start && m.date <= end);
    return {
      calories: rows.length ? rows.reduce((s, m) => s + m.calories, 0) : null,
      recordedDays: new Set(rows.map((m) => m.date)).size,
    };
  };
  const daily = dateRange(addDays(date, -6), date).map((d) => ({
    date: d,
    label: shortDate(d, settings),
    ...total(d, d),
    target,
    elapsedDays: 1,
  }));
  const current = startOfWeek(date, settings.weekStartsOn);
  const weekly = Array.from({ length: 8 }, (_, i) => {
    const start = addDays(current, -(7 - i) * 7);
    const end = addDays(start, 6) > date ? date : addDays(start, 6);
    const elapsedDays = daysBetween(start, end) + 1;
    return {
      date: start,
      endDate: end,
      label: shortDate(start, settings),
      ...total(start, end),
      target: target === null ? null : target * elapsedDays,
      elapsedDays,
    };
  });
  return { daily, weekly };
}
