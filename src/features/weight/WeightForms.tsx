import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Field, Modal } from '../../components/ui';
import { db, uid } from '../../db';
import { run } from '../../store/ui';
import {
  measurementFields,
  validateMeasurement,
  validateWeight,
  type MeasurementDraft,
  type WeightDraft,
} from './weightLogic';

function FormErrors({ errors, prefix }: { errors: Record<string, string>; prefix: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (Object.keys(errors).length) ref.current?.focus();
  }, [errors]);
  if (!Object.keys(errors).length) return null;
  return (
    <div
      ref={ref}
      role="alert"
      tabIndex={-1}
      className="banner"
      style={{ borderColor: 'var(--danger)' }}
    >
      <p className="font-semibold">ثبت انجام نشد</p>
      <ul className="m-0 list-disc ps-5">
        {Object.entries(errors).map(([key, message]) => (
          <li key={key}>
            {['form', 'save'].includes(key) ? (
              message
            ) : (
              <a className="underline" href={`#${prefix}-${key}`}>
                {message}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
function InlineError({ message, id }: { message?: string; id: string }) {
  return message ? (
    <span id={id} className="small" style={{ color: 'var(--danger)' }}>
      {message}
    </span>
  ) : null;
}

export function WeightEditor({
  initial,
  onClose,
  onSaved,
}: {
  initial: WeightDraft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const unit = draft.unit === 'kg' ? 'کیلوگرم' : 'پوند';
  function change(key: keyof WeightDraft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    const result = validateWeight(draft, uid());
    if (result.errors) {
      setErrors(result.errors);
      return;
    }
    const entry = result.value;
    lock.current = true;
    setBusy(true);
    setErrors({});
    const ok = await run(() => db.weights.put(entry), 'وزن ذخیره شد.');
    lock.current = false;
    setBusy(false);
    if (ok) onSaved();
    else setErrors({ save: 'ذخیره وزن انجام نشد. اطلاعات فرم حفظ شده است؛ دوباره تلاش کنید.' });
  }
  return (
    <Modal
      open
      onClose={() => {
        if (!lock.current) onClose();
      }}
      title={draft.id ? 'ویرایش وزن' : 'ثبت وزن'}
    >
      <form onSubmit={save} noValidate className="stack" aria-busy={busy}>
        <FormErrors errors={errors} prefix="weight" />
        <p className="muted small">
          واحد این فرم تا پایان ثبت، {unit} است. تغییر تنظیمات، عدد واردشده را تغییر نمی‌دهد.
        </p>
        <fieldset disabled={busy} className="m-0 grid gap-4 border-0 p-0">
          <div className="form-grid">
            <Field label="تاریخ ثبت وزن">
              <input
                aria-label="تاریخ ثبت وزن"
                id="weight-date"
                type="date"
                value={draft.date}
                onChange={(e) => change('date', e.target.value)}
                aria-invalid={Boolean(errors.date)}
                aria-describedby={errors.date ? 'weight-date-error' : undefined}
              />
              <InlineError id="weight-date-error" message={errors.date} />
            </Field>
            <Field label="زمان ثبت وزن">
              <input
                aria-label="زمان ثبت وزن"
                id="weight-time"
                type="time"
                step={60}
                value={draft.time}
                onChange={(e) => change('time', e.target.value)}
                aria-invalid={Boolean(errors.time)}
                aria-describedby={errors.time ? 'weight-time-error' : undefined}
              />
              <InlineError id="weight-time-error" message={errors.time} />
            </Field>
          </div>
          <Field label={`وزن (${unit})`}>
            <input
              aria-label={`وزن (${unit})`}
              id="weight-weight"
              type="number"
              inputMode="decimal"
              min={0.001}
              step="any"
              required
              value={draft.weight}
              onChange={(e) => change('weight', e.target.value)}
              aria-invalid={Boolean(errors.weight)}
              aria-describedby={errors.weight ? 'weight-weight-error' : undefined}
            />
            <InlineError id="weight-weight-error" message={errors.weight} />
          </Field>
          <Field label="یادداشت وزن" hint="اختیاری؛ مثلاً شرایط وزن‌کشی">
            <textarea value={draft.note} onChange={(e) => change('note', e.target.value)} />
          </Field>
        </fieldset>
        <div className="row flex-wrap">
          <Button type="submit" disabled={busy}>
            {busy ? 'در حال ذخیره…' : 'ذخیره وزن'}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            انصراف
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function MeasurementEditor({
  initial,
  onClose,
  onSaved,
}: {
  initial: MeasurementDraft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const unit = draft.unit === 'cm' ? 'سانتی‌متر' : 'اینچ';
  async function save(event: FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    const result = validateMeasurement(draft, uid());
    if (result.errors) {
      setErrors(result.errors);
      return;
    }
    const entry = result.value;
    lock.current = true;
    setBusy(true);
    setErrors({});
    // Full replacement intentionally removes fields cleared in an edit, without changing the ID.
    const ok = await run(() => db.measurements.put(entry), 'اندازه‌های بدن ذخیره شد.');
    lock.current = false;
    setBusy(false);
    if (ok) onSaved();
    else
      setErrors({ save: 'ذخیره اندازه‌ها انجام نشد. اطلاعات فرم حفظ شده است؛ دوباره تلاش کنید.' });
  }
  return (
    <Modal
      open
      onClose={() => {
        if (!lock.current) onClose();
      }}
      title={draft.id ? 'ویرایش اندازه‌های بدن' : 'ثبت اندازه‌های بدن'}
    >
      <form onSubmit={save} noValidate className="stack" aria-busy={busy}>
        <FormErrors errors={errors} prefix="measurement" />
        <p className="muted small">
          حداقل یک اندازه وارد کنید. فیلد خالی ثبت نمی‌شود. واحد ثابت این فرم: {unit}.
        </p>
        <fieldset disabled={busy} className="m-0 grid gap-4 border-0 p-0">
          <Field label="تاریخ اندازه‌گیری">
            <input
              aria-label="تاریخ اندازه‌گیری"
              id="measurement-date"
              type="date"
              value={draft.date}
              onChange={(e) => setDraft((current) => ({ ...current, date: e.target.value }))}
              aria-invalid={Boolean(errors.date)}
              aria-describedby={errors.date ? 'measurement-date-error' : undefined}
            />
            <InlineError id="measurement-date-error" message={errors.date} />
          </Field>
          <div className="form-grid">
            {measurementFields.map(({ key, label }) => (
              <Field key={key} label={`${label} (${unit})`}>
                <input
                  aria-label={`${label} (${unit})`}
                  id={`measurement-${key}`}
                  type="number"
                  inputMode="decimal"
                  min={0.001}
                  step="any"
                  value={draft[key]}
                  onChange={(e) => setDraft((current) => ({ ...current, [key]: e.target.value }))}
                  aria-invalid={Boolean(errors[key])}
                  aria-describedby={errors[key] ? `measurement-${key}-error` : undefined}
                />
                <InlineError id={`measurement-${key}-error`} message={errors[key]} />
              </Field>
            ))}
          </div>
        </fieldset>
        <div className="row flex-wrap">
          <Button type="submit" disabled={busy}>
            {busy ? 'در حال ذخیره…' : 'ذخیره اندازه‌ها'}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            انصراف
          </Button>
        </div>
      </form>
    </Modal>
  );
}
