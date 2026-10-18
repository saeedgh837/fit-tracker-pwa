import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, setHabitValue } from '../../db';
import type { Habit } from '../../db/types';
import { habitAtDate } from '../../lib/calculations';
import { changeHabitArchive, moveHabit, persistHabitDraft } from './actions';

const draft = {
  name: '  مطالعه  ',
  unit: '  صفحه  ',
  target: '10',
  days: [6, 0],
  icon: 'book',
  color: 'teal',
};
const habit = (id: string, order = 0): Habit => ({
  id,
  order,
  name: 'مطالعه',
  unit: 'صفحه',
  target: 8,
  days: [6, 0],
  icon: 'book',
  color: 'teal',
  archived: false,
  createdAt: '2026-10-10',
  updatedFrom: '2026-10-10',
  history: [],
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-18T12:00:00'));
  await db.habitLogs.clear();
  await db.habits.clear();
});
afterEach(() => vi.useRealTimers());

describe('habit persistence through the shared API', () => {
  it('creates a habit effective today rather than the selected historical day', async () => {
    const id = await persistHabitDraft(draft, undefined, '2026-10-18', 4);
    const stored = await db.habits.get(id);
    expect(stored).toMatchObject({
      name: 'مطالعه',
      unit: 'صفحه',
      target: 10,
      days: [6, 0],
      order: 4,
      createdAt: '2026-10-18',
      updatedFrom: '2026-10-18',
      archived: false,
    });
    expect(habitAtDate(stored!, '2026-10-17')).toBeUndefined();
  });

  it('edits through saveHabit while preserving identity and past configuration', async () => {
    const original = habit('read');
    await db.habits.put(original);
    expect(
      await persistHabitDraft(
        { ...draft, name: 'مطالعهٔ بیشتر', target: '20' },
        original,
        '2026-10-18',
        0,
      ),
    ).toBe('read');
    const stored = (await db.habits.get('read'))!;
    expect(stored).toMatchObject({
      id: 'read',
      target: 20,
      createdAt: '2026-10-10',
      updatedFrom: '2026-10-18',
    });
    expect(habitAtDate(stored, '2026-10-17')).toMatchObject({ target: 8, name: 'مطالعه' });
  });

  it('archives and restores effective today without deleting logs or changing ID', async () => {
    await db.habits.put(habit('read'));
    await setHabitValue(habit('read'), '2026-10-11', 8);
    await changeHabitArchive(habit('read'), true, '2026-10-18');
    let stored = (await db.habits.get('read'))!;
    expect(stored.archived).toBe(true);
    expect(habitAtDate(stored, '2026-10-11')?.archived).toBe(false);
    expect(await db.habitLogs.count()).toBe(1);
    vi.setSystemTime(new Date('2026-10-19T12:00:00'));
    await changeHabitArchive(stored, false, '2026-10-19');
    stored = (await db.habits.get('read'))!;
    expect(stored).toMatchObject({ id: 'read', archived: false, updatedFrom: '2026-10-19' });
    expect(habitAtDate(stored, '2026-10-18')?.archived).toBe(true);
    expect(await db.habitLogs.count()).toBe(1);
  });

  it('upserts values for the same habit/day without duplicate logs and preserves the target snapshot', async () => {
    const original = habit('read');
    await db.habits.put(original);
    await setHabitValue(original, '2026-10-11', 6);
    await setHabitValue(original, '2026-10-11', 12);
    expect(await db.habitLogs.toArray()).toEqual([
      expect.objectContaining({ habitId: 'read', date: '2026-10-11', value: 12, target: 8 }),
    ]);
    await persistHabitDraft({ ...draft, target: '20' }, original, '2026-10-18', 0);
    await setHabitValue((await db.habits.get('read'))!, '2026-10-11', 0);
    expect(await db.habitLogs.count()).toBe(1);
    expect((await db.habitLogs.toArray())[0]).toMatchObject({ value: 0, target: 8 });
  });

  it('does not restore a stale order when saving an editor opened before a reorder', async () => {
    const opened = habit('read', 0);
    await db.habits.put(opened);
    await db.habits.update('read', { order: 9 });
    await persistHabitDraft({ ...draft, name: 'مطالعهٔ شبانه' }, opened, '2026-10-18', 0);
    expect((await db.habits.get('read'))?.order).toBe(9);
    expect((await db.habits.get('read'))?.name).toBe('مطالعهٔ شبانه');
  });

  it('archives the latest configuration rather than overwriting it with a stale row', async () => {
    const stale = habit('read');
    await db.habits.put(stale);
    await db.habits.update('read', { target: 30, order: 4 });
    await changeHabitArchive(stale, true, '2026-10-18');
    expect(await db.habits.get('read')).toMatchObject({
      id: 'read',
      target: 30,
      order: 4,
      archived: true,
    });
  });

  it('rejects malformed drafts before the shared persistence boundary', async () => {
    await expect(
      persistHabitDraft({ ...draft, days: [7] }, undefined, '2026-10-18', 0),
    ).rejects.toThrow();
    expect(await db.habits.count()).toBe(0);
  });
});

describe('atomic persisted ordering', () => {
  it('sorts order plus ID ties and changes only order on the adjacent pair', async () => {
    const a = habit('a', 0);
    const b = habit('b', 0);
    const c = habit('c', 10);
    await db.habits.bulkPut([c, b, a]);
    await setHabitValue(a, '2026-10-11', 8);
    const logsBefore = await db.habitLogs.toArray();
    await moveHabit('b', -1);
    const stored = await db.habits.toArray();
    expect(
      stored.sort((x, y) => x.order - y.order || x.id.localeCompare(y.id)).map(({ id }) => id),
    ).toEqual(['b', 'a', 'c']);
    expect(await db.habits.get('a')).toEqual({ ...a, order: 1 });
    expect(await db.habits.get('b')).toEqual(b);
    expect(await db.habits.get('c')).toEqual(c);
    expect(await db.habitLogs.toArray()).toEqual(logsBefore);
  });

  it('rolls back the first order write when the second write fails', async () => {
    const a = habit('a', 1);
    const b = habit('b', 2);
    await db.habits.bulkPut([a, b]);
    const originalUpdate = db.habits.update.bind(db.habits);
    let count = 0;
    const spy = vi
      .spyOn(db.habits, 'update')
      .mockImplementation((...args: Parameters<typeof db.habits.update>) => {
        count += 1;
        if (count === 2) return Dexie.Promise.reject(new Error('disk full'));
        return originalUpdate(...args);
      });
    await expect(moveHabit('b', -1)).rejects.toThrow('disk full');
    spy.mockRestore();
    expect(await db.habits.get('a')).toEqual(a);
    expect(await db.habits.get('b')).toEqual(b);
  });

  it('does not write when moving past a list boundary', async () => {
    await db.habits.put(habit('a', 0));
    const spy = vi.spyOn(db.habits, 'update');
    await moveHabit('a', -1);
    await moveHabit('a', 1);
    expect(spy).not.toHaveBeenCalled();
    expect(await db.habits.get('a')).toEqual(habit('a', 0));
  });
});
