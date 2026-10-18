import { useRef, useState } from 'react';
import {
  Activity,
  Bed,
  Dumbbell,
  Footprints,
  Medal,
  Pencil,
  Play,
  Plus,
  Timer,
  Trash2,
} from 'lucide-react';
import {
  Button,
  Card,
  Confirm,
  EmptyState,
  Field,
  IconButton,
  PageHeader,
  Progress,
  Stat,
} from '../../components/ui';
import DataChart from '../../components/DataChart';
import { useData } from '../../hooks/useData';
import { db, updateDay } from '../../db';
import type { Routine, WorkoutEntry } from '../../db/types';
import { formatDate, shortDate } from '../../lib/dates';
import { formatNumber, fromKg } from '../../lib/format';
import { run, useUI } from '../../store/ui';
import MovementEditor from './MovementEditor';
import {
  createRoutineWorkoutDraft,
  intensityNames,
  personalRecords,
  routineDraft,
  validateCount,
  weeklyProgress,
  weeklySummary,
  workoutDraft,
  workoutNames,
  type RoutineDraft,
  type WorkoutDraft,
} from './exerciseLogic';
import './exercise.css';

type Editor = {
  kind: 'workout' | 'routine';
  draft: WorkoutDraft | RoutineDraft;
  original?: WorkoutEntry | Routine;
};
type Deletion = { kind: 'workout' | 'routine'; id: string; name: string };

export default function ExercisePage() {
  const { date } = useUI();
  const { workouts, routines, days, profile, settings } = useData();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [deleting, setDeleting] = useState<Deletion | null>(null);
  const [stepDrafts, setStepDrafts] = useState<Record<string, string>>({});
  const [goalDraft, setGoalDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const lock = useRef(false);
  const day = days.find((entry) => entry.date === date);
  const selected = workouts.filter((workout) => workout.date === date);
  const summary = weeklySummary(workouts, days, date, settings.weekStartsOn);
  const records = personalRecords(workouts, date);
  const sessions = weeklyProgress(workouts, date, settings.weekStartsOn);
  const n = (value: number, decimals = 0) => formatNumber(value, settings, decimals);
  const unit = settings.weightUnit === 'kg' ? 'کیلوگرم' : 'پوند';
  const goal = goalDraft ?? String(profile?.workoutGoal ?? 0);
  const steps = stepDrafts[date] ?? String(day?.steps ?? 0);

  function openEditor(next: Editor) {
    setError('');
    setStatus('');
    setEditor(next);
  }
  function addWorkout() {
    openEditor({
      kind: 'workout',
      draft: {
        date,
        type: 'walk',
        duration: '30',
        intensity: 'moderate',
        inputUnit: settings.weightUnit,
        notes: '',
        exercises: [],
      },
    });
  }
  function addRoutine() {
    openEditor({
      kind: 'routine',
      draft: {
        name: '',
        type: 'strength',
        duration: '30',
        intensity: 'moderate',
        inputUnit: settings.weightUnit,
        exercises: [],
      },
    });
  }
  function confirmDelete(next: Deletion) {
    setError('');
    setStatus('');
    setDeleting(next);
  }
  async function action(
    write: () => Promise<unknown>,
    message: string,
    failure = 'اطلاعات ذخیره نشد. دوباره تلاش کنید.',
  ) {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError('');
    setStatus('');
    const ok = await run(write, message);
    lock.current = false;
    setBusy(false);
    if (ok) setStatus(message);
    else setError(failure);
    return ok;
  }
  async function saveSteps(event: React.FormEvent) {
    event.preventDefault();
    const result = validateCount(steps);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // A date-indexed draft keeps both days' inputs, but only the selected day is saved.
    const savedDate = date;
    await action(
      () => updateDay(savedDate, { steps: result.value }),
      `قدم‌ها ذخیره شد؛ ${formatDate(savedDate, settings)}.`,
    );
  }
  async function saveGoal(event: React.FormEvent) {
    event.preventDefault();
    if (!profile) {
      setError('ابتدا پروفایل را در تنظیمات تکمیل کنید.');
      return;
    }
    const result = validateCount(goal);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const ok = await action(async () => {
      const updated = await db.profiles.update('main', { workoutGoal: result.value });
      if (updated !== 1) throw new Error('پروفایل وجود ندارد. ابتدا تنظیمات را تکمیل کنید.');
    }, 'هدف هفتگی ذخیره شد.');
    if (ok) setGoalDraft(null);
  }
  async function deleteEntry() {
    if (!deleting) return;
    const target = deleting;
    const ok = await action(
      () =>
        target.kind === 'workout' ? db.workouts.delete(target.id) : db.routines.delete(target.id),
      'حذف انجام شد.',
      'حذف نشد. دوباره تلاش کنید.',
    );
    if (ok) setDeleting(null);
  }

  return (
    <section dir="rtl" lang="fa" aria-label="ورزش و فعالیت" className="exercise-page stack">
      <PageHeader
        title="حرکت، به سبک خودتان"
        subtitle={`تمرین و فعالیت ${formatDate(date, settings)}`}
        action={
          <Button onClick={addWorkout}>
            <Plus size={18} aria-hidden="true" />
            ثبت تمرین
          </Button>
        }
      />
      {error && (
        <p role="alert" className="exercise-error banner">
          {error}
        </p>
      )}
      {status && (
        <p role="status" className="banner">
          {status}
        </p>
      )}

      <div className="exercise-stats">
        <Card>
          <Stat
            icon={Activity}
            label="جلسه‌های این هفته"
            value={n(sessions)}
            detail="تا روز انتخاب‌شده؛ چند جلسه در یک روز جدا شمرده می‌شود."
          />
        </Card>
        <Card>
          <Stat
            icon={Timer}
            label="فعالیت روز انتخاب‌شده"
            value={`${n(selected.reduce((sum, workout) => sum + workout.duration, 0))} دقیقه`}
            detail={`${n(selected.reduce((sum, workout) => sum + workout.calories, 0))} کیلوکالری تخمینی`}
          />
        </Card>
        <Card>
          <Stat
            icon={Medal}
            label="رکوردهای وزنه"
            value={n(records.length)}
            detail="بیشترین وزنه ثبت‌شده برای هر حرکت؛ نه رکورد یک تکرار بیشینه."
          />
        </Card>
      </div>

      <div className="exercise-columns">
        <Card className="stack">
          <h2 className="row">
            <Footprints size={22} aria-hidden="true" />
            قدم‌ها و استراحت
          </h2>
          <p className="small muted">
            مقدار ثبت‌شده: {n(day?.steps ?? 0)} قدم؛ {formatDate(date, settings)}
          </p>
          <form onSubmit={saveSteps} noValidate className="stack" aria-label="ثبت قدم‌های روز">
            <Field label="تعداد قدم‌ها" hint="تعداد صحیح و نامنفی؛ صفر هم قابل ثبت است.">
              <input
                aria-label="تعداد قدم‌ها"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={steps}
                disabled={busy}
                onChange={(event) =>
                  setStepDrafts((previous) => ({ ...previous, [date]: event.target.value }))
                }
              />
            </Field>
            <Button type="submit" variant="secondary" disabled={busy}>
              ذخیره قدم‌ها
            </Button>
          </form>
          <div className="exercise-rest">
            <Button
              variant={day?.restDay ? 'primary' : 'secondary'}
              aria-pressed={day?.restDay ?? false}
              disabled={busy}
              onClick={() =>
                void action(
                  () => updateDay(date, { restDay: !day?.restDay }),
                  day?.restDay ? 'علامت استراحت برداشته شد.' : 'روز استراحت ذخیره شد.',
                )
              }
            >
              <Bed size={18} aria-hidden="true" />
              {day?.restDay ? 'لغو روز استراحت' : 'ثبت روز استراحت'}
            </Button>
            <p className="small muted">روز بدون تمرین، خودکار روز استراحت نیست.</p>
            {day?.restDay && selected.length > 0 && (
              <p className="banner">
                استراحت و تمرین هر دو ثبت شده‌اند؛ جلسه‌ها و حجم تمرین همچنان شمرده می‌شوند.
              </p>
            )}
          </div>
        </Card>
        <Card className="stack">
          <h2>هدف هفتگی ورزش</h2>
          <p className="small muted">
            هدف فعلی پروفایل برای این بازه نمایش داده می‌شود؛ سابقهٔ تغییر هدف در دسترس نیست.
          </p>
          {profile && profile.workoutGoal > 0 ? (
            <>
              <div className="row exercise-between">
                <strong>
                  {n(sessions)} از {n(profile.workoutGoal)} جلسه
                </strong>
                <Dumbbell size={22} aria-hidden="true" />
              </div>
              <Progress value={sessions} max={profile.workoutGoal} label="پیشرفت هدف هفتگی" />
            </>
          ) : (
            profile && <p className="banner">هدف هفتگی غیرفعال است</p>
          )}
          <form onSubmit={saveGoal} noValidate className="stack" aria-label="تنظیم هدف هفتگی">
            <Field label="هدف هفتگی (جلسه)" hint="با ثبت صفر، هدف هفتگی غیرفعال می‌شود.">
              <input
                aria-label="هدف هفتگی (جلسه)"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={goal}
                disabled={busy || !profile}
                onChange={(event) => setGoalDraft(event.target.value)}
              />
            </Field>
            {!profile && <p className="banner">ابتدا پروفایل را در تنظیمات تکمیل کنید.</p>}
            <Button type="submit" variant="secondary" disabled={busy || !profile}>
              ذخیره هدف
            </Button>
          </form>
        </Card>
      </div>

      <Card className="stack">
        <div>
          <h2>تمرین‌های روز</h2>
          <p className="small muted">
            کالری‌ها برآورد روش <bdi>MET</bdi> هستند، نه اندازه‌گیری مستقیم؛ تغییر وزن، برآوردهای
            ذخیره‌شده را بازنویسی نمی‌کند.
          </p>
        </div>
        {selected.length > 0 ? (
          <div>
            {selected.map((workout) => (
              <article key={workout.id} className="list-item exercise-workout">
                <div className="exercise-entry-heading">
                  <div className="row">
                    <span className="tone-icon tone-orange">
                      <Dumbbell size={22} aria-hidden="true" />
                    </span>
                    <div>
                      <h3>{workoutNames[workout.type]}</h3>
                      <p className="muted small">
                        {n(workout.duration)} دقیقه · {n(workout.calories)} کیلوکالری تخمینی
                      </p>
                      <span className="badge">شدت: {intensityNames[workout.intensity]}</span>
                    </div>
                  </div>
                  <div className="row exercise-actions">
                    <IconButton
                      label={`ویرایش ${workoutNames[workout.type]}`}
                      onClick={() =>
                        openEditor({
                          kind: 'workout',
                          draft: workoutDraft(workout, settings.weightUnit),
                          original: workout,
                        })
                      }
                    >
                      <Pencil size={17} aria-hidden="true" />
                    </IconButton>
                    <IconButton
                      label={`حذف ${workoutNames[workout.type]}`}
                      onClick={() =>
                        confirmDelete({
                          kind: 'workout',
                          id: workout.id,
                          name: workoutNames[workout.type],
                        })
                      }
                    >
                      <Trash2 size={17} aria-hidden="true" />
                    </IconButton>
                  </div>
                </div>
                {workout.notes && <p className="exercise-note muted small">{workout.notes}</p>}
                {workout.exercises.length > 0 && (
                  <ul className="exercise-set-list small">
                    {workout.exercises.map((row, index) => (
                      <li key={index}>
                        <bdi>{row.name}</bdi>: {n(row.sets)} ست × {n(row.reps)} تکرار ×{' '}
                        {n(fromKg(row.weightKg, settings.weightUnit), 3)} {unit}
                        {row.weightKg === 0 && <span className="muted"> (بدون وزنه)</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Dumbbell}
            title="هنوز تمرینی ثبت نشده است"
            description="از یک پیاده‌روی کوتاه تا تمرین قدرتی؛ فعالیت این روز را ثبت کنید."
            action={
              <Button variant="secondary" onClick={addWorkout}>
                شروع ثبت تمرین
              </Button>
            }
          />
        )}
      </Card>

      <Card className="stack">
        <div className="row exercise-between exercise-wrap">
          <h2>برنامه‌های آمادهٔ شما</h2>
          <Button variant="secondary" onClick={addRoutine}>
            <Plus size={18} aria-hidden="true" />
            برنامه جدید
          </Button>
        </div>
        {routines.length > 0 ? (
          <div className="exercise-columns">
            {routines.map((routine) => (
              <article key={routine.id} className="exercise-routine stack">
                <h3>
                  <bdi>{routine.name}</bdi>
                </h3>
                <p className="muted small">
                  {workoutNames[routine.type]} · {n(routine.duration)} دقیقه · شدت{' '}
                  {intensityNames[routine.intensity]} · {n(routine.exercises.length)} حرکت
                </p>
                {routine.exercises.length > 0 && (
                  <details>
                    <summary>مشاهدهٔ حرکت‌های برنامه</summary>
                    <ul className="exercise-set-list small">
                      {routine.exercises.map((row, index) => (
                        <li key={index}>
                          <bdi>{row.name}</bdi>: {n(row.sets)} ست × {n(row.reps)} تکرار ×{' '}
                          {n(fromKg(row.weightKg, settings.weightUnit), 3)} {unit}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <div className="row exercise-actions">
                  <Button
                    variant="secondary"
                    className="exercise-use"
                    aria-label={`استفاده از ${routine.name}`}
                    onClick={() =>
                      openEditor({
                        kind: 'workout',
                        draft: createRoutineWorkoutDraft(routine, date, settings.weightUnit),
                      })
                    }
                  >
                    <Play size={16} aria-hidden="true" />
                    استفاده
                  </Button>
                  <IconButton
                    label={`ویرایش برنامه ${routine.name}`}
                    onClick={() =>
                      openEditor({
                        kind: 'routine',
                        draft: routineDraft(routine, settings.weightUnit),
                        original: routine,
                      })
                    }
                  >
                    <Pencil size={17} aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label={`حذف برنامه ${routine.name}`}
                    onClick={() =>
                      confirmDelete({ kind: 'routine', id: routine.id, name: routine.name })
                    }
                  >
                    <Trash2 size={17} aria-hidden="true" />
                  </IconButton>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Activity}
            title="برنامه‌ای ذخیره نشده است"
            description="حرکت‌های تکراری را یک‌بار بسازید. استفاده از برنامه، پیش‌نویسی مستقل و قابل ویرایش باز می‌کند."
          />
        )}
      </Card>

      <Card className="stack">
        <h2 className="row">
          <Medal size={22} aria-hidden="true" />
          رکوردهای شخصی
        </h2>
        <p className="small muted">
          بیشترین وزنه ثبت‌شده تا {formatDate(date, settings)}؛ رکورد مساوی از تازه‌ترین جلسه انتخاب
          می‌شود. حرکت بدون وزنه، رکورد وزنه ندارد.
        </p>
        {records.length > 0 ? (
          <div className="chart-table" tabIndex={0} role="region" aria-label="جدول رکوردهای وزنه">
            <table aria-label="رکوردهای وزنه">
              <thead>
                <tr>
                  <th scope="col">حرکت</th>
                  <th scope="col">بیشترین وزنه</th>
                  <th scope="col">ست و تکرار</th>
                  <th scope="col">تاریخ</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.key}>
                    <th scope="row">
                      <bdi>{record.name}</bdi>
                    </th>
                    <td>
                      {n(fromKg(record.weightKg, settings.weightUnit), 3)} {unit}
                    </td>
                    <td>
                      {n(record.sets)} ست × {n(record.reps)} تکرار
                    </td>
                    <td>{formatDate(record.date, settings)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={Medal}
            title="هنوز رکورد وزنه‌ای ثبت نشده است"
            description="یک حرکت با وزنهٔ بیشتر از صفر ثبت کنید تا رکورد آن اینجا نمایش داده شود."
          />
        )}
      </Card>

      <div className="stack">
        <div>
          <h2>هشت هفتهٔ اخیر تا روز انتخاب‌شده</h2>
          <p className="small muted">
            هفتهٔ آخر تا روز انتخاب‌شده محاسبه می‌شود. فاصله‌های خالی یعنی هیچ روز یا تمرینی ثبت
            نشده است، نه صفر قطعی یا استراحت.
          </p>
        </div>
        <div className="exercise-columns">
          <Card className="stack">
            <h3>حجم تمرین هفتگی</h3>
            <p className="muted small">
              {unit} × تکرار؛ مجموع ست × تکرار × وزنه. حرکت بدون وزنه و تمرین هوازی، حجم وزنهٔ صفر
              دارند.
            </p>
            {summary.some((week) => week.volumeKg !== null) ? (
              <DataChart
                title="حجم تمرین هفتگی"
                data={summary.map((week) => ({
                  week: week.key,
                  label: shortDate(week.start, settings),
                  volume:
                    week.volumeKg === null ? null : fromKg(week.volumeKg, settings.weightUnit),
                }))}
                series={[{ key: 'volume', label: `حجم (${unit} × تکرار)`, type: 'bar' }]}
                valueFormatter={(value) => `${n(value, 1)} ${unit} × تکرار`}
              />
            ) : (
              <EmptyState
                icon={Dumbbell}
                title="داده‌ای برای حجم تمرین ندارید"
                description="پس از ثبت تمرین، حجم هفتگی اینجا نمایش داده می‌شود."
                action={
                  <Button variant="secondary" onClick={addWorkout}>
                    ثبت اولین تمرین
                  </Button>
                }
              />
            )}
          </Card>
          <Card className="stack">
            <h3>روزهای استراحت هفتگی</h3>
            <p className="muted small">
              فقط روزهایی شمرده می‌شوند که علامت استراحت دارند؛ نبودن تمرین به معنی استراحت نیست.
            </p>
            {summary.some((week) => week.restDays !== null) ? (
              <DataChart
                title="روزهای استراحت هفتگی"
                data={summary.map((week) => ({
                  week: week.key,
                  label: shortDate(week.start, settings),
                  restDays: week.restDays,
                }))}
                series={[{ key: 'restDays', label: 'روز استراحت', type: 'bar' }]}
                valueFormatter={(value) => `${n(value)} روز`}
              />
            ) : (
              <EmptyState
                icon={Bed}
                title="استراحتی ثبت نشده است"
                description="برای ثبت روز استراحت، از دکمهٔ بالای صفحه استفاده کنید. روزهای ثبت‌نشده استراحت فرض نمی‌شوند."
              />
            )}
          </Card>
        </div>
        {summary.some((week) => week.loggedDays > 0) && (
          <details className="exercise-coverage">
            <summary>کامل بودن ثبت روزها</summary>
            <p className="small muted">
              صفر یعنی در هفته‌ای دارای سابقه، تمرین وزنه‌ای یا علامت استراحت ثبت نشده است. ثبت ناقص
              روزها می‌تواند حجم واقعی فعالیت را کمتر نشان دهد.
            </p>
            <ul className="exercise-set-list small muted">
              {summary.map((week) => (
                <li key={week.key}>
                  {formatDate(week.start, settings)} تا {formatDate(week.end, settings)}:{' '}
                  {n(week.loggedDays)} از {n(week.calendarDays)} روز دارای سابقه
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {editor && (
        <MovementEditor
          initial={editor.draft}
          kind={editor.kind}
          original={editor.original}
          onClose={() => setEditor(null)}
        />
      )}
      {deleting && (
        <Confirm
          open
          title={deleting.kind === 'workout' ? 'حذف تمرین؟' : 'حذف برنامه؟'}
          description={`«${deleting.name}» حذف شود؟ این کار قابل بازگشت نیست. حذف برنامه، تمرین‌های ثبت‌شدهٔ قبلی را تغییر نمی‌دهد.${error ? ` ${error}` : ''}`}
          danger
          onClose={() => {
            if (!busy) setDeleting(null);
          }}
          onConfirm={() => void deleteEntry()}
        />
      )}
    </section>
  );
}
