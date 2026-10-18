import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import type { AppData, DailyLog } from '../../db/types';
import JournalPage from './JournalPage';

const state = vi.hoisted(() => ({ date: '2026-10-18', data: {} as AppData }));
vi.mock('../../hooks/useData', () => ({ useData: () => state.data }));
vi.mock('../../store/ui', () => ({
  useUI: () => ({ date: state.date }),
  run: async (action: () => Promise<unknown>) => {
    try {
      await action();
      return true;
    } catch {
      return false;
    }
  },
  toast: vi.fn(),
}));
const day: DailyLog = {
  date: '2026-10-18',
  waterMl: 1700,
  steps: 4200,
  adherence: 'partial',
  restDay: true,
  cheatMeal: true,
  sleepHours: 8,
  mood: 3,
  energy: 4,
  note: 'قدیمی',
};
beforeEach(async () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  await db.days.clear();
  await db.photos.clear();
  state.date = day.date;
  state.data = {
    weights: [],
    measurements: [],
    days: [],
    habits: [],
    habitLogs: [],
    foods: [],
    meals: [],
    workouts: [],
    routines: [],
    profile: undefined,
    settings: {
      id: 'main',
      weightUnit: 'kg',
      heightUnit: 'cm',
      calendar: 'gregory',
      persianDigits: false,
      theme: 'light',
      weekStartsOn: 6,
      reminders: false,
      reminderHour: 9,
      onboardingComplete: true,
    },
  };
});
afterEach(cleanup);
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

describe('journal local persistence and draft safety', () => {
  it('associates validation errors with the invalid journal input, not only the summary', () => {
    render(<JournalPage />);
    fireEvent.change(screen.getByLabelText('خلق‌وخو'), { target: { value: '6' } });
    click('ذخیره ژورنال');
    const mood = screen.getByRole('spinbutton', { name: 'خلق‌وخو' });
    expect(mood).toHaveAttribute('aria-invalid', 'true');
    expect(mood).toHaveAccessibleDescription(
      expect.stringContaining('یک عدد صحیح از ۱ تا ۵ وارد کنید.'),
    );
  });
  it('saves zero sleep, renders text safely, and never changes other daily fields', async () => {
    await db.days.put(day);
    state.data.days = [day];
    render(<JournalPage />);
    fireEvent.change(screen.getByLabelText('ساعت خواب'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('یادداشت روز'), { target: { value: '<b>متن</b>' } });
    click('ذخیره ژورنال');
    await waitFor(async () =>
      expect(await db.days.get(day.date)).toEqual({ ...day, sleepHours: 0, note: '<b>متن</b>' }),
    );
    expect(screen.queryByText('متن', { selector: 'b' })).not.toBeInTheDocument();
  });
  it('clears only the four journal fields after explicit confirmation', async () => {
    await db.days.put(day);
    state.data.days = [day];
    render(<JournalPage />);
    click('پاک کردن ژورنال');
    click('انصراف');
    expect(await db.days.get(day.date)).toEqual(day);
    click('پاک کردن ژورنال');
    click('تأیید');
    await waitFor(async () =>
      expect(await db.days.get(day.date)).toEqual({
        ...day,
        sleepHours: null,
        mood: null,
        energy: null,
        note: '',
      }),
    );
  });
  it('keeps a dirty draft tied to its original day when the selected day changes', async () => {
    const view = render(<JournalPage />);
    fireEvent.change(screen.getByLabelText('یادداشت روز'), { target: { value: 'برای روز قبلی' } });
    state.date = '2026-10-02';
    view.rerender(<JournalPage />);
    expect(screen.getByText(/پیش‌نویس برای/)).toBeInTheDocument();
    expect(screen.getByLabelText('یادداشت روز')).toHaveValue('برای روز قبلی');
    click('ذخیره ژورنال');
    await waitFor(async () =>
      expect((await db.days.get('2026-10-18'))?.note).toBe('برای روز قبلی'),
    );
    expect(await db.days.get('2026-10-02')).toBeUndefined();
    await waitFor(() => expect(screen.getByLabelText('یادداشت روز')).toHaveValue(''));
  });
  it('does not reset a dirty draft on unrelated reactive data changes, and sparse writes preserve concurrent journal changes', async () => {
    await db.days.put(day);
    state.data.days = [day];
    const view = render(<JournalPage />);
    fireEvent.change(screen.getByLabelText('یادداشت روز'), { target: { value: 'جدید' } });
    await db.days.put({ ...day, energy: 1, waterMl: 2500 });
    state.data = { ...state.data, days: [{ ...day, energy: 1, waterMl: 2500 }] };
    view.rerender(<JournalPage />);
    expect(screen.getByLabelText('یادداشت روز')).toHaveValue('جدید');
    click('ذخیره ژورنال');
    await waitFor(async () =>
      expect(await db.days.get(day.date)).toMatchObject({ note: 'جدید', energy: 1, waterMl: 2500 }),
    );
    await waitFor(() => expect(screen.getByLabelText('انرژی')).toHaveValue(1));
  });
  it('blocks repeated save, preserves failed draft and captures the operation date', async () => {
    let fail!: (reason: Error) => void;
    const transaction = vi.spyOn(db, 'transaction').mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }) as never,
    );
    const view = render(<JournalPage />);
    fireEvent.change(screen.getByLabelText('ساعت خواب'), { target: { value: '7.5' } });
    const form = screen.getByLabelText('ساعت خواب').closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(transaction).toHaveBeenCalledOnce();
    state.date = '2026-10-02';
    view.rerender(<JournalPage />);
    await act(async () => {
      fail(new Error('quota'));
    });
    expect(screen.getByLabelText('ساعت خواب')).toHaveValue(7.5);
    expect(screen.getByRole('alert')).toHaveTextContent('ذخیره');
  });
});
