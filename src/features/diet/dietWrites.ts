import { db, uid } from '../../db';
import { isISODate } from '../../lib/dates';
import type { MealType } from '../../db/types';
import { parseNutritionDraft, type NutritionDraft } from './dietLogic';
export interface FoodDraft extends NutritionDraft {
  id?: string;
}
export interface MealDraft extends NutritionDraft {
  id?: string;
  date: string;
  meal: MealType;
  cheat: boolean;
  foodId?: string;
  usedFood?: boolean;
}
export async function saveFood(draft: FoodDraft): Promise<void> {
  const parsed = parseNutritionDraft(draft);
  if (!parsed.ok) throw new Error(parsed.error);
  await db.transaction('rw', db.foods, async () => {
    const old = draft.id ? await db.foods.get(draft.id) : undefined;
    if (draft.id && !old) throw new Error('غذا دیگر در فهرست نیست.');
    await db.foods.put({
      id: old?.id ?? uid(),
      ...parsed.value,
      favorite: old?.favorite ?? false,
      lastUsedAt: old?.lastUsedAt ?? null,
    });
  });
}
export async function saveMeal(draft: MealDraft): Promise<void> {
  const parsed = parseNutritionDraft(draft);
  if (!parsed.ok) throw new Error(parsed.error);
  if (!isISODate(draft.date)) throw new Error('تاریخ وعده معتبر نیست.');
  await db.transaction('rw', db.foods, db.meals, async () => {
    const old = draft.id ? await db.meals.get(draft.id) : undefined;
    if (draft.id && !old) throw new Error('وعده دیگر وجود ندارد.');
    const food = draft.foodId ? await db.foods.get(draft.foodId) : undefined;
    await db.meals.put({
      id: draft.id ?? uid(),
      date: old?.date ?? draft.date,
      meal: draft.meal,
      cheat: draft.cheat,
      ...parsed.value,
      ...(food ? { foodId: food.id } : {}),
    });
    if (food && draft.usedFood)
      await db.foods.update(food.id, { lastUsedAt: new Date().toISOString() });
  });
}
export async function deleteFood(id: string): Promise<void> {
  await db.transaction('rw', db.foods, db.meals, async () => {
    await db.meals
      .filter((m) => m.foodId === id)
      .modify((m) => {
        delete m.foodId;
      });
    await db.foods.delete(id);
  });
}
export async function deleteMeal(id: string): Promise<void> {
  await db.meals.delete(id);
}
export async function toggleFavorite(id: string): Promise<void> {
  await db.transaction('rw', db.foods, async () => {
    const f = await db.foods.get(id);
    if (f) await db.foods.update(id, { favorite: !f.favorite });
  });
}
export async function toggleMealCheat(id: string): Promise<void> {
  await db.transaction('rw', db.meals, async () => {
    const m = await db.meals.get(id);
    if (m) await db.meals.update(id, { cheat: !m.cheat });
  });
}
