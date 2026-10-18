import { db, saveHabit, uid } from '../../db';
import type { Habit } from '../../db/types';
import { compareHabits, validateHabitDraft } from './model';
import type { HabitDraft } from './model';

export async function persistHabitDraft(
  draft: HabitDraft,
  existing: Habit | undefined,
  effectiveDate: string,
  order: number,
): Promise<string> {
  const result = validateHabitDraft(draft);
  if (!result.valid) throw new Error(Object.values(result.errors).join(' '));
  return db.transaction('rw', db.habits, async () => {
    const latest = existing ? await db.habits.get(existing.id) : undefined;
    if (existing && !latest) throw new Error('این عادت حذف شده است. صفحه را دوباره بررسی کنید.');
    // Re-read the non-draft fields so a concurrent reorder or archive is not undone.
    // The shared API alone creates and merges revisions.
    const base: Habit = latest ?? {
      id: uid(),
      order,
      createdAt: effectiveDate,
      updatedFrom: effectiveDate,
      history: [],
      archived: false,
      ...result.config,
    };
    const habit: Habit = { ...base, ...result.config, updatedFrom: effectiveDate };
    await saveHabit(habit);
    return habit.id;
  });
}

export async function changeHabitArchive(
  habit: Habit,
  archived: boolean,
  effectiveDate: string,
): Promise<void> {
  await db.transaction('rw', db.habits, async () => {
    const latest = await db.habits.get(habit.id);
    if (!latest) throw new Error('این عادت حذف شده است. صفحه را دوباره بررسی کنید.');
    await saveHabit({ ...latest, archived, updatedFrom: effectiveDate });
  });
}

export async function moveHabit(id: string, direction: -1 | 1): Promise<void> {
  await db.transaction('rw', db.habits, async () => {
    const all = await db.habits.toArray();
    const current = all.find((habit) => habit.id === id);
    if (!current) return;
    const ordered = all.filter((habit) => habit.archived === current.archived).sort(compareHabits);
    const index = ordered.findIndex((habit) => habit.id === id);
    const neighbor = index + direction;
    if (neighbor < 0 || neighbor >= ordered.length) return;
    // Keep existing slots, resolving equal order values deterministically. Only
    // order is updated; no configuration, revision or log is rewritten.
    const slots = ordered.map((habit) => habit.order);
    [ordered[index], ordered[neighbor]] = [ordered[neighbor], ordered[index]];
    let previous = -Infinity;
    for (let position = 0; position < ordered.length; position += 1) {
      const next = Math.max(slots[position], previous + 1);
      previous = next;
      if (ordered[position].order !== next) {
        await db.habits.update(ordered[position].id, { order: next });
      }
    }
  });
}
