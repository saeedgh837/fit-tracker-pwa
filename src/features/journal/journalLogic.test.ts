import { describe, expect, it } from 'vitest';
import type { DailyLog } from '../../db/types';
import {
  clearJournalPatch,
  createJournalDraft,
  journalDirty,
  reconcileJournalDraft,
  validateJournal,
} from './journalLogic';

const day: DailyLog = {
  date: '2026-10-01',
  waterMl: 1700,
  steps: 4230,
  adherence: 'full',
  restDay: true,
  cheatMeal: true,
  sleepHours: 8,
  mood: 3,
  energy: 4,
  note: 'یادداشت',
};
describe('sparse journal patches', () => {
  it('creates a genuinely empty draft for a missing historical day', () => {
    const draft = createJournalDraft('2026-10-02');
    expect(draft).toMatchObject({
      date: '2026-10-02',
      sleepHours: '',
      mood: '',
      energy: '',
      note: '',
    });
    expect(journalDirty(draft)).toBe(false);
  });
  it('distinguishes zero sleep from null and changes only owned, modified fields', () => {
    const draft = { ...createJournalDraft(day.date, day), sleepHours: '0' };
    expect(validateJournal(draft)).toEqual({ patch: { sleepHours: 0 } });
    expect(validateJournal({ ...createJournalDraft(day.date, day), sleepHours: '' })).toEqual({
      patch: { sleepHours: null },
    });
    expect(clearJournalPatch()).toEqual({ sleepHours: null, mood: null, energy: null, note: '' });
  });
  it.each(['-1', '24.1', 'Infinity', 'NaN'])('rejects invalid sleep %s', (sleepHours) => {
    expect(validateJournal({ ...createJournalDraft(day.date), sleepHours })).toHaveProperty(
      'errors.sleepHours',
    );
  });
  it('accepts inclusive sleep boundaries and integer 1..5 mood/energy, blanks become null', () => {
    expect(
      validateJournal({
        ...createJournalDraft(day.date),
        sleepHours: '24',
        mood: '1',
        energy: '5',
      }),
    ).toEqual({ patch: { sleepHours: 24, mood: 1, energy: 5 } });
    for (const key of ['mood', 'energy'] as const)
      for (const bad of ['0', '6', '2.5', 'NaN'])
        expect(validateJournal({ ...createJournalDraft(day.date), [key]: bad })).toHaveProperty(
          `errors.${key}`,
        );
  });
  it('does not reset or re-date dirty drafts on reactive updates, date changes or in-flight saves', () => {
    const dirty = { ...createJournalDraft(day.date, day), note: 'ثبت‌نشده' };
    expect(journalDirty(dirty)).toBe(true);
    expect(reconcileJournalDraft(dirty, '2026-10-02', undefined, false)).toBe(dirty);
    const clean = createJournalDraft(day.date, day);
    expect(reconcileJournalDraft(clean, '2026-10-02', undefined, true)).toBe(clean);
    expect(reconcileJournalDraft(clean, '2026-10-02', undefined, false).date).toBe('2026-10-02');
    expect(
      reconcileJournalDraft(dirty, day.date, { ...day, waterMl: 9000, energy: 1 }, false),
    ).toBe(dirty);
  });
  it('preserves plain note content rather than interpreting markup', () => {
    expect(
      validateJournal({ ...createJournalDraft(day.date), note: '<script>bad()</script>' }),
    ).toEqual({ patch: { note: '<script>bad()</script>' } });
  });
});
