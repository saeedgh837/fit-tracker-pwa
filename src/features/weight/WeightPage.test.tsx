import Dexie from 'dexie';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import type { AppData } from '../../db/types';
import WeightPage from './WeightPage';

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
vi.mock('../../components/DataChart', () => ({
  default: ({ title }: { title: string }) => <div aria-label={title} />,
}));

beforeEach(async () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  await db.weights.clear();
  await db.measurements.clear();
  state.date = '2026-10-18';
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
const click = (name: string) => fireEvent.click(screen.getAllByRole('button', { name })[0]);

describe('weight and measurement user flows', () => {
  it('keeps invalid controls clearly named and connects inline error text for correction', () => {
    render(<WeightPage />);
    click('ثبت وزن');
    click('ذخیره وزن');
    const input = screen.getByRole('spinbutton', { name: 'وزن (کیلوگرم)' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('وزن باید یک عدد مثبت و معتبر باشد.');
    fireEvent.change(input, { target: { value: '80' } });
    expect(input).toHaveValue(80);
  });
  it('saves a selected historical date and keeps multiple entries, editing the same ID', async () => {
    state.date = '2026-10-01';
    const first = { id: 'old', date: state.date, time: '08:00', weightKg: 80, note: 'قبلی' };
    await db.weights.put(first);
    state.data.weights = [first];
    const view = render(<WeightPage />);
    click('ثبت وزن');
    expect(screen.getByLabelText('تاریخ ثبت وزن')).toHaveValue('2026-10-01');
    fireEvent.change(screen.getByLabelText('وزن (کیلوگرم)'), { target: { value: '79' } });
    click('ذخیره وزن');
    await waitFor(async () => expect(await db.weights.count()).toBe(2));
    state.data = { ...state.data, weights: await db.weights.toArray() };
    view.rerender(<WeightPage />);
    click('ویرایش وزن 08:00');
    fireEvent.change(screen.getByLabelText('وزن (کیلوگرم)'), { target: { value: '78' } });
    click('ذخیره وزن');
    await waitFor(async () => expect((await db.weights.get('old'))?.weightKg).toBe(78));
    expect(await db.weights.count()).toBe(2);
  });
  it('does not reinterpret a dirty weight when units or selected date change', async () => {
    const view = render(<WeightPage />);
    click('ثبت وزن');
    fireEvent.change(screen.getByLabelText('وزن (کیلوگرم)'), { target: { value: '80' } });
    state.data = { ...state.data, settings: { ...state.data.settings, weightUnit: 'lb' } };
    state.date = '2026-10-02';
    view.rerender(<WeightPage />);
    expect(screen.getByLabelText('وزن (کیلوگرم)')).toHaveValue(80);
    expect(screen.getByLabelText('تاریخ ثبت وزن')).toHaveValue('2026-10-18');
    click('ذخیره وزن');
    await waitFor(async () =>
      expect((await db.weights.toArray())[0]).toMatchObject({ weightKg: 80, date: '2026-10-18' }),
    );
  });
  it('confirms deletion and targets only the chosen record', async () => {
    const a = { id: 'a', date: state.date, time: '08:00', weightKg: 80, note: '' },
      b = { ...a, id: 'b', time: '09:00' };
    await db.weights.bulkPut([a, b]);
    state.data.weights = [a, b];
    render(<WeightPage />);
    click('حذف وزن 08:00');
    click('انصراف');
    expect(await db.weights.count()).toBe(2);
    click('حذف وزن 08:00');
    click('تأیید');
    await waitFor(async () => expect(await db.weights.get('a')).toBeUndefined());
    expect(await db.weights.get('b')).toBeDefined();
  });
  it('keeps failed-save data and blocks duplicate submission while pending', async () => {
    let reject!: (reason: Error) => void;
    const put = vi.spyOn(db.weights, 'put').mockImplementationOnce(
      () =>
        new Dexie.Promise<string>((_resolve, fail) => {
          reject = fail;
        }),
    );
    render(<WeightPage />);
    click('ثبت وزن');
    fireEvent.change(screen.getByLabelText('وزن (کیلوگرم)'), { target: { value: '81' } });
    const form = screen.getByLabelText('وزن (کیلوگرم)').closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(put).toHaveBeenCalledOnce();
    await act(async () => {
      reject(new Error('quota'));
    });
    expect(screen.getByLabelText('وزن (کیلوگرم)')).toHaveValue(81);
    expect(screen.getByRole('alert')).toHaveTextContent('ذخیره');
  });
  it('edits all five measurements and truly deletes a cleared field while preserving same-day siblings', async () => {
    const original = {
      id: 'm1',
      date: state.date,
      waist: 80,
      chest: 100,
      hip: 95,
      arm: 30,
      thigh: 55,
    };
    await db.measurements.bulkPut([original, { id: 'm2', date: state.date, waist: 82 }]);
    state.data.measurements = await db.measurements.toArray();
    render(<WeightPage />);
    click('ویرایش اندازه‌های ثبت 1');
    fireEvent.change(screen.getByLabelText('دور سینه (سانتی‌متر)'), { target: { value: '' } });
    click('ذخیره اندازه‌ها');
    await waitFor(async () => expect(await db.measurements.get('m1')).not.toHaveProperty('chest'));
    expect(await db.measurements.count()).toBe(2);
    const table = screen.getByRole('table', { name: 'سوابق اندازه‌های بدن' });
    expect(within(table).getAllByRole('row')).toHaveLength(3);
  });
});
