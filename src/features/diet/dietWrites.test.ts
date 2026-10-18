import Dexie, { type Table } from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Food, MealEntry } from '../../db/types';

vi.mock('../../db', async () => {
  const { default: Dexie } = await import('dexie');
  const database = new Dexie('diet-write-tests') as Dexie & {
    foods: Table<Food, string>;
    meals: Table<MealEntry, string>;
  };
  database.version(1).stores({ foods: 'id', meals: 'id,date,meal' });
  return { db: database, uid: () => 'generated-id' };
});

import { db } from '../../db';
import {
  deleteFood,
  deleteMeal,
  saveFood,
  saveMeal,
  toggleFavorite,
  toggleMealCheat,
} from './dietWrites';

const serving: Food = {
  id: 'food',
  name: 'نان',
  calories: 120,
  protein: 4,
  carbs: 22,
  fat: 1,
  favorite: false,
  lastUsedAt: null,
};
const entry: MealEntry = {
  id: 'meal',
  date: '2026-10-17',
  meal: 'breakfast',
  name: 'نان',
  calories: 120,
  protein: 4,
  carbs: 22,
  fat: 1,
  cheat: false,
  foodId: 'food',
};
const draft = { name: '  برنج  ', calories: '200', protein: '', carbs: '', fat: '' };

beforeEach(async () => {
  await db.foods.clear();
  await db.meals.clear();
});
afterEach(async () => {
  await db.foods.clear();
  await db.meals.clear();
  vi.useRealTimers();
});

describe('food persistence with real fake IndexedDB tables', () => {
  it('creates a saved serving with numeric optional macros and no use timestamp', async () => {
    await saveFood(draft);
    expect(await db.foods.get('generated-id')).toEqual({
      id: 'generated-id',
      name: 'برنج',
      calories: 200,
      protein: 0,
      carbs: 0,
      fat: 0,
      favorite: false,
      lastUsedAt: null,
    });
  });
  it('edits nutrition while retaining favorite and actual-use timestamp', async () => {
    await db.foods.put({ ...serving, favorite: true, lastUsedAt: '2026-10-16T08:00:00.000Z' });
    await db.meals.put(entry);
    await saveFood({ ...draft, id: 'food' });
    expect(await db.foods.get('food')).toEqual({
      ...serving,
      name: 'برنج',
      calories: 200,
      protein: 0,
      carbs: 0,
      fat: 0,
      favorite: true,
      lastUsedAt: '2026-10-16T08:00:00.000Z',
    });
    expect(await db.meals.get('meal')).toEqual(entry);
  });
  it('toggles favorite without recording use and allows a second toggle', async () => {
    await db.foods.put(serving);
    await toggleFavorite('food');
    expect(await db.foods.get('food')).toMatchObject({ favorite: true, lastUsedAt: null });
    await toggleFavorite('food');
    expect(await db.foods.get('food')).toMatchObject({ favorite: false, lastUsedAt: null });
  });
  it('deletes a food, detaches every linked meal without an assumed index, and preserves snapshots', async () => {
    await db.foods.put(serving);
    await db.meals.bulkPut([
      entry,
      { ...entry, id: 'other-day', date: '2026-10-16' },
      { ...entry, id: 'unlinked', foodId: undefined },
    ]);
    await deleteFood('food');
    expect(await db.foods.get('food')).toBeUndefined();
    const { foodId: removedReference, ...snapshot } = entry;
    void removedReference;
    expect(await db.meals.get('meal')).toEqual(snapshot);
    expect(await db.meals.get('other-day')).toEqual({
      ...snapshot,
      id: 'other-day',
      date: '2026-10-16',
    });
    expect((await db.meals.get('unlinked'))?.calories).toBe(120);
  });
  it('rolls back meal-reference cleanup if the food deletion fails', async () => {
    await db.foods.put(serving);
    await db.meals.put(entry);
    vi.spyOn(db.foods, 'delete').mockRejectedValueOnce(new Error('storage failure'));
    await expect(deleteFood('food')).rejects.toThrow('storage failure');
    expect(await db.foods.get('food')).toEqual(serving);
    expect(await db.meals.get('meal')).toEqual(entry);
  });
  it('rejects invalid food data before writing', async () => {
    await expect(saveFood({ ...draft, calories: '-1' })).rejects.toThrow();
    expect(await db.foods.count()).toBe(0);
  });
});

describe('meal snapshots and CRUD', () => {
  it('saves an editable food snapshot and use timestamp atomically', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-18T09:30:00.000Z'));
    await db.foods.put(serving);
    await saveMeal({
      ...draft,
      date: '2026-10-16',
      meal: 'lunch',
      cheat: true,
      foodId: 'food',
      usedFood: true,
    });
    expect(await db.meals.get('generated-id')).toEqual({
      id: 'generated-id',
      date: '2026-10-16',
      meal: 'lunch',
      name: 'برنج',
      calories: 200,
      protein: 0,
      carbs: 0,
      fat: 0,
      cheat: true,
      foodId: 'food',
    });
    expect((await db.foods.get('food'))?.lastUsedAt).toBe('2026-10-18T09:30:00.000Z');
    expect((await db.foods.get('food'))?.calories).toBe(120);
  });
  it('preserves original identity and historical date during an edit without updating food recency', async () => {
    await db.foods.put(serving);
    await db.meals.put(entry);
    await saveMeal({
      ...draft,
      id: 'meal',
      date: '2026-10-18',
      meal: 'dinner',
      cheat: false,
      foodId: 'food',
    });
    expect(await db.meals.get('meal')).toMatchObject({
      id: 'meal',
      date: '2026-10-17',
      meal: 'dinner',
      calories: 200,
    });
    expect((await db.foods.get('food'))?.lastUsedAt).toBeNull();
    expect(await db.meals.count()).toBe(1);
  });
  it('saves a detached snapshot if the draft food was deleted before save', async () => {
    await saveMeal({
      ...draft,
      date: '2026-10-18',
      meal: 'snack',
      cheat: false,
      foodId: 'deleted-food',
      usedFood: true,
    });
    expect(await db.meals.get('generated-id')).not.toHaveProperty('foodId');
  });
  it('does not write a meal when the related use timestamp fails', async () => {
    await db.foods.put(serving);
    vi.spyOn(db.foods, 'update').mockRejectedValueOnce(new Error('timestamp failure'));
    await expect(
      saveMeal({
        ...draft,
        date: '2026-10-18',
        meal: 'lunch',
        cheat: false,
        foodId: 'food',
        usedFood: true,
      }),
    ).rejects.toThrow('timestamp failure');
    expect(await db.meals.count()).toBe(0);
    expect((await db.foods.get('food'))?.lastUsedAt).toBeNull();
  });
  it('toggles only the meal flag and deletes only the requested historical record', async () => {
    await db.meals.bulkPut([
      entry,
      { ...entry, id: 'second', date: '2026-10-16', foodId: undefined },
    ]);
    await toggleMealCheat('meal');
    expect(await db.meals.get('meal')).toEqual({ ...entry, cheat: true });
    await toggleMealCheat('meal');
    expect((await db.meals.get('meal'))?.cheat).toBe(false);
    await deleteMeal('meal');
    expect(await db.meals.get('meal')).toBeUndefined();
    expect(await db.meals.get('second')).toMatchObject({ date: '2026-10-16', calories: 120 });
  });
  it('rejects impossible calendar dates and invalid nutrition before writes', async () => {
    await expect(
      saveMeal({ ...draft, date: '2026-02-30', meal: 'lunch', cheat: false }),
    ).rejects.toThrow();
    await expect(
      saveMeal({ ...draft, name: ' ', date: '2026-10-18', meal: 'lunch', cheat: false }),
    ).rejects.toThrow();
    expect(await db.meals.count()).toBe(0);
  });
  it('does not resurrect a deleted meal or food from a stale edit draft', async () => {
    await expect(
      saveMeal({ ...draft, id: 'missing', date: '2026-10-18', meal: 'lunch', cheat: false }),
    ).rejects.toThrow();
    await expect(saveFood({ ...draft, id: 'missing' })).rejects.toThrow();
    expect(await db.meals.count()).toBe(0);
    expect(await db.foods.count()).toBe(0);
  });
});
