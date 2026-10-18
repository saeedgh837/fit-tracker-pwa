import type { DailyLog } from '../../db/types';
import { isISODate } from '../../lib/dates';

export type JournalFields = Pick<DailyLog, 'sleepHours' | 'mood' | 'energy' | 'note'>;
export type JournalPatch = Partial<JournalFields>;
export interface JournalDraft {
  date: string;
  sleepHours: string;
  mood: string;
  energy: string;
  note: string;
  baseline: JournalFields;
}
export function clearJournalPatch(): JournalFields {
  return { sleepHours: null, mood: null, energy: null, note: '' };
}
export function createJournalDraft(date: string, day?: DailyLog): JournalDraft {
  const baseline: JournalFields = day
    ? { sleepHours: day.sleepHours, mood: day.mood, energy: day.energy, note: day.note }
    : clearJournalPatch();
  return {
    date,
    baseline,
    sleepHours: baseline.sleepHours === null ? '' : String(baseline.sleepHours),
    mood: baseline.mood === null ? '' : String(baseline.mood),
    energy: baseline.energy === null ? '' : String(baseline.energy),
    note: baseline.note,
  };
}
export function journalDirty(draft: JournalDraft): boolean {
  return (
    draft.sleepHours !==
      (draft.baseline.sleepHours === null ? '' : String(draft.baseline.sleepHours)) ||
    draft.mood !== (draft.baseline.mood === null ? '' : String(draft.baseline.mood)) ||
    draft.energy !== (draft.baseline.energy === null ? '' : String(draft.baseline.energy)) ||
    draft.note !== draft.baseline.note
  );
}
export function reconcileJournalDraft(
  draft: JournalDraft,
  selectedDate: string,
  day: DailyLog | undefined,
  busy: boolean,
): JournalDraft {
  return busy || journalDirty(draft) ? draft : createJournalDraft(selectedDate, day);
}
export function validateJournal(
  draft: JournalDraft,
): { patch: JournalPatch; errors?: never } | { errors: Record<string, string>; patch?: never } {
  const errors: Record<string, string> = {};
  const patch: JournalPatch = {};
  if (!isISODate(draft.date)) errors.date = 'تاریخ ژورنال معتبر نیست.';
  for (const key of ['sleepHours', 'mood', 'energy'] as const) {
    const value = draft[key].trim() === '' ? null : Number(draft[key]);
    if (
      value !== null &&
      (!Number.isFinite(value) ||
        (key === 'sleepHours'
          ? value < 0 || value > 24
          : !Number.isInteger(value) || value < 1 || value > 5))
    ) {
      errors[key] =
        key === 'sleepHours'
          ? 'خواب باید از صفر تا ۲۴ ساعت باشد.'
          : 'یک عدد صحیح از ۱ تا ۵ وارد کنید.';
    } else if (value !== draft.baseline[key]) patch[key] = value;
  }
  if (draft.note !== draft.baseline.note) patch.note = draft.note;
  return Object.keys(errors).length ? { errors } : { patch };
}
