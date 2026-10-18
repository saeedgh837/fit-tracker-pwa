import type { MeasurementEntry, Profile, Settings, WeightEntry } from '../../db/types';
import { bmi, estimateGoalDate, movingAverage } from '../../lib/calculations';
import { addDays, isISODate } from '../../lib/dates';
import { fromCm, fromKg, toCm, toKg } from '../../lib/format';

export type Range = '7' | '30' | '90' | 'all';
type WeightUnit = Settings['weightUnit'];
type HeightUnit = Settings['heightUnit'];
export type MeasurementKey = 'waist' | 'chest' | 'hip' | 'arm' | 'thigh';
export const measurementFields: ReadonlyArray<{ key: MeasurementKey; label: string }> = [
  { key: 'waist', label: 'دور کمر' },
  { key: 'chest', label: 'دور سینه' },
  { key: 'hip', label: 'دور باسن' },
  { key: 'arm', label: 'دور بازو' },
  { key: 'thigh', label: 'دور ران' },
];
export interface WeightDraft {
  id?: string;
  date: string;
  time: string;
  weight: string;
  note: string;
  unit: WeightUnit;
}
export type MeasurementDraft = { id?: string; date: string; unit: HeightUnit } & Record<
  MeasurementKey,
  string
>;
export type Validation<T> =
  { value: T; errors?: never } | { errors: Record<string, string>; value?: never };
const positive = (n: number) => Number.isFinite(n) && n > 0;
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const realTime = (time: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time);

export function createWeightDraft(
  entry: WeightEntry | undefined,
  date: string,
  unit: WeightUnit,
  time?: string,
): WeightDraft {
  const now = new Date();
  return {
    id: entry?.id,
    date: entry?.date ?? date,
    time:
      entry?.time ??
      time ??
      `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    weight: entry ? String(fromKg(entry.weightKg, unit)) : '',
    note: entry?.note ?? '',
    unit,
  };
}
export function validateWeight(draft: WeightDraft, newId: string): Validation<WeightEntry> {
  const errors: Record<string, string> = {};
  if (!isISODate(draft.date)) errors.date = 'یک تاریخ معتبر انتخاب کنید.';
  if (!realTime(draft.time)) errors.time = 'ساعت را از ۰۰:۰۰ تا ۲۳:۵۹ وارد کنید.';
  const weightKg = toKg(Number(draft.weight), draft.unit);
  if (!draft.weight.trim() || !positive(weightKg))
    errors.weight = 'وزن باید یک عدد مثبت و معتبر باشد.';
  if (Object.keys(errors).length) return { errors };
  return {
    value: {
      id: draft.id ?? newId,
      date: draft.date,
      time: draft.time,
      weightKg,
      note: draft.note,
    },
  };
}
export function createMeasurementDraft(
  entry: MeasurementEntry | undefined,
  date: string,
  unit: HeightUnit,
): MeasurementDraft {
  const fields = Object.fromEntries(
    measurementFields.map(({ key }) => [
      key,
      entry?.[key] === undefined ? '' : String(fromCm(entry[key]!, unit)),
    ]),
  ) as Record<MeasurementKey, string>;
  return { ...fields, id: entry?.id, date: entry?.date ?? date, unit };
}
export function validateMeasurement(
  draft: MeasurementDraft,
  newId: string,
): Validation<MeasurementEntry> {
  const errors: Record<string, string> = {};
  const value: MeasurementEntry = { id: draft.id ?? newId, date: draft.date };
  if (!isISODate(draft.date)) errors.date = 'یک تاریخ معتبر انتخاب کنید.';
  let supplied = false;
  for (const { key } of measurementFields) {
    if (!draft[key].trim()) continue;
    supplied = true;
    const cm = toCm(Number(draft[key]), draft.unit);
    if (!positive(cm)) errors[key] = 'اندازه باید یک عدد مثبت و معتبر باشد.';
    else value[key] = cm;
  }
  if (!supplied) errors.form = 'حداقل یک اندازه وارد کنید.';
  return Object.keys(errors).length ? { errors } : { value };
}
function rangeStart(asOf: string, range: Range): string {
  return range === 'all' ? '0000-01-01' : addDays(asOf, 1 - Number(range));
}
function validHistorical(entries: WeightEntry[], asOf: string): WeightEntry[] {
  return entries
    .filter((x) => isISODate(x.date) && x.date <= asOf && positive(x.weightKg) && realTime(x.time))
    .sort((a, b) => compare(a.date, b.date) || compare(a.time, b.time) || compare(a.id, b.id));
}
export function buildWeightSeries(
  entries: WeightEntry[],
  asOf: string,
  range: Range,
  unit: WeightUnit,
) {
  const historical = validHistorical(entries, asOf);
  const start = rangeStart(asOf, range);
  // Compute before filtering: preceding days still contribute to the first visible average.
  const daily = movingAverage(historical, 7);
  return {
    raw: historical.filter((x) => x.date >= start),
    points: daily
      .filter((x) => x.date >= start)
      .map((x) => ({
        date: x.date,
        weight: fromKg(x.weightKg, unit),
        trend: fromKg(x.trend, unit),
      })),
  };
}
export function rollingChange(
  entries: WeightEntry[],
  asOf: string,
  days: 7 | 30,
): { deltaKg: number; from: string; to: string } | null {
  const daily = movingAverage(validHistorical(entries, asOf), 7);
  const current = daily.at(-1);
  const cutoff = addDays(asOf, -days);
  const baseline = daily.filter((x) => x.date <= cutoff).at(-1);
  return current && baseline
    ? { deltaKg: current.weightKg - baseline.weightKg, from: baseline.date, to: current.date }
    : null;
}
export function weightSummary(
  entries: WeightEntry[],
  profile: Profile | undefined,
  asOf: string,
  unit: WeightUnit,
) {
  const historical = validHistorical(entries, asOf);
  const latest = historical.at(-1);
  const validGoal = profile && positive(profile.goalWeightKg) ? profile.goalWeightKg : null;
  const reached = Boolean(
    latest &&
    validGoal !== null &&
    profile?.goal !== 'maintain' &&
    (profile?.goal === 'lose' ? latest.weightKg <= validGoal : latest.weightKg >= validGoal),
  );
  return {
    latest,
    goal: validGoal === null ? null : fromKg(validGoal, unit),
    reached,
    bmi:
      latest && profile && positive(profile.heightCm)
        ? bmi(latest.weightKg, profile.heightCm)
        : null,
    eta:
      !latest || validGoal === null || reached || profile?.goal === 'maintain'
        ? null
        : estimateGoalDate(historical, validGoal, asOf),
    week: rollingChange(entries, asOf, 7),
    month: rollingChange(entries, asOf, 30),
  };
}
export function buildMeasurementSeries(
  entries: MeasurementEntry[],
  asOf: string,
  range: Range,
  unit: HeightUnit,
) {
  const start = rangeStart(asOf, range);
  let previousDate = '',
    ordinal = 0;
  return entries
    .filter((x) => isISODate(x.date) && x.date >= start && x.date <= asOf)
    .sort((a, b) => compare(a.date, b.date) || compare(a.id, b.id))
    .map((entry) => {
      ordinal = previousDate === entry.date ? ordinal + 1 : 1;
      previousDate = entry.date;
      const values = Object.fromEntries(
        measurementFields.map(({ key }) => [
          key,
          entry[key] !== undefined && positive(entry[key]) ? fromCm(entry[key], unit) : null,
        ]),
      ) as Record<MeasurementKey, number | null>;
      return { ...values, date: entry.date, id: entry.id, ordinal };
    });
}
