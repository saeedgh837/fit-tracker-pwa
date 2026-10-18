import { useEffect, useId, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Field, IconButton, Modal } from '../../components/ui';
import { db, uid } from '../../db';
import { useData } from '../../hooks/useData';
import { formatDate } from '../../lib/dates';
import { formatNumber } from '../../lib/format';
import { run } from '../../store/ui';
import type { Routine, WorkoutEntry } from '../../db/types';
import {
  buildRoutine,
  buildWorkout,
  intensityNames,
  resolveCalories,
  validateMovement,
  workoutNames,
  type RoutineDraft,
  type SetDraft,
  type WorkoutDraft,
} from './exerciseLogic';

interface Props {
  initial: WorkoutDraft | RoutineDraft;
  kind: 'workout' | 'routine';
  original?: WorkoutEntry | Routine;
  onClose: () => void;
}
export default function MovementEditor({ initial, kind, original, onClose }: Props) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const entryId = useRef<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const errorId = useId();
  const { profile, weights, settings } = useData();
  const unit = draft.inputUnit === 'kg' ? 'کیلوگرم' : 'پوند';
  const isWorkout = kind === 'workout';
  const title = isWorkout
    ? original
      ? 'ویرایش تمرین'
      : 'ثبت تمرین'
    : original
      ? 'ویرایش برنامه'
      : 'برنامه جدید';
  const movement = validateMovement(draft);
  const estimate =
    isWorkout && movement.ok
      ? resolveCalories(
          movement.value,
          (original as WorkoutEntry | undefined)?.date ?? (draft as WorkoutDraft).date,
          weights,
          profile,
          original as WorkoutEntry | undefined,
        )
      : null;
  const n = (value: number, decimals = 0) => formatNumber(value, settings, decimals);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  function update(key: string, value: string) {
    setDraft((previous) => ({ ...previous, [key]: value }));
  }
  function updateRow(index: number, key: keyof SetDraft, value: string) {
    setDraft((previous) => ({
      ...previous,
      exercises: previous.exercises.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [key]: value } : row,
      ),
    }));
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    entryId.current ??= uid();
    const result = isWorkout
      ? buildWorkout(
          draft as WorkoutDraft,
          entryId.current,
          weights,
          profile,
          original as WorkoutEntry | undefined,
        )
      : buildRoutine(draft as RoutineDraft, entryId.current);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    const ok = await run(
      () =>
        isWorkout
          ? db.workouts.put(result.value as WorkoutEntry)
          : db.routines.put(result.value as Routine),
      isWorkout ? 'تمرین ذخیره شد.' : 'برنامه ذخیره شد.',
    );
    lock.current = false;
    setBusy(false);
    if (ok) onClose();
    else setError('اطلاعات ذخیره نشد. پیش‌نویس حفظ شده است؛ دوباره تلاش کنید.');
  }
  return (
    <Modal
      open
      title={title}
      onClose={() => {
        if (!lock.current) onClose();
      }}
    >
      <form
        onSubmit={save}
        noValidate
        aria-busy={busy}
        aria-describedby={error ? errorId : undefined}
      >
        <fieldset disabled={busy} className="exercise-editor stack">
          {isWorkout ? (
            <p className="banner">
              تاریخ این تمرین: {formatDate((draft as WorkoutDraft).date, settings)}
            </p>
          ) : (
            <Field label="نام برنامه">
              <input
                value={(draft as RoutineDraft).name}
                onChange={(event) => update('name', event.target.value)}
                required
                maxLength={120}
                autoFocus
              />
            </Field>
          )}
          <Field label="نوع تمرین">
            <select value={draft.type} onChange={(event) => update('type', event.target.value)}>
              {Object.entries(workoutNames).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="مدت تمرین (دقیقه)">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={draft.duration}
                onChange={(event) => update('duration', event.target.value)}
                required
              />
            </Field>
            <Field label="شدت تمرین">
              <select
                value={draft.intensity}
                onChange={(event) => update('intensity', event.target.value)}
              >
                {Object.entries(intensityNames).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="row exercise-between exercise-wrap">
            <h3>حرکت‌ها، اختیاری</h3>
            <Button
              variant="secondary"
              onClick={() =>
                setDraft((previous) => ({
                  ...previous,
                  exercises: [...previous.exercises, { name: '', sets: '', reps: '', weight: '' }],
                }))
              }
            >
              <Plus size={16} aria-hidden="true" />
              افزودن حرکت
            </Button>
          </div>
          <p className="small muted">
            برای تمرین هوازی، حرکت لازم نیست. در حرکت بدون وزنه، وزنه را صفر وارد کنید. ردیف کاملاً
            خالی ذخیره نمی‌شود.
          </p>
          {draft.exercises.map((row, index) => (
            <div className="exercise-draft-set stack" key={index}>
              <div className="row exercise-set-heading">
                <Field className="exercise-grow" label={`نام حرکت ${n(index + 1)}`}>
                  <input
                    value={row.name}
                    onChange={(event) => updateRow(index, 'name', event.target.value)}
                    maxLength={120}
                  />
                </Field>
                <IconButton
                  label={`حذف حرکت ${n(index + 1)}`}
                  onClick={() =>
                    setDraft((previous) => ({
                      ...previous,
                      exercises: previous.exercises.filter((_, rowIndex) => index !== rowIndex),
                    }))
                  }
                >
                  <Trash2 size={17} aria-hidden="true" />
                </IconButton>
              </div>
              <div className="exercise-set-fields">
                {(
                  [
                    ['sets', `ست ${n(index + 1)}`],
                    ['reps', `تکرار ${n(index + 1)}`],
                    ['weight', `وزنه حرکت ${n(index + 1)} (${unit})`],
                  ] as const
                ).map(([key, label]) => (
                  <Field key={key} label={label}>
                    <input
                      type="number"
                      inputMode={key === 'weight' ? 'decimal' : 'numeric'}
                      min={key === 'weight' ? 0 : 1}
                      step={key === 'weight' ? 'any' : 1}
                      value={row[key]}
                      onChange={(event) => updateRow(index, key, event.target.value)}
                    />
                  </Field>
                ))}
              </div>
            </div>
          ))}
          {draft.inputUnit !== settings.weightUnit && (
            <p className="banner">
              واحد پیش‌نویس تغییر نکرده است؛ وزنه‌ها همچنان با {unit} وارد و هنگام ذخیره به کیلوگرم
              تبدیل می‌شوند.
            </p>
          )}
          {isWorkout && (
            <>
              <Field label="یادداشت تمرین" hint="اختیاری">
                <textarea
                  aria-label="یادداشت تمرین"
                  value={(draft as WorkoutDraft).notes}
                  onChange={(event) => update('notes', event.target.value)}
                  maxLength={10000}
                />
              </Field>
              {estimate ? (
                <div className="exercise-estimate">
                  <p>کالری تخمینی: {n(estimate.calories)} کیلوکالری</p>
                  <p className="small muted">
                    روش <bdi>MET</bdi>؛{' '}
                    {estimate.preserved
                      ? 'برآورد ذخیره‌شده حفظ می‌شود؛ ویرایش یادداشت یا حرکت‌ها آن را تغییر نمی‌دهد.'
                      : `وزن مرجع ${n(estimate.weightKg!, 2)} کیلوگرم از آخرین وزن تا تاریخ تمرین یا وزن آغازین پروفایل.`}
                  </p>
                </div>
              ) : (
                movement.ok && (
                  <p className="banner">
                    برای برآورد کالری، وزن خود را در بخش وزن یا تنظیمات ثبت کنید. وزن ثبت‌شده باید
                    در تاریخ تمرین یا قبل از آن باشد.
                  </p>
                )
              )}
            </>
          )}
          {error && (
            <p
              ref={errorRef}
              tabIndex={-1}
              id={errorId}
              role="alert"
              className="banner exercise-error"
            >
              {error}
            </p>
          )}
          <div className="row exercise-footer">
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              انصراف
            </Button>
            <Button type="submit" disabled={busy || (isWorkout && movement.ok && !estimate)}>
              {busy ? 'در حال ذخیره…' : isWorkout ? 'ذخیره تمرین' : 'ذخیره برنامه'}
            </Button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
