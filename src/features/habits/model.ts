import type { Habit, HabitColor, HabitIcon } from '../../db/types';

export interface HabitDraft {
  name: string;
  unit: string;
  target: string;
  days: number[];
  icon: string;
  color: string;
}
export type HabitErrors = Partial<Record<keyof HabitDraft, string>>;
export type HabitValidation =
  | {
      valid: true;
      config: {
        name: string;
        unit: string;
        target: number;
        days: number[];
        icon: HabitIcon;
        color: HabitColor;
      };
    }
  | { valid: false; errors: HabitErrors };

export const habitIcons: { value: HabitIcon; label: string }[] = [
  { value: 'water', label: 'آب' },
  { value: 'food', label: 'تغذیه' },
  { value: 'workout', label: 'ورزش' },
  { value: 'sleep', label: 'خواب' },
  { value: 'steps', label: 'پیاده‌روی' },
  { value: 'vitamin', label: 'ویتامین' },
  { value: 'sugar', label: 'قند' },
  { value: 'heart', label: 'سلامت' },
  { value: 'book', label: 'مطالعه' },
  { value: 'sun', label: 'آفتاب' },
];
export const habitColors: { value: HabitColor; label: string }[] = [
  { value: 'teal', label: 'سبزآبی' },
  { value: 'blue', label: 'آبی' },
  { value: 'orange', label: 'نارنجی' },
  { value: 'violet', label: 'بنفش' },
  { value: 'rose', label: 'صورتی' },
];
const weekdayLabels = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];

export function orderedWeekdays(start: number): { value: number; label: string }[] {
  const first = Number.isInteger(start) && start >= 0 && start <= 6 ? start : 6;
  return Array.from({ length: 7 }, (_, index) => {
    const value = (first + index) % 7;
    return { value, label: weekdayLabels[value] };
  });
}

export function compareHabits(a: Habit, b: Habit): number {
  return a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function validateHabitDraft(draft: HabitDraft): HabitValidation {
  const errors: HabitErrors = {};
  const name = draft.name.trim();
  const unit = draft.unit.trim();
  const target = Number(draft.target);
  if (!name) errors.name = 'نام عادت را وارد کنید.';
  if (!unit) errors.unit = 'واحد اندازه‌گیری را وارد کنید.';
  if (!draft.target.trim() || !Number.isFinite(target) || target <= 0)
    errors.target = 'هدف باید عددی بزرگ‌تر از صفر باشد.';
  if (
    !draft.days.length ||
    draft.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6) ||
    new Set(draft.days).size !== draft.days.length
  ) {
    errors.days = 'حداقل یک روز معتبر و بدون تکرار انتخاب کنید.';
  }
  if (!habitIcons.some(({ value }) => value === draft.icon))
    errors.icon = 'یک آیکون معتبر انتخاب کنید.';
  if (!habitColors.some(({ value }) => value === draft.color))
    errors.color = 'یک رنگ معتبر انتخاب کنید.';
  if (Object.keys(errors).length) return { valid: false, errors };
  return {
    valid: true,
    config: {
      name,
      unit,
      target,
      days: [...draft.days],
      icon: draft.icon as HabitIcon,
      color: draft.color as HabitColor,
    },
  };
}

export function validateHabitValue(
  raw: string,
): { valid: true; value: number } | { valid: false; error: string } {
  const value = Number(raw);
  if (!raw.trim() || !Number.isFinite(value) || value < 0)
    return { valid: false, error: 'مقدار باید عددی نامنفی باشد.' };
  return { valid: true, value };
}
