import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import Dexie from 'dexie';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as database from '../../db';
import type { AppData, Habit } from '../../db/types';
import { today } from '../../lib/dates';
import HabitsPage from './HabitsPage';

const state = vi.hoisted(() => ({ date: '2026-10-18', data: undefined as AppData | undefined }));
vi.mock('../../hooks/useData', () => ({ useData: () => state.data }));
vi.mock('../../store/ui', async (original) => {
  const actual = await original<typeof import('../../store/ui')>();
  return { ...actual, useUI: () => ({ date: state.date }) };
});

const habit = (patch: Partial<Habit> = {}): Habit => ({
  id: 'read',
  name: 'مطالعه',
  unit: 'صفحه',
  target: 8,
  days: [0, 6],
  icon: 'book',
  color: 'teal',
  archived: false,
  order: 0,
  createdAt: '2026-10-10',
  updatedFrom: '2026-10-10',
  history: [],
  ...patch,
});
const refresh = async () => {
  state.data = {
    ...state.data!,
    habits: await database.db.habits.toArray(),
    habitLogs: await database.db.habitLogs.toArray(),
  };
};

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');
beforeAll(() => {
  // JSDOM has dialog elements but does not implement the native dialog methods.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    },
  });
});
afterAll(() => {
  if (originalShowModal)
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShowModal);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-18T12:00:00'));
  await database.db.habitLogs.clear();
  await database.db.habits.clear();
  state.date = '2026-10-18';
  state.data = {
    profile: undefined,
    settings: {
      id: 'main',
      weightUnit: 'kg',
      heightUnit: 'cm',
      calendar: 'gregory',
      weekStartsOn: 6,
      persianDigits: false,
      theme: 'light',
      reminders: false,
      reminderHour: 9,
      onboardingComplete: true,
    },
    habits: [],
    habitLogs: [],
    days: [],
    weights: [],
    measurements: [],
    foods: [],
    meals: [],
    workouts: [],
    routines: [],
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function seed(...habits: Habit[]) {
  await database.db.habits.bulkPut(habits);
  await refresh();
}

function editDialog() {
  return screen.getByRole('dialog', { name: 'ویرایش عادت' });
}
function openEdit() {
  fireEvent.click(screen.getByRole('button', { name: 'ویرایش مطالعه' }));
  return editDialog();
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('habit form interactions', () => {
  it('creates a complete habit with accessible icon, color and weekday selections', async () => {
    render(<HabitsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'عادت جدید' }));
    const modal = screen.getByRole('dialog', { name: 'عادت جدید' });
    fireEvent.change(within(modal).getByRole('textbox', { name: 'نام عادت' }), {
      target: { value: '  پیاده‌روی  ' },
    });
    fireEvent.change(within(modal).getByRole('textbox', { name: 'واحد' }), {
      target: { value: 'دقیقه' },
    });
    fireEvent.change(within(modal).getByRole('spinbutton', { name: 'هدف هر روز' }), {
      target: { value: '30' },
    });
    expect(within(modal).getAllByRole('button', { name: /^آیکون / })).toHaveLength(10);
    expect(within(modal).getAllByRole('button', { name: /^رنگ / })).toHaveLength(5);
    fireEvent.click(within(modal).getByRole('button', { name: 'آیکون پیاده‌روی' }));
    fireEvent.click(within(modal).getByRole('button', { name: 'رنگ نارنجی' }));
    expect(within(modal).getByRole('button', { name: 'آیکون پیاده‌روی' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(modal).getByRole('button', { name: 'رنگ نارنجی' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.submit(within(modal).getByRole('form', { name: 'فرم عادت' }));
    await waitFor(async () => expect(await database.db.habits.count()).toBe(1));
    expect((await database.db.habits.toArray())[0]).toMatchObject({
      name: 'پیاده‌روی',
      target: 30,
      icon: 'steps',
      color: 'orange',
      createdAt: today(),
      updatedFrom: today(),
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'عادت جدید' })).not.toBeInTheDocument(),
    );
  });

  it('shows field errors and does not write an invalid form', async () => {
    render(<HabitsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'عادت جدید' }));
    const modal = screen.getByRole('dialog', { name: 'عادت جدید' });
    fireEvent.submit(within(modal).getByRole('form', { name: 'فرم عادت' }));
    expect(within(modal).getByRole('textbox', { name: 'نام عادت' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(within(modal).getAllByRole('alert').length).toBeGreaterThan(0);
    expect(await database.db.habits.count()).toBe(0);
  });

  it('retains unsaved edits across reactive updates and retains identity after save', async () => {
    await seed(habit());
    const view = render(<HabitsPage />);
    const modal = openEdit();
    fireEvent.change(within(modal).getByRole('textbox', { name: 'نام عادت' }), {
      target: { value: 'مطالعهٔ شبانه' },
    });
    await database.setHabitValue(habit(), '2026-10-18', 8);
    await refresh();
    view.rerender(<HabitsPage />);
    expect(within(editDialog()).getByRole('textbox', { name: 'نام عادت' })).toHaveValue(
      'مطالعهٔ شبانه',
    );
    fireEvent.submit(within(editDialog()).getByRole('form', { name: 'فرم عادت' }));
    await waitFor(async () =>
      expect((await database.db.habits.get('read'))?.name).toBe('مطالعهٔ شبانه'),
    );
    expect(await database.db.habits.count()).toBe(1);
  });

  it('retains the draft and dialog after save failure and allows retry', async () => {
    await seed(habit());
    render(<HabitsPage />);
    const modal = openEdit();
    fireEvent.change(within(modal).getByRole('textbox', { name: 'نام عادت' }), {
      target: { value: 'مطالعهٔ شبانه' },
    });
    const spy = vi.spyOn(database.db.habits, 'put').mockRejectedValueOnce(new Error('disk full'));
    fireEvent.submit(within(modal).getByRole('form', { name: 'فرم عادت' }));
    await waitFor(() =>
      expect(within(editDialog()).getByRole('alert')).toHaveTextContent('ذخیره نشد'),
    );
    expect(within(editDialog()).getByRole('textbox', { name: 'نام عادت' })).toHaveValue(
      'مطالعهٔ شبانه',
    );
    spy.mockRestore();
    fireEvent.submit(within(editDialog()).getByRole('form', { name: 'فرم عادت' }));
    await waitFor(async () =>
      expect((await database.db.habits.get('read'))?.name).toBe('مطالعهٔ شبانه'),
    );
  });

  it('blocks duplicate submit and snapshots today before an asynchronous save', async () => {
    await seed(habit());
    const view = render(<HabitsPage />);
    const modal = openEdit();
    const wait = deferred();
    const original = database.db.habits.put.bind(database.db.habits);
    let count = 0;
    const spy = vi
      .spyOn(database.db.habits, 'put')
      .mockImplementation((...args: Parameters<typeof database.db.habits.put>) => {
        count += 1;
        return Dexie.Promise.resolve(Dexie.waitFor(wait.promise)).then(() => original(...args));
      });
    fireEvent.change(within(modal).getByRole('textbox', { name: 'نام عادت' }), {
      target: { value: 'مطالعهٔ شبانه' },
    });
    fireEvent.submit(within(modal).getByRole('form', { name: 'فرم عادت' }));
    fireEvent.submit(within(modal).getByRole('form', { name: 'فرم عادت' }));
    state.date = '2026-10-11';
    view.rerender(<HabitsPage />);
    await act(async () => {
      wait.resolve();
    });
    await waitFor(async () =>
      expect((await database.db.habits.get('read'))?.name).toBe('مطالعهٔ شبانه'),
    );
    expect(count).toBe(1);
    expect((await database.db.habits.get('read'))?.updatedFrom).toBe(today());
    spy.mockRestore();
  });
});

describe('daily values and historical rendering', () => {
  it('distinguishes no habits, no scheduled habits and no archived habits', async () => {
    const view = render(<HabitsPage />);
    expect(screen.getByText('اولین عادت را بسازید')).toBeInTheDocument();
    await seed(habit({ days: [6] }));
    view.rerender(<HabitsPage />);
    expect(screen.getByText('برای این روز عادتی برنامه‌ریزی نشده است')).toBeInTheDocument();
    expect(screen.getByText('عادت بایگانی‌شده‌ای ندارید')).toBeInTheDocument();
  });

  it('shows historical archived habits and displays actual over-target values', async () => {
    const old = habit();
    await seed(old);
    await database.setHabitValue(old, '2026-10-11', 12);
    await database.saveHabit({ ...old, target: 20, archived: true, updatedFrom: '2026-10-18' });
    state.date = '2026-10-11';
    await refresh();
    render(<HabitsPage />);
    const card = screen.getByRole('article', { name: 'ثبت روزانهٔ مطالعه' });
    expect(within(card).getByText('12')).toBeInTheDocument();
    expect(within(card).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
    expect(within(card).getByText('انجام شد')).toBeInTheDocument();
  });

  it('upserts and resets values through the shared API without duplicate records', async () => {
    await seed(habit());
    const view = render(<HabitsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'ثبت مقدار مطالعه' }));
    let modal = screen.getByRole('dialog', { name: 'مقدار مطالعه' });
    fireEvent.change(within(modal).getByRole('spinbutton', { name: 'مقدار انجام‌شده' }), {
      target: { value: '12' },
    });
    fireEvent.submit(within(modal).getByRole('form', { name: 'فرم مقدار روزانه' }));
    await waitFor(async () => expect(await database.db.habitLogs.count()).toBe(1));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'مقدار مطالعه' })).not.toBeInTheDocument(),
    );
    await refresh();
    view.rerender(<HabitsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'اصلاح مقدار مطالعه' }));
    modal = screen.getByRole('dialog', { name: 'مقدار مطالعه' });
    fireEvent.click(within(modal).getByRole('button', { name: 'بازنشانی به صفر' }));
    await waitFor(async () => expect((await database.db.habitLogs.toArray())[0].value).toBe(0));
    expect(await database.db.habitLogs.count()).toBe(1);
  });

  it('keeps an invalid or failed daily value and original date while pending', async () => {
    await seed(habit());
    const view = render(<HabitsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'ثبت مقدار مطالعه' }));
    const modal = screen.getByRole('dialog', { name: 'مقدار مطالعه' });
    const input = within(modal).getByRole('spinbutton', { name: 'مقدار انجام‌شده' });
    fireEvent.change(input, { target: { value: '-1' } });
    fireEvent.submit(within(modal).getByRole('form', { name: 'فرم مقدار روزانه' }));
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(await database.db.habitLogs.count()).toBe(0);
    fireEvent.change(input, { target: { value: '5' } });
    const wait = deferred();
    const original = database.db.habitLogs.put.bind(database.db.habitLogs);
    let count = 0;
    const spy = vi
      .spyOn(database.db.habitLogs, 'put')
      .mockImplementation((...args: Parameters<typeof database.db.habitLogs.put>) => {
        count += 1;
        return Dexie.Promise.resolve(Dexie.waitFor(wait.promise)).then(() => original(...args));
      });
    fireEvent.submit(within(modal).getByRole('form', { name: 'فرم مقدار روزانه' }));
    fireEvent.submit(within(modal).getByRole('form', { name: 'فرم مقدار روزانه' }));
    state.date = '2026-10-11';
    view.rerender(<HabitsPage />);
    await act(async () => {
      wait.resolve();
    });
    await waitFor(async () => expect(await database.db.habitLogs.count()).toBe(1));
    expect(count).toBe(1);
    expect((await database.db.habitLogs.toArray())[0]).toMatchObject({
      habitId: 'read',
      date: '2026-10-18',
      value: 5,
    });
    spy.mockRestore();
  });
});

describe('management actions and heatmap accessibility', () => {
  it('archives and restores without losing the recorded value', async () => {
    await seed(habit());
    await database.setHabitValue(habit(), state.date, 8);
    const view = render(<HabitsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'بایگانی مطالعه' }));
    await waitFor(async () => expect((await database.db.habits.get('read'))?.archived).toBe(true));
    await refresh();
    view.rerender(<HabitsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'بازگردانی مطالعه' }));
    await waitFor(async () => expect((await database.db.habits.get('read'))?.archived).toBe(false));
    expect(await database.db.habitLogs.count()).toBe(1);
  });

  it('canceling delete writes nothing, while confirmed delete removes the habit and logs', async () => {
    await seed(habit());
    await database.setHabitValue(habit(), state.date, 8);
    render(<HabitsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'حذف دائمی مطالعه' }));
    let modal = screen.getByRole('dialog', { name: 'حذف دائمی عادت' });
    expect(within(modal).getByText(/مطالعه.*سوابق/)).toBeInTheDocument();
    fireEvent.click(within(modal).getByRole('button', { name: 'انصراف' }));
    expect(await database.db.habits.count()).toBe(1);
    expect(await database.db.habitLogs.count()).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'حذف دائمی مطالعه' }));
    modal = screen.getByRole('dialog', { name: 'حذف دائمی عادت' });
    fireEvent.click(within(modal).getByRole('button', { name: /تأیید|حذف/ }));
    await waitFor(async () => expect(await database.db.habits.count()).toBe(0));
    expect(await database.db.habitLogs.count()).toBe(0);
  });

  it('keeps the confirmation open on failed deletion', async () => {
    await seed(habit());
    render(<HabitsPage />);
    const spy = vi
      .spyOn(database.db.habits, 'delete')
      .mockRejectedValueOnce(new Error('disk full'));
    fireEvent.click(screen.getByRole('button', { name: 'حذف دائمی مطالعه' }));
    const modal = screen.getByRole('dialog', { name: 'حذف دائمی عادت' });
    fireEvent.click(within(modal).getByRole('button', { name: /تأیید|حذف/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('انجام نشد'));
    expect(screen.getByRole('dialog', { name: 'حذف دائمی عادت' })).toBeInTheDocument();
    expect(await database.db.habits.count()).toBe(1);
    spy.mockRestore();
  });

  it('exposes historical date and ratio for every heatmap cell without hover', async () => {
    await seed(habit());
    await database.setHabitValue(habit(), '2026-10-11', 8);
    await refresh();
    render(<HabitsPage />);
    const heatmap = screen.getByRole('group', { name: 'نقشهٔ انجام عادت‌ها' });
    expect(within(heatmap).getAllByRole('button')).toHaveLength(84);
    expect(within(heatmap).getAllByRole('button', { name: /1 از 1/ }).length).toBe(1);
    expect(within(heatmap).getAllByRole('button', { name: /بدون برنامه/ }).length).toBeGreaterThan(
      0,
    );
    fireEvent.click(within(heatmap).getAllByRole('button', { name: /1 از 1/ })[0]);
    expect(screen.getByRole('status', { name: 'جزئیات روز نقشه' })).toHaveTextContent('1 از 1');
    fireEvent.change(screen.getByRole('combobox', { name: 'نمایش نقشه برای' }), {
      target: { value: 'read' },
    });
    expect(within(heatmap).getAllByRole('button')).toHaveLength(84);
  });
});
