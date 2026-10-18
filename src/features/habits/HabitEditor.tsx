import { useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { CalendarDays, Check, LoaderCircle, Save } from 'lucide-react';
import type { Habit, HabitColor, HabitIcon, Settings } from '../../db/types';
import { Button, Field, Modal } from '../../components/ui';
import { formatDate, today } from '../../lib/dates';
import { run } from '../../store/ui';
import { persistHabitDraft } from './actions';
import { habitColors, habitIcons, orderedWeekdays, validateHabitDraft } from './model';
import type { HabitDraft, HabitErrors } from './model';
import HabitSymbol from './HabitSymbol';

interface Props {
  existing?: Habit;
  settings: Settings;
  nextOrder: number;
  onClose: () => void;
}

export default function HabitEditor({ existing, settings, nextOrder, onClose }: Props) {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const locked = useRef(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState(false);
  const [errors, setErrors] = useState<HabitErrors>({});
  const [draft, setDraft] = useState<HabitDraft>(() =>
    existing
      ? {
          name: existing.name,
          unit: existing.unit,
          target: String(existing.target),
          days: [...existing.days],
          icon: existing.icon,
          color: existing.color,
        }
      : {
          name: '',
          unit: 'بار',
          target: '1',
          days: [6, 0, 1, 2, 3, 4, 5],
          icon: 'heart',
          color: 'teal',
        },
  );

  const change = <K extends keyof HabitDraft>(field: K, value: HabitDraft[K]) => {
    setDraft((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) => ({ ...previous, [field]: undefined }));
    setFailure(false);
  };
  const fieldError = (field: keyof HabitDraft) =>
    errors[field] ? (
      <span className="habit-field-error" role="alert" id={`${id}-${field}-error`}>
        {errors[field]}
      </span>
    ) : null;
  const invalidProps = (field: keyof HabitDraft) => ({
    'aria-invalid': !!errors[field],
    'aria-describedby': errors[field] ? `${id}-${field}-error` : undefined,
  });
  const close = () => {
    if (!locked.current) onClose();
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (locked.current) return;
    const result = validateHabitDraft(draft);
    if (!result.valid) {
      setErrors(result.errors);
      requestAnimationFrame(() =>
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
      return;
    }
    const snapshot = { ...draft, days: [...draft.days] };
    const effectiveDate = today();
    const identity = existing;
    locked.current = true;
    setPending(true);
    setFailure(false);
    try {
      const success = await run(
        () => persistHabitDraft(snapshot, identity, effectiveDate, nextOrder),
        'عادت ذخیره شد.',
      );
      if (success) onClose();
      else setFailure(true);
    } finally {
      locked.current = false;
      setPending(false);
    }
  }

  return (
    <Modal open onClose={close} title={existing ? 'ویرایش عادت' : 'عادت جدید'}>
      <form
        ref={formRef}
        aria-label="فرم عادت"
        className="stack"
        onSubmit={submit}
        noValidate
        aria-busy={pending}
      >
        <div className="banner row items-start">
          <CalendarDays size={20} aria-hidden="true" className="mt-1" />
          <p>
            تغییرات از <strong>{formatDate(today(), settings)}</strong> اعمال می‌شوند. سوابق روزهای
            قبل تغییر نمی‌کنند.
          </p>
        </div>
        <fieldset disabled={pending} className="habit-fieldset stack">
          <Field label="نام عادت">
            <input
              value={draft.name}
              onChange={(event) => change('name', event.target.value)}
              autoComplete="off"
              required
              {...invalidProps('name')}
            />
          </Field>
          {fieldError('name')}
          <div className="form-grid">
            <div className="stack gap-2">
              <Field label="هدف هر روز" hint="بزرگ‌تر از صفر">
                <input
                  type="number"
                  aria-label="هدف هر روز"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={draft.target}
                  onChange={(event) => change('target', event.target.value)}
                  required
                  {...invalidProps('target')}
                />
              </Field>
              {fieldError('target')}
            </div>
            <div className="stack gap-2">
              <Field label="واحد" hint="مانند دقیقه، صفحه یا لیوان">
                <input
                  aria-label="واحد"
                  value={draft.unit}
                  onChange={(event) => change('unit', event.target.value)}
                  autoComplete="off"
                  required
                  {...invalidProps('unit')}
                />
              </Field>
              {fieldError('unit')}
            </div>
          </div>
          <fieldset
            className="habit-fieldset"
            {...invalidProps('days')}
            tabIndex={errors.days ? -1 : undefined}
          >
            <legend className="habit-legend">روزهای انجام</legend>
            <p className="muted small mb-3">حداقل یک روز هفته را انتخاب کنید.</p>
            <div className="habit-weekdays">
              {orderedWeekdays(settings.weekStartsOn).map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  className="habit-day-choice"
                  aria-pressed={draft.days.includes(value)}
                  onClick={() =>
                    change(
                      'days',
                      draft.days.includes(value)
                        ? draft.days.filter((day) => day !== value)
                        : [...draft.days, value],
                    )
                  }
                >
                  <span>{label}</span>
                  {draft.days.includes(value) && <Check size={14} aria-hidden="true" />}
                </button>
              ))}
            </div>
            {fieldError('days')}
          </fieldset>
          <fieldset className="habit-fieldset">
            <legend className="habit-legend">آیکون عادت</legend>
            <div className="habit-icon-choices">
              {habitIcons.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  className="habit-choice"
                  aria-label={`آیکون ${label}`}
                  aria-pressed={draft.icon === value}
                  onClick={() => change('icon', value)}
                >
                  <HabitSymbol icon={value} color={draft.color as HabitColor} />
                  <span>{label}</span>
                  {draft.icon === value && (
                    <Check size={16} className="habit-choice-check" aria-hidden="true" />
                  )}
                </button>
              ))}
            </div>
            {fieldError('icon')}
          </fieldset>
          <fieldset className="habit-fieldset">
            <legend className="habit-legend">رنگ عادت</legend>
            <div className="habit-color-choices">
              {habitColors.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  className={`habit-color-choice tone-${value}`}
                  aria-label={`رنگ ${label}`}
                  aria-pressed={draft.color === value}
                  onClick={() => change('color', value)}
                >
                  <span className="habit-color-dot" aria-hidden="true" />
                  <span>{label}</span>
                  {draft.color === value && <Check size={16} aria-hidden="true" />}
                </button>
              ))}
            </div>
            {fieldError('color')}
          </fieldset>
          <div className="habit-preview row">
            <HabitSymbol icon={draft.icon as HabitIcon} color={draft.color as HabitColor} />
            <div>
              <p className="font-semibold">{draft.name.trim() || 'عادت شما'}</p>
              <p className="muted small">
                {draft.unit.trim() ? `واحد ثبت: ${draft.unit.trim()}` : 'واحد را وارد کنید.'}
              </p>
            </div>
          </div>
        </fieldset>
        {failure && (
          <p role="alert" className="habit-field-error">
            عادت ذخیره نشد. اطلاعات فرم حفظ شده است؛ دوباره تلاش کنید.
          </p>
        )}
        <div className="habit-form-actions">
          <Button type="submit" disabled={pending}>
            {pending ? (
              <LoaderCircle size={18} aria-hidden="true" className="animate-spin" />
            ) : (
              <Save size={18} aria-hidden="true" />
            )}
            {pending ? 'در حال ذخیره…' : 'ذخیرهٔ عادت'}
          </Button>
          <Button variant="secondary" disabled={pending} onClick={close}>
            انصراف
          </Button>
        </div>
      </form>
    </Modal>
  );
}
