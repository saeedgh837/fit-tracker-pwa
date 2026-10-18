import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppData, Food, MealEntry, Profile, Settings } from '../../db/types';

const fixture = vi.hoisted(() => ({
  profile: undefined as Profile | undefined,
  settings: {} as Settings,
}));

vi.mock('../../hooks/useData', async () => {
  const { useLiveQuery } = await import('dexie-react-hooks');
  const { db } = await import('../../db');
  return {
    useData: (): AppData => {
      const rows = useLiveQuery(async () => ({
        meals: await db.meals.toArray(),
        foods: await db.foods.toArray(),
        days: await db.days.toArray(),
        weights: await db.weights.toArray(),
      }));
      return {
        profile: fixture.profile,
        settings: fixture.settings,
        habits: [],
        habitLogs: [],
        measurements: [],
        workouts: [],
        routines: [],
        meals: [],
        foods: [],
        days: [],
        weights: [],
        ...rows,
      };
    },
  };
});
vi.mock('../../components/DataChart', () => ({
  default: (props: {
    title: string;
    data: Record<string, string | number | null>[];
    goal?: number;
    series: { key: string }[];
  }) => (
    <section aria-label={props.title}>
      <output data-testid={props.title}>{JSON.stringify(props)}</output>
    </section>
  ),
}));

import { db } from '../../db';
import * as database from '../../db';
import { useUI } from '../../store/ui';
import DietPage from './DietPage';

const defaultProfile: Profile = {
  id: 'main',
  name: 'آزمایشی',
  sex: 'male',
  age: 30,
  heightCm: 180,
  startWeightKg: 80,
  goalWeightKg: 75,
  activity: 'sedentary',
  goal: 'maintain',
  weeklyPaceKg: 0.25,
  waterGoalMl: 2000,
  workoutGoal: 3,
  specialCondition: false,
};
const defaultSettings: Settings = {
  id: 'main',
  weightUnit: 'kg',
  heightUnit: 'cm',
  calendar: 'gregory',
  weekStartsOn: 6,
  persianDigits: false,
  theme: 'dark',
  reminders: false,
  reminderHour: 9,
  onboardingComplete: true,
};
const food: Food = {
  id: 'food',
  name: 'نان سنگک',
  calories: 120,
  protein: 4,
  carbs: 22,
  fat: 1,
  favorite: false,
  lastUsedAt: null,
};
const meal: MealEntry = {
  id: 'meal',
  date: '2026-10-18',
  meal: 'breakfast',
  name: 'املت',
  calories: 250,
  protein: 12,
  carbs: 3,
  fat: 20,
  cheat: false,
};

beforeAll(() => {
  // jsdom has no native dialog API. Keep the real shared Modal/Confirm DOM.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});
beforeEach(async () => {
  fixture.profile = { ...defaultProfile };
  fixture.settings = { ...defaultSettings };
  useUI.getState().setDate('2026-10-18');
  await Promise.all([db.meals.clear(), db.foods.clear(), db.days.clear(), db.weights.clear()]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function openMeal(group = 'صبحانه') {
  fireEvent.click(screen.getByRole('button', { name: `افزودن ${group}` }));
  return screen.getByRole('dialog', { name: 'ثبت وعده' });
}
function fillNutrition(dialog: HTMLElement, name = 'برنج', calories = '200') {
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'نام غذا' }), {
    target: { value: name },
  });
  fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'کالری' }), {
    target: { value: calories },
  });
}
function chartProps(title: string): {
  data: Record<string, string | number | null>[];
  goal?: number;
  series: { key: string }[];
} {
  return JSON.parse(screen.getByTestId(title).textContent ?? '{}');
}

describe('diet screen read states and charts', () => {
  it('has an RTL root, four named empty groups, serving explanation and actionable chart empty states', () => {
    render(<DietPage />);
    expect(screen.getByRole('main')).toHaveAttribute('dir', 'rtl');
    for (const name of ['صبحانه', 'ناهار', 'شام', 'میان‌وعده']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: `افزودن ${name}` })).toBeInTheDocument();
    }
    expect(screen.getByText(/هر سهم ذخیره‌شده/)).toBeInTheDocument();
    expect(screen.getAllByText(/هنوز وعده‌ای در این بازه ثبت نشده است/)).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'افزودن 250 میلی‌لیتر آب' })).toBeEnabled();
  });
  it('shows only selected-day meals and passes canonical bounded rows with null missing days to charts', async () => {
    await db.meals.bulkPut([
      meal,
      { ...meal, id: 'past', date: '2026-10-17', name: 'سوپ', calories: 100 },
      { ...meal, id: 'future', date: '2026-10-19', name: 'آینده', calories: 999 },
    ]);
    render(<DietPage />);
    await screen.findByRole('heading', { name: 'املت' });
    expect(screen.queryByRole('heading', { name: 'سوپ' })).not.toBeInTheDocument();
    expect(screen.queryByText('آینده')).not.toBeInTheDocument();
    const daily = chartProps('کالری روزانه در هفت روز گذشته');
    expect(daily.data.map((row) => row.date)).toEqual([
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
      '2026-10-15',
      '2026-10-16',
      '2026-10-17',
      '2026-10-18',
    ]);
    expect(daily.data.map((row) => row.calories)).toEqual([null, null, null, null, null, 100, 250]);
    expect(daily.goal).toBe(2136);
    const weekly = chartProps('کالری هفتگی در هشت هفته گذشته');
    expect(weekly.data.at(-1)).toMatchObject({
      date: '2026-10-17',
      endDate: '2026-10-18',
      calories: 350,
      target: 4272,
      recordedDays: 2,
      elapsedDays: 2,
    });
    expect(screen.getByText(/برآورد بر پایهٔ پروفایل فعلی/)).toBeInTheDocument();
    expect(screen.getByText(/ثبت یک وعده به معنی ثبت کامل روز نیست/)).toBeInTheDocument();
  });
  it.each(['missing', 'special', 'zero-water'] as const)(
    'keeps CRUD and actual intake available when estimate or water goal is unavailable: %s',
    async (kind) => {
      if (kind === 'missing') fixture.profile = undefined;
      if (kind === 'special') fixture.profile = { ...defaultProfile, specialCondition: true };
      if (kind === 'zero-water') fixture.profile = { ...defaultProfile, waterGoalMl: 0 };
      await db.meals.put(meal);
      render(<DietPage />);
      await screen.findByRole('heading', { name: 'املت' });
      expect(screen.getByRole('button', { name: 'افزودن صبحانه' })).toBeEnabled();
      if (kind !== 'zero-water') {
        expect(screen.getByText(/برآورد کالری در دسترس نیست/)).toBeInTheDocument();
        expect(chartProps('کالری روزانه در هفت روز گذشته').goal).toBeUndefined();
        expect(
          chartProps('کالری هفتگی در هشت هفته گذشته').series.map((series) => series.key),
        ).toEqual(['calories']);
      }
      if (kind !== 'special') expect(screen.getByText(/هدف آب تعیین نشده است/)).toBeInTheDocument();
    },
  );
});

describe('meal form and confirmed destructive actions', () => {
  it('creates on a captured historical date even if global date changes while the form is open', async () => {
    useUI.getState().setDate('2026-10-16');
    render(<DietPage />);
    const dialog = openMeal('ناهار');
    expect(within(dialog).getByText(/تاریخ این وعده/)).toBeInTheDocument();
    fillNutrition(dialog, '  برنج  ', '200');
    act(() => useUI.getState().setDate('2026-10-18'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'ذخیره وعده' }));
    await waitFor(async () => expect(await db.meals.count()).toBe(1));
    expect((await db.meals.toArray())[0]).toMatchObject({
      date: '2026-10-16',
      meal: 'lunch',
      name: 'برنج',
      calories: 200,
      protein: 0,
      carbs: 0,
      fat: 0,
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('shows optional gram inputs, allows mismatched macros and preserves identity/date on edit', async () => {
    await db.meals.put({ ...meal, date: '2026-10-17' });
    useUI.getState().setDate('2026-10-17');
    render(<DietPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'ویرایش املت' }));
    const dialog = screen.getByRole('dialog', { name: 'ویرایش وعده' });
    expect(within(dialog).getByText(/درشت‌مغذی‌ها اختیاری‌اند/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'پروتئین (گرم، اختیاری)' }), {
      target: { value: '70' },
    });
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'کالری' }), {
      target: { value: '100' },
    });
    act(() => useUI.getState().setDate('2026-10-18'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'ذخیره وعده' }));
    await waitFor(async () =>
      expect(await db.meals.get('meal')).toMatchObject({
        id: 'meal',
        date: '2026-10-17',
        calories: 100,
        protein: 70,
      }),
    );
    expect(await db.meals.count()).toBe(1);
  });
  it('retains the entered draft and modal after write failure, announces an error, and supports retry', async () => {
    render(<DietPage />);
    const dialog = openMeal();
    fillNutrition(dialog, 'نان', '120');
    vi.spyOn(db.meals, 'put').mockRejectedValueOnce(new Error('disk full'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'ذخیره وعده' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/ذخیره نشد/);
    expect(within(dialog).getByRole('textbox', { name: 'نام غذا' })).toHaveValue('نان');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'ذخیره وعده' }));
    await waitFor(async () => expect(await db.meals.count()).toBe(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('blocks a whitespace name and negative macro with an announced validation error', async () => {
    render(<DietPage />);
    const dialog = openMeal();
    fillNutrition(dialog, '  ', '100');
    fireEvent.submit(within(dialog).getByRole('button', { name: 'ذخیره وعده' }).closest('form')!);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/نام غذا/);
    fillNutrition(dialog, 'نان', '100');
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'چربی (گرم، اختیاری)' }), {
      target: { value: '-1' },
    });
    fireEvent.submit(within(dialog).getByRole('button', { name: 'ذخیره وعده' }).closest('form')!);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/چربی/);
    expect(await db.meals.count()).toBe(0);
  });
  it('cancels deletion without mutation, then confirms only the chosen meal', async () => {
    await db.meals.bulkPut([meal, { ...meal, id: 'past', date: '2026-10-17' }]);
    render(<DietPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'حذف املت' }));
    let dialog = screen.getByRole('dialog', { name: 'حذف وعده' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'انصراف' }));
    expect(await db.meals.count()).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'حذف املت' }));
    dialog = screen.getByRole('dialog', { name: 'حذف وعده' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'تأیید' }));
    await waitFor(async () => expect(await db.meals.get('meal')).toBeUndefined());
    expect(await db.meals.get('past')).toMatchObject({ date: '2026-10-17' });
  });
});

describe('food library interactions', () => {
  it('creates and edits per-serving foods without marking them used, searches and toggles favorites', async () => {
    render(<DietPage />);
    fireEvent.click(screen.getByRole('button', { name: 'افزودن غذای کتابخانه' }));
    let dialog = screen.getByRole('dialog', { name: 'غذای جدید در کتابخانه' });
    fillNutrition(dialog, 'نان سنگک', '120');
    fireEvent.click(within(dialog).getByRole('button', { name: 'ذخیره غذا' }));
    await waitFor(async () => expect(await db.foods.count()).toBe(1));
    fireEvent.click(await screen.findByRole('button', { name: 'علاقه‌مندی نان سنگک' }));
    await waitFor(async () => expect((await db.foods.toArray())[0].favorite).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'علاقه‌مندی‌ها' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'جست‌وجوی غذا' }), {
      target: { value: 'نان' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'ویرایش غذای نان سنگک' }));
    dialog = screen.getByRole('dialog', { name: 'ویرایش غذای کتابخانه' });
    fillNutrition(dialog, 'نان جو', '130');
    fireEvent.click(within(dialog).getByRole('button', { name: 'ذخیره غذا' }));
    await waitFor(async () =>
      expect((await db.foods.toArray())[0]).toMatchObject({
        name: 'نان جو',
        calories: 130,
        favorite: true,
        lastUsedAt: null,
      }),
    );
    fireEvent.change(screen.getByRole('searchbox', { name: 'جست‌وجوی غذا' }), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'اخیراً استفاده‌شده' }));
    expect(screen.getByText(/هنوز از غذای ذخیره‌شده‌ای استفاده نکرده‌اید/)).toBeInTheDocument();
  });
  it('prefills an editable meal from a food, records use, and preserves its snapshot through food deletion', async () => {
    await db.foods.put(food);
    render(<DietPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'ثبت وعده با نان سنگک' }));
    const dialog = screen.getByRole('dialog', { name: 'ثبت وعده' });
    expect(within(dialog).getByRole('textbox', { name: 'نام غذا' })).toHaveValue('نان سنگک');
    fillNutrition(dialog, 'نصف نان', '60');
    fireEvent.click(within(dialog).getByRole('button', { name: 'ذخیره وعده' }));
    await waitFor(async () => expect(await db.meals.count()).toBe(1));
    expect((await db.meals.toArray())[0]).toMatchObject({
      name: 'نصف نان',
      calories: 60,
      foodId: 'food',
    });
    expect((await db.foods.get('food'))?.lastUsedAt).not.toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'حذف غذای نان سنگک' }));
    let confirm = screen.getByRole('dialog', { name: 'حذف غذای کتابخانه' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'انصراف' }));
    expect(await db.foods.get('food')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'حذف غذای نان سنگک' }));
    confirm = screen.getByRole('dialog', { name: 'حذف غذای کتابخانه' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'تأیید' }));
    await waitFor(async () => expect(await db.foods.get('food')).toBeUndefined());
    const savedMeal = (await db.meals.toArray())[0];
    expect(savedMeal).toMatchObject({ name: 'نصف نان', calories: 60 });
    expect(savedMeal).not.toHaveProperty('foodId');
  });
});

describe('acceptance details and accessible feedback', () => {
  it('shows all selected-day group macro totals, including zeros, and reports recorded-day completeness', async () => {
    await db.meals.bulkPut([meal, { ...meal, id: 'past', date: '2026-10-17', name: 'سوپ' }]);
    render(<DietPage />);
    await screen.findByRole('heading', { name: 'املت' });
    const breakfast = screen.getByRole('region', { name: 'صبحانه' });
    expect(within(breakfast).getByText(/پروتئین 12 گرم/)).toBeInTheDocument();
    expect(within(breakfast).getByText(/کربوهیدرات 3 گرم/)).toBeInTheDocument();
    expect(within(breakfast).getByText(/چربی 20 گرم/)).toBeInTheDocument();
    const dinner = screen.getByRole('region', { name: 'شام' });
    expect(within(dinner).getByText(/کربوهیدرات 0 گرم/)).toBeInTheDocument();
    expect(screen.getByText('روزهای دارای ثبت در هفت روز گذشته: 2 از 7')).toBeInTheDocument();
    fireEvent.click(screen.getByText('پوشش ثبت هفتگی', { selector: 'summary' }));
    const completeness = screen.getByRole('table', { name: 'پوشش ثبت هفتگی' });
    expect(within(completeness).getAllByRole('row')).toHaveLength(9);
    expect(within(completeness).getAllByText('2 از 2')).toHaveLength(1);
    expect(screen.getByText(/مجموع درشت‌مغذی‌ها ممکن است ناقص باشد/)).toBeInTheDocument();
  });
  it.each(['daily', 'meal'] as const)(
    'summarizes cheat state from either the explicit daily marker or meal flags: %s',
    async (source) => {
      if (source === 'daily') await database.updateDay('2026-10-18', { cheatMeal: true });
      else await db.meals.put({ ...meal, cheat: true });
      render(<DietPage />);
      await waitFor(() =>
        expect(screen.getByRole('status', { name: 'خلاصهٔ وعدهٔ آزاد' })).toHaveTextContent(
          'این روز دارای وعدهٔ آزاد است.',
        ),
      );
      const dailyButton = screen.getByRole('button', { name: 'علامت روزانهٔ وعدهٔ آزاد' });
      expect(dailyButton).toHaveAttribute('aria-pressed', source === 'daily' ? 'true' : 'false');
    },
  );
  it('labels historical values with the selected date, not today, and isolates a mixed-language food name', async () => {
    useUI.getState().setDate('2026-10-17');
    await db.meals.put({ ...meal, date: '2026-10-17', name: 'Protein نان' });
    render(<DietPage />);
    const heading = await screen.findByRole('heading', { name: 'Protein نان' });
    expect(heading.querySelector('bdi')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'انرژی روز انتخاب‌شده' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'آب روز انتخاب‌شده' })).toBeInTheDocument();
    expect(screen.queryByText('انرژی امروز')).not.toBeInTheDocument();
  });
  it('connects field-specific errors to invalid inputs and focuses the first invalid field', async () => {
    render(<DietPage />);
    const dialog = openMeal();
    fillNutrition(dialog, ' ', '120');
    fireEvent.submit(within(dialog).getByRole('button', { name: 'ذخیره وعده' }).closest('form')!);
    const name = within(dialog).getByRole('textbox', { name: 'نام غذا' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/نام غذا/);
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription(/نام غذا/);
    expect(name).toHaveFocus();
    fillNutrition(dialog, 'نان', '120');
    const fat = within(dialog).getByRole('spinbutton', { name: 'چربی (گرم، اختیاری)' });
    fireEvent.change(fat, { target: { value: '-1' } });
    fireEvent.submit(within(dialog).getByRole('button', { name: 'ذخیره وعده' }).closest('form')!);
    expect(fat).toHaveAttribute('aria-invalid', 'true');
    expect(fat).toHaveAccessibleDescription(/چربی/);
    expect(fat).toHaveFocus();
  });
  it('restores focus to the opener on Escape without writing', async () => {
    render(<DietPage />);
    const opener = screen.getByRole('button', { name: 'افزودن صبحانه' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'ثبت وعده' });
    fireEvent(dialog, new Event('cancel', { bubbles: false, cancelable: true }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
    expect(await db.meals.count()).toBe(0);
  });
  it('keeps a failed destructive confirmation open with retry feedback inside the dialog', async () => {
    await db.meals.put(meal);
    render(<DietPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'حذف املت' }));
    const dialog = screen.getByRole('dialog', { name: 'حذف وعده' });
    vi.spyOn(db.meals, 'delete').mockRejectedValueOnce(new Error('storage failure'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'تأیید' }));
    await within(dialog).findByText(/حذف انجام نشد/);
    expect(await db.meals.get('meal')).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'تأیید' }));
    await waitFor(async () => expect(await db.meals.get('meal')).toBeUndefined());
  });
});

describe('narrow daily updates and water integration', () => {
  it('sets/clears adherence and keeps daily cheat independent of meal flags and unrelated day fields', async () => {
    await db.days.put({
      date: '2026-10-18',
      waterMl: 0,
      steps: 7000,
      sleepHours: 7,
      mood: 4,
      energy: 3,
      note: 'یادداشت',
      adherence: null,
      restDay: true,
      cheatMeal: false,
    });
    await db.meals.put(meal);
    const update = vi.spyOn(database, 'updateDay');
    render(<DietPage />);
    await screen.findByRole('heading', { name: 'املت' });
    fireEvent.click(screen.getByRole('button', { name: 'کامل' }));
    await waitFor(async () => expect((await db.days.get('2026-10-18'))?.adherence).toBe('full'));
    expect(update).toHaveBeenCalledWith('2026-10-18', { adherence: 'full' });
    fireEvent.click(screen.getByRole('button', { name: 'پاک کردن وضعیت پایبندی' }));
    await waitFor(async () => expect((await db.days.get('2026-10-18'))?.adherence).toBeNull());
    expect(update).toHaveBeenCalledWith('2026-10-18', { adherence: null });
    fireEvent.click(screen.getByRole('button', { name: 'علامت وعدهٔ آزاد برای املت' }));
    await waitFor(async () => expect((await db.meals.get('meal'))?.cheat).toBe(true));
    expect((await db.days.get('2026-10-18'))?.cheatMeal).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'علامت روزانهٔ وعدهٔ آزاد' }));
    await waitFor(async () => expect((await db.days.get('2026-10-18'))?.cheatMeal).toBe(true));
    expect(update).toHaveBeenCalledWith('2026-10-18', { cheatMeal: true });
    expect(await db.days.get('2026-10-18')).toMatchObject({
      steps: 7000,
      restDay: true,
      note: 'یادداشت',
      sleepHours: 7,
      mood: 4,
      energy: 3,
    });
  });
  it('uses the real transactional water helper, clamps at zero and preserves unrelated data across rapid successful increments', async () => {
    const water = vi.spyOn(database, 'changeWater');
    render(<DietPage />);
    fireEvent.click(screen.getByRole('button', { name: 'کاهش 500 میلی‌لیتر آب' }));
    await waitFor(async () => expect((await db.days.get('2026-10-18'))?.waterMl).toBe(0));
    expect(water).toHaveBeenCalledWith('2026-10-18', -500);
    const add = screen.getByRole('button', { name: 'افزودن 250 میلی‌لیتر آب' });
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
    fireEvent.click(add);
    await waitFor(async () => expect((await db.days.get('2026-10-18'))?.waterMl).toBe(250));
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
    await waitFor(async () => expect((await db.days.get('2026-10-18'))?.waterMl).toBe(500));
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'افزودن 500 میلی‌لیتر آب' }));
    await waitFor(async () => expect((await db.days.get('2026-10-18'))?.waterMl).toBe(1000));
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'کاهش 250 میلی‌لیتر آب' }));
    await waitFor(async () => expect((await db.days.get('2026-10-18'))?.waterMl).toBe(750));
    expect(water.mock.calls).toEqual([
      ['2026-10-18', -500],
      ['2026-10-18', 250],
      ['2026-10-18', 250],
      ['2026-10-18', 500],
      ['2026-10-18', -250],
    ]);
  });
  it('announces a failed water write and allows retry without fabricating a successful update', async () => {
    vi.spyOn(database, 'changeWater').mockRejectedValueOnce(new Error('water failure'));
    render(<DietPage />);
    const add = screen.getByRole('button', { name: 'افزودن 250 میلی‌لیتر آب' });
    fireEvent.click(add);
    expect(await screen.findByRole('alert')).toHaveTextContent(/آب ثبت نشد/);
    expect(await db.days.get('2026-10-18')).toBeUndefined();
    await waitFor(() => expect(add).toBeEnabled());
    fireEvent.click(add);
    await waitFor(async () => expect((await db.days.get('2026-10-18'))?.waterMl).toBe(250));
  });
});
