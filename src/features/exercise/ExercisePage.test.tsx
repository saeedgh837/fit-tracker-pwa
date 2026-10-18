import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppData, DailyLog, Profile, Routine, WorkoutEntry } from '../../db/types';
import { db } from '../../db';
import { fromKg } from '../../lib/format';
import { metCalories } from '../../lib/calculations';
import ExercisePage from './ExercisePage';

// Only reactive read/date context and the chart renderer are boundary doubles.
// Writes, updateDay, run, unit conversion, MET, and UI primitives are real manager modules.
const state = vi.hoisted(() => ({ data: undefined as AppData | undefined, date: '2026-10-18' }));
vi.mock('../../hooks/useData', () => ({ useData: () => state.data! }));
vi.mock('../../store/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/ui')>();
  return { ...actual, useUI: () => ({ date: state.date }) };
});
vi.mock('../../components/DataChart', () => ({
  default: ({ data, title }: { data: Record<string, string | number | null>[]; title: string }) => (
    <div role="region" aria-label={title} data-rows={JSON.stringify(data)} />
  ),
}));

const profile: Profile = {
  id: 'main',
  name: 'سعید',
  sex: 'male',
  age: 30,
  heightCm: 180,
  startWeightKg: 80,
  goalWeightKg: 75,
  activity: 'moderate',
  goal: 'lose',
  weeklyPaceKg: 0.5,
  waterGoalMl: 2000,
  workoutGoal: 3,
  specialCondition: false,
};
const workout = (patch: Partial<WorkoutEntry> = {}): WorkoutEntry => ({
  id: 'w1',
  date: '2026-10-18',
  type: 'strength',
  duration: 30,
  intensity: 'moderate',
  calories: 180,
  notes: 'یادداشت قبلی',
  exercises: [{ name: 'پرس سینه', sets: 3, reps: 10, weightKg: 20 }],
  ...patch,
});
const routine: Routine = {
  id: 'r1',
  name: 'قدرت پایه',
  type: 'strength',
  duration: 30,
  intensity: 'moderate',
  exercises: [{ name: 'پرس سینه', sets: 3, reps: 10, weightKg: 20 }],
};
const day: DailyLog = {
  date: '2026-10-18',
  waterMl: 1250,
  steps: 1234,
  sleepHours: 7,
  mood: 3,
  energy: 4,
  note: 'حفظ شود',
  adherence: 'full',
  restDay: false,
  cheatMeal: true,
};

beforeAll(() => {
  // jsdom has no dialog top layer; this only supplies native open/close methods.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()));
  state.date = '2026-10-18';
  state.data = {
    profile: { ...profile },
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
  await db.profiles.put(profile);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const change = (name: string | RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(name), { target: { value } });
const submit = (dialogName: string, buttonName: string) =>
  fireEvent.click(
    within(screen.getByRole('dialog', { name: dialogName })).getByRole('button', {
      name: buttonName,
    }),
  );
async function refresh(view: ReturnType<typeof render>) {
  state.data = {
    ...state.data!,
    profile: await db.profiles.get('main'),
    days: await db.days.toArray(),
    workouts: await db.workouts.toArray(),
    routines: await db.routines.toArray(),
  };
  view.rerender(<ExercisePage />);
}
async function seedWorkout(entry = workout()) {
  await db.workouts.put(entry);
  state.data!.workouts = [entry];
}
async function seedRoutine() {
  await db.routines.put(routine);
  state.data!.routines = [structuredClone(routine)];
}

describe('exercise forms and actual fake-IndexedDB writes', () => {
  it('shows saved intensity and localized calorie estimates with the MET method', async () => {
    await seedWorkout(workout({ intensity: 'vigorous' }));
    state.data!.settings.persianDigits = true;
    render(<ExercisePage />);
    expect(screen.getByText(/شدت: شدید/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ثبت تمرین' }));
    expect(screen.getByText(/کالری تخمینی:/)).toHaveTextContent('۱۴۷');
    expect(
      within(screen.getByRole('dialog', { name: 'ثبت تمرین' })).getByText('MET', {
        selector: 'bdi',
      }),
    ).toBeInTheDocument();
  });
  it('uses a danger-styled shared confirmation', async () => {
    await seedWorkout();
    render(<ExercisePage />);
    fireEvent.click(screen.getByRole('button', { name: 'حذف تمرین قدرتی' }));
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'تأیید' })).toHaveClass(
      'btn-danger',
    );
  });
  it('has Persian labels, RTL, actionable empty states, all workout types/intensities', () => {
    render(<ExercisePage />);
    expect(screen.getByRole('region', { name: 'ورزش و فعالیت' })).toHaveAttribute('dir', 'rtl');
    expect(screen.getByText('هنوز تمرینی ثبت نشده است')).toBeInTheDocument();
    expect(screen.getByText('برنامه‌ای ذخیره نشده است')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ثبت تمرین' }));
    expect(screen.getByLabelText('نوع تمرین').querySelectorAll('option')).toHaveLength(8);
    expect(screen.getByLabelText('شدت تمرین').querySelectorAll('option')).toHaveLength(3);
    expect(screen.getByLabelText('مدت تمرین (دقیقه)')).toHaveAttribute('min', '1');
    expect(screen.getByLabelText('مدت تمرین (دقیقه)')).toHaveAttribute('step', '1');
  });
  it('creates on the captured historical day, stores canonical loads and real MET kcal', async () => {
    state.date = '2026-09-01';
    state.data!.weights = [
      { id: 'old', date: '2026-08-31', time: '08:00', weightKg: 72.5, note: '' },
      { id: 'future', date: '2026-10-18', time: '09:00', weightKg: 99, note: '' },
    ];
    const view = render(<ExercisePage />);
    fireEvent.click(screen.getByRole('button', { name: 'ثبت تمرین' }));
    change('نوع تمرین', 'strength');
    change('مدت تمرین (دقیقه)', '25');
    change('شدت تمرین', 'vigorous');
    fireEvent.click(screen.getByRole('button', { name: 'افزودن حرکت' }));
    change('نام حرکت 1', ' پرس سینه ');
    change('ست 1', '3');
    change('تکرار 1', '10');
    change('وزنه حرکت 1 (کیلوگرم)', '20.125');
    change('یادداشت تمرین', 'جلسه قدرت');
    state.date = '2026-10-18';
    view.rerender(<ExercisePage />);
    expect(
      within(screen.getByRole('dialog', { name: 'ثبت تمرین' })).getByText(/تاریخ این تمرین/),
    ).toBeInTheDocument();
    submit('ثبت تمرین', 'ذخیره تمرین');
    await waitFor(async () => expect(await db.workouts.count()).toBe(1));
    const saved = (await db.workouts.toArray())[0];
    expect(saved).toMatchObject({
      date: '2026-09-01',
      type: 'strength',
      duration: 25,
      intensity: 'vigorous',
      notes: 'جلسه قدرت',
      exercises: [{ name: 'پرس سینه', sets: 3, reps: 10, weightKg: 20.125 }],
    });
    expect(saved.calories).toBe(metCalories('strength', 25, 'vigorous', 72.5));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('edits notes/sets without recalculation, preserving original ID/date after date navigation', async () => {
    await seedWorkout();
    state.data!.profile = undefined;
    const view = render(<ExercisePage />);
    fireEvent.click(screen.getByRole('button', { name: 'ویرایش تمرین قدرتی' }));
    change('یادداشت تمرین', 'اصلاح یادداشت');
    change('وزنه حرکت 1 (کیلوگرم)', '21');
    state.date = '2026-11-01';
    view.rerender(<ExercisePage />);
    submit('ویرایش تمرین', 'ذخیره تمرین');
    await waitFor(async () => expect((await db.workouts.get('w1'))?.notes).toBe('اصلاح یادداشت'));
    expect(await db.workouts.count()).toBe(1);
    expect(await db.workouts.get('w1')).toMatchObject({
      date: '2026-10-18',
      calories: 180,
      exercises: [{ weightKg: 21 }],
    });
  });
  it('unavailable bodyweight blocks new/recalculated estimates but allows unaffected saved edits', async () => {
    state.data!.profile = undefined;
    const view = render(<ExercisePage />);
    fireEvent.click(screen.getByRole('button', { name: 'ثبت تمرین' }));
    expect(screen.getByText(/برای برآورد کالری، وزن/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ذخیره تمرین' })).toBeDisabled();
    submit('ثبت تمرین', 'انصراف');
    await seedWorkout();
    view.rerender(<ExercisePage />);
    fireEvent.click(screen.getByRole('button', { name: 'ویرایش تمرین قدرتی' }));
    expect(screen.getByRole('button', { name: 'ذخیره تمرین' })).not.toBeDisabled();
    change('مدت تمرین (دقیقه)', '31');
    expect(screen.getByRole('button', { name: 'ذخیره تمرین' })).toBeDisabled();
  });
  it('retains dirty workout inputs on write failure and supports retry without double submit', async () => {
    const put = vi.spyOn(db.workouts, 'put').mockRejectedValueOnce(new Error('quota'));
    render(<ExercisePage />);
    fireEvent.click(screen.getByRole('button', { name: 'ثبت تمرین' }));
    change('مدت تمرین (دقیقه)', '42');
    change('یادداشت تمرین', 'حفظ پیش‌نویس');
    submit('ثبت تمرین', 'ذخیره تمرین');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('ذخیره نشد'));
    expect(screen.getByLabelText('مدت تمرین (دقیقه)')).toHaveValue(42);
    expect(screen.getByLabelText('یادداشت تمرین')).toHaveValue('حفظ پیش‌نویس');
    const retry = screen.getByRole('button', { name: 'ذخیره تمرین' });
    fireEvent.click(retry);
    fireEvent.click(retry);
    await waitFor(async () => expect(await db.workouts.count()).toBe(1));
    expect(put).toHaveBeenCalledTimes(2);
  });
  it('uses explicit danger confirmation, supports cancel, then deletes and derives PRs again', async () => {
    await seedWorkout();
    const view = render(<ExercisePage />);
    fireEvent.click(screen.getByRole('button', { name: 'حذف تمرین قدرتی' }));
    expect(screen.getByRole('dialog', { name: 'حذف تمرین؟' })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /انصراف/ }));
    expect(await db.workouts.count()).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'حذف تمرین قدرتی' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'تأیید' }));
    await waitFor(async () => expect(await db.workouts.count()).toBe(0));
    await refresh(view);
    expect(screen.getByText('هنوز رکورد وزنه‌ای ثبت نشده است')).toBeInTheDocument();
  });
  it('retains deletion dialog on failure and can retry', async () => {
    await seedWorkout();
    vi.spyOn(db.workouts, 'delete').mockRejectedValueOnce(new Error('locked'));
    render(<ExercisePage />);
    fireEvent.click(screen.getByRole('button', { name: 'حذف تمرین قدرتی' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'تأیید' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('حذف نشد'));
    expect(screen.getByRole('dialog', { name: 'حذف تمرین؟' })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'تأیید' }));
    await waitFor(async () => expect(await db.workouts.count()).toBe(0));
  });
  it('retains draft lb unit on settings switch and converts exactly once on save', async () => {
    state.data!.settings.weightUnit = 'lb';
    const view = render(<ExercisePage />);
    fireEvent.click(screen.getByRole('button', { name: 'ثبت تمرین' }));
    fireEvent.click(screen.getByRole('button', { name: 'افزودن حرکت' }));
    change('نام حرکت 1', 'پرس');
    change('ست 1', '3');
    change('تکرار 1', '10');
    change('وزنه حرکت 1 (پوند)', String(fromKg(20.125, 'lb')));
    state.data = { ...state.data!, settings: { ...state.data!.settings, weightUnit: 'kg' } };
    view.rerender(<ExercisePage />);
    expect(screen.getByLabelText('وزنه حرکت 1 (پوند)')).toBeInTheDocument();
    expect(screen.getByText(/واحد پیش‌نویس تغییر نکرده است/)).toBeInTheDocument();
    submit('ثبت تمرین', 'ذخیره تمرین');
    await waitFor(async () => expect(await db.workouts.count()).toBe(1));
    expect((await db.workouts.toArray())[0].exercises[0].weightKg).toBeCloseTo(20.125, 10);
  });
  it('rejects partial exercise rows and supports removing an invalid row', async () => {
    render(<ExercisePage />);
    fireEvent.click(screen.getByRole('button', { name: 'ثبت تمرین' }));
    fireEvent.click(screen.getByRole('button', { name: 'افزودن حرکت' }));
    change('نام حرکت 1', 'پرس');
    submit('ثبت تمرین', 'ذخیره تمرین');
    expect(screen.getByRole('alert')).toHaveTextContent(/ست/);
    expect(await db.workouts.count()).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'حذف حرکت 1' }));
    submit('ثبت تمرین', 'ذخیره تمرین');
    await waitFor(async () => expect(await db.workouts.count()).toBe(1));
  });
});

describe('routine CRUD and editable deep copies', () => {
  it('creates/edits a routine, opens a draft without saving, then saves an independent workout', async () => {
    const view = render(<ExercisePage />);
    fireEvent.click(screen.getByRole('button', { name: 'برنامه جدید' }));
    change('نام برنامه', 'قدرت پایه');
    change('نوع تمرین', 'strength');
    change('مدت تمرین (دقیقه)', '35');
    fireEvent.click(screen.getByRole('button', { name: 'افزودن حرکت' }));
    change('نام حرکت 1', 'پرس سینه');
    change('ست 1', '3');
    change('تکرار 1', '10');
    change('وزنه حرکت 1 (کیلوگرم)', '20');
    submit('برنامه جدید', 'ذخیره برنامه');
    await waitFor(async () => expect(await db.routines.count()).toBe(1));
    await refresh(view);
    const savedRoutine = (await db.routines.toArray())[0];
    fireEvent.click(screen.getByRole('button', { name: 'استفاده از قدرت پایه' }));
    expect(await db.workouts.count()).toBe(0);
    change('وزنه حرکت 1 (کیلوگرم)', '25');
    submit('ثبت تمرین', 'ذخیره تمرین');
    await waitFor(async () => expect(await db.workouts.count()).toBe(1));
    await refresh(view);
    const savedWorkout = (await db.workouts.toArray())[0];
    expect(savedWorkout.id).not.toBe(savedRoutine.id);
    expect(savedWorkout.exercises[0].weightKg).toBe(25);
    expect((await db.routines.get(savedRoutine.id))?.exercises[0].weightKg).toBe(20);
    expect(savedWorkout).not.toHaveProperty('routineId');
    fireEvent.click(screen.getByRole('button', { name: 'ویرایش برنامه قدرت پایه' }));
    change('نام برنامه', 'قدرت اصلاح‌شده');
    change('وزنه حرکت 1 (کیلوگرم)', '30');
    submit('ویرایش برنامه', 'ذخیره برنامه');
    await waitFor(async () =>
      expect((await db.routines.get(savedRoutine.id))?.name).toBe('قدرت اصلاح‌شده'),
    );
    expect((await db.workouts.get(savedWorkout.id))?.exercises[0].weightKg).toBe(25);
  });
  it('validates names, retains failed routine drafts, and retries', async () => {
    render(<ExercisePage />);
    fireEvent.click(screen.getByRole('button', { name: 'برنامه جدید' }));
    submit('برنامه جدید', 'ذخیره برنامه');
    expect(screen.getByRole('alert')).toHaveTextContent(/نام برنامه/);
    change('نام برنامه', 'برنامه من');
    vi.spyOn(db.routines, 'put').mockRejectedValueOnce(new Error('quota'));
    submit('برنامه جدید', 'ذخیره برنامه');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('ذخیره نشد'));
    expect(screen.getByLabelText('نام برنامه')).toHaveValue('برنامه من');
    submit('برنامه جدید', 'ذخیره برنامه');
    await waitFor(async () => expect(await db.routines.count()).toBe(1));
  });
  it('confirms/cancels routine deletion without removing previous workouts', async () => {
    await seedRoutine();
    await seedWorkout();
    render(<ExercisePage />);
    fireEvent.click(screen.getByRole('button', { name: 'حذف برنامه قدرت پایه' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'حذف برنامه؟' })).getByRole('button', {
        name: /انصراف/,
      }),
    );
    expect(await db.routines.count()).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'حذف برنامه قدرت پایه' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'حذف برنامه؟' })).getByRole('button', {
        name: 'تأیید',
      }),
    );
    await waitFor(async () => expect(await db.routines.count()).toBe(0));
    expect(await db.workouts.count()).toBe(1);
  });
});

describe('steps, explicit rest and global current goal', () => {
  it('saves steps/rest with narrow patches, retains daily fields and coexisting workouts', async () => {
    await db.days.put(day);
    state.data!.days = [day];
    await seedWorkout();
    const view = render(<ExercisePage />);
    change('تعداد قدم‌ها', '8000');
    fireEvent.click(screen.getByRole('button', { name: 'ذخیره قدم‌ها' }));
    await waitFor(async () => expect((await db.days.get(day.date))?.steps).toBe(8000));
    await refresh(view);
    fireEvent.click(screen.getByRole('button', { name: 'ثبت روز استراحت' }));
    await waitFor(async () => expect((await db.days.get(day.date))?.restDay).toBe(true));
    await refresh(view);
    expect(await db.days.get(day.date)).toEqual({ ...day, steps: 8000, restDay: true });
    expect(screen.getByText(/استراحت و تمرین هر دو ثبت شده‌اند/)).toBeInTheDocument();
    expect(await db.workouts.count()).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'لغو روز استراحت' }));
    await waitFor(async () => expect((await db.days.get(day.date))?.restDay).toBe(false));
  });
  it('missing day shows zero rather than implicit rest; invalid and failed steps retain input', async () => {
    render(<ExercisePage />);
    expect(screen.getByLabelText('تعداد قدم‌ها')).toHaveValue(0);
    expect(screen.getByRole('button', { name: 'ثبت روز استراحت' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    change('تعداد قدم‌ها', '-1');
    fireEvent.click(screen.getByRole('button', { name: 'ذخیره قدم‌ها' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/عدد صحیح/);
    change('تعداد قدم‌ها', '9000');
    vi.spyOn(db.days, 'put').mockRejectedValueOnce(new Error('quota'));
    fireEvent.click(screen.getByRole('button', { name: 'ذخیره قدم‌ها' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('ذخیره نشد'));
    expect(screen.getByLabelText('تعداد قدم‌ها')).toHaveValue(9000);
    fireEvent.click(screen.getByRole('button', { name: 'ذخیره قدم‌ها' }));
    await waitFor(async () => expect((await db.days.get(state.date))?.steps).toBe(9000));
  });
  it('updates only workoutGoal, supports zero disable, and counts multiple sessions historically', async () => {
    state.data!.workouts = [
      workout(),
      workout({ id: 'w2' }),
      workout({ id: 'future', date: '2026-10-19' }),
    ];
    const view = render(<ExercisePage />);
    expect(screen.getByText(/هدف فعلی پروفایل/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '67');
    change('هدف هفتگی (جلسه)', '0');
    fireEvent.click(screen.getByRole('button', { name: 'ذخیره هدف' }));
    await waitFor(async () => expect((await db.profiles.get('main'))?.workoutGoal).toBe(0));
    expect(await db.profiles.get('main')).toEqual({ ...profile, workoutGoal: 0 });
    await refresh(view);
    expect(screen.getByText('هدف هفتگی غیرفعال است')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
  it('steps follow selected day while retaining separate dirty drafts across date navigation', async () => {
    await db.days.put(day);
    state.data!.days = [day];
    const view = render(<ExercisePage />);
    change('تعداد قدم‌ها', '8000');
    state.date = '2026-10-17';
    view.rerender(<ExercisePage />);
    expect(screen.getByLabelText('تعداد قدم‌ها')).toHaveValue(0);
    change('تعداد قدم‌ها', '7000');
    fireEvent.click(screen.getByRole('button', { name: 'ذخیره قدم‌ها' }));
    await waitFor(async () => expect((await db.days.get('2026-10-17'))?.steps).toBe(7000));
    expect((await db.days.get('2026-10-18'))?.steps).toBe(1234);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('قدم‌ها ذخیره شد'));
    state.date = '2026-10-18';
    view.rerender(<ExercisePage />);
    expect(screen.getByLabelText('تعداد قدم‌ها')).toHaveValue(8000);
  });
  it('a failed rest write keeps the value unchanged and supports retry', async () => {
    await db.days.put(day);
    state.data!.days = [day];
    const view = render(<ExercisePage />);
    vi.spyOn(db.days, 'put').mockRejectedValueOnce(new Error('quota'));
    fireEvent.click(screen.getByRole('button', { name: 'ثبت روز استراحت' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('ذخیره نشد'));
    expect(screen.getByRole('button', { name: 'ثبت روز استراحت' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    fireEvent.click(screen.getByRole('button', { name: 'ثبت روز استراحت' }));
    await waitFor(async () => expect((await db.days.get(day.date))?.restDay).toBe(true));
    await refresh(view);
    expect(screen.getByRole('button', { name: 'لغو روز استراحت' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
  it('accepts a goal above fourteen and preserves its draft after a failed narrow update', async () => {
    render(<ExercisePage />);
    change('هدف هفتگی (جلسه)', '15');
    vi.spyOn(db.profiles, 'update').mockRejectedValueOnce(new Error('quota'));
    fireEvent.click(screen.getByRole('button', { name: 'ذخیره هدف' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('ذخیره نشد'));
    expect(screen.getByLabelText('هدف هفتگی (جلسه)')).toHaveValue(15);
    fireEvent.click(screen.getByRole('button', { name: 'ذخیره هدف' }));
    await waitFor(async () => expect((await db.profiles.get('main'))?.workoutGoal).toBe(15));
    expect(await db.profiles.get('main')).toEqual({ ...profile, workoutGoal: 15 });
  });
  it('does not report goal success when the profile disappeared before the write', async () => {
    render(<ExercisePage />);
    await db.profiles.clear();
    change('هدف هفتگی (جلسه)', '5');
    fireEvent.click(screen.getByRole('button', { name: 'ذخیره هدف' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('ذخیره نشد'));
    expect(await db.profiles.count()).toBe(0);
    expect(screen.getByLabelText('هدف هفتگی (جلسه)')).toHaveValue(5);
  });
  it('requires a full profile rather than creating a partial one', async () => {
    state.data!.profile = undefined;
    await db.profiles.clear();
    render(<ExercisePage />);
    expect(screen.getByText(/ابتدا پروفایل را در تنظیمات تکمیل کنید/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ذخیره هدف' })).toBeDisabled();
    expect(await db.profiles.count()).toBe(0);
  });
});

describe('chart input and record display boundaries', () => {
  it('feeds eight clipped real-data buckets and converts volume/records once for pounds', async () => {
    await seedWorkout();
    state.data!.settings.weightUnit = 'lb';
    state.data!.days = [
      day,
      { ...day, date: '2026-10-17', restDay: true },
      { ...day, date: '2026-10-19', restDay: true },
    ];
    state.data!.workouts.push(
      workout({
        id: 'future',
        date: '2026-10-19',
        exercises: [{ name: 'پرس سینه', sets: 10, reps: 10, weightKg: 100 }],
      }),
    );
    render(<ExercisePage />);
    const volume = screen.getByRole('region', { name: 'حجم تمرین هفتگی' });
    const rows = JSON.parse(volume.getAttribute('data-rows')!);
    expect(rows).toHaveLength(8);
    expect(rows[7].week).toBe('2026-10-17');
    expect(rows[7].volume).toBeCloseTo(fromKg(600, 'lb'), 8);
    expect(rows[0].volume).toBeNull();
    const restRows = JSON.parse(
      screen.getByRole('region', { name: 'روزهای استراحت هفتگی' }).getAttribute('data-rows')!,
    );
    expect(restRows[7].restDays).toBe(1);
    expect(restRows[0].restDays).toBeNull();
    expect(
      within(screen.getByRole('table', { name: 'رکوردهای وزنه' })).getByRole('cell', {
        name: '44.092 پوند',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/پوند × تکرار/)).toBeInTheDocument();
  });
  it('shows recorded zero rest buckets and explains gaps, rather than pretending missing days are rest', () => {
    state.data!.days = [day];
    render(<ExercisePage />);
    const rows = JSON.parse(
      screen.getByRole('region', { name: 'روزهای استراحت هفتگی' }).getAttribute('data-rows')!,
    );
    expect(rows[7]).toMatchObject({ week: '2026-10-17', restDays: 0 });
    expect(rows[6].restDays).toBeNull();
    expect(screen.getByText(/فاصله‌های خالی/)).toBeInTheDocument();
    expect(screen.getByText(/هفتهٔ آخر تا روز انتخاب‌شده/)).toBeInTheDocument();
  });
  it('does not render synthetic chart rows when everything is empty', () => {
    render(<ExercisePage />);
    expect(screen.queryByRole('region', { name: 'حجم تمرین هفتگی' })).not.toBeInTheDocument();
    expect(screen.getByText('داده‌ای برای حجم تمرین ندارید')).toBeInTheDocument();
    expect(screen.getByText('استراحتی ثبت نشده است')).toBeInTheDocument();
  });
  it('supports keyboard closure and restores focus to the trigger', async () => {
    render(<ExercisePage />);
    const button = screen.getByRole('button', { name: 'ثبت تمرین' });
    button.focus();
    fireEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: 'ثبت تمرین' });
    await act(async () => {
      fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(button).toHaveFocus();
  });
});
