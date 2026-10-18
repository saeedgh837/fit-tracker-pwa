import type { ISODate, Settings } from '../db/types';
const DAY = 86_400_000;
export function today(): ISODate {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function isISODate(value: unknown): value is ISODate {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return (
    Number.isFinite(d.getTime()) &&
    d.toISOString().slice(0, 10) === value &&
    +value.slice(0, 4) >= 1900 &&
    +value.slice(0, 4) <= 2200
  );
}
export function addDays(date: ISODate, amount: number): ISODate {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(from: ISODate, to: ISODate): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY);
}
export function weekday(date: ISODate): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}
export function startOfWeek(date: ISODate, weekStartsOn = 6): ISODate {
  return addDays(date, -((weekday(date) - weekStartsOn + 7) % 7));
}
export function dateRange(start: ISODate, end: ISODate): ISODate[] {
  const count = daysBetween(start, end);
  if (!Number.isFinite(count) || count < 0 || count > 110000) return [];
  return Array.from({ length: count + 1 }, (_, i) => addDays(start, i));
}
export function formatDate(
  date: ISODate,
  settings: Pick<Settings, 'calendar' | 'persianDigits'>,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(
    `fa-IR-u-ca-${settings.calendar}-nu-${settings.persianDigits ? 'arabext' : 'latn'}`,
    { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric', ...options },
  ).format(new Date(`${date}T12:00:00Z`));
}
export function shortDate(
  date: ISODate,
  settings: Pick<Settings, 'calendar' | 'persianDigits'>,
): string {
  return formatDate(date, settings, { year: undefined, month: 'short', day: 'numeric' });
}
