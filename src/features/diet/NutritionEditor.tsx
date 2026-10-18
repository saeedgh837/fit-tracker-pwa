import { useId, useRef, useState, type FormEvent } from 'react';
import { Button, Field, Modal } from '../../components/ui';
import { useData } from '../../hooks/useData';
import { formatDate } from '../../lib/dates';
import { run } from '../../store/ui';
import { parseNutritionDraft, type NutritionDraft } from './dietLogic';
import { saveFood, saveMeal, type FoodDraft, type MealDraft } from './dietWrites';

const mealOptions = [
  ['breakfast', 'صبحانه'],
  ['lunch', 'ناهار'],
  ['dinner', 'شام'],
  ['snack', 'میان‌وعده'],
] as const;
const macroFields = [
  ['protein', 'پروتئین'],
  ['carbs', 'کربوهیدرات'],
  ['fat', 'چربی'],
] as const;

export default function NutritionEditor({
  initial,
  kind,
  onClose,
}: {
  initial: MealDraft | FoodDraft;
  kind: 'meal' | 'food';
  onClose: () => void;
}) {
  const { settings } = useData();
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [invalidField, setInvalidField] = useState<keyof NutritionDraft | null>(null);
  const lock = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const id = useId();
  const title =
    kind === 'food'
      ? initial.id
        ? 'ویرایش غذای کتابخانه'
        : 'غذای جدید در کتابخانه'
      : initial.id
        ? 'ویرایش وعده'
        : 'ثبت وعده';

  function update(key: keyof MealDraft, value: string | boolean) {
    setDraft((current) => ({ ...current, [key]: value }));
    if (invalidField === key) {
      setInvalidField(null);
      setError('');
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    const result = parseNutritionDraft(draft);
    if (!result.ok) {
      setInvalidField(result.field);
      setError(result.error);
      form.current?.querySelector<HTMLInputElement>(`[name="${result.field}"]`)?.focus();
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    setInvalidField(null);
    const ok = await run(
      () => (kind === 'meal' ? saveMeal(draft as MealDraft) : saveFood(draft)),
      'اطلاعات غذا ذخیره شد.',
    );
    lock.current = false;
    setBusy(false);
    if (ok) onClose();
    else setError('اطلاعات غذا ذخیره نشد. دوباره تلاش کنید.');
  }

  function inputErrors(field: keyof NutritionDraft) {
    return {
      'aria-invalid': invalidField === field || undefined,
      'aria-describedby': invalidField === field ? `${id}-${field}-error` : undefined,
    } as const;
  }

  function fieldError(field: keyof NutritionDraft) {
    return invalidField === field ? (
      <p id={`${id}-${field}-error`} className="small text-[var(--danger)]">
        {error}
      </p>
    ) : null;
  }

  return (
    <Modal
      open
      title={title}
      onClose={() => {
        if (!lock.current) onClose();
      }}
    >
      <form ref={form} className="stack" onSubmit={save} noValidate aria-busy={busy}>
        {error && (
          <p role="alert" className="banner">
            {error}
          </p>
        )}
        <fieldset disabled={busy} className="stack m-0 min-w-0 border-0 p-0">
          {kind === 'meal' && (
            <>
              <p className="banner">
                تاریخ این وعده: <bdi>{formatDate((draft as MealDraft).date, settings)}</bdi>
              </p>
              <Field label="وعده">
                <select
                  value={(draft as MealDraft).meal}
                  onChange={(event) => update('meal', event.target.value)}
                >
                  {mealOptions.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
          {kind === 'food' && (
            <p className="banner">مقادیر این غذا برای هر سهم ذخیره‌شده است، نه لزوماً صد گرم.</p>
          )}
          <div>
            <Field label="نام غذا">
              <input
                name="name"
                value={draft.name}
                onChange={(event) => update('name', event.target.value)}
                autoFocus
                required
                {...inputErrors('name')}
              />
            </Field>
            {fieldError('name')}
          </div>
          <div>
            <Field label="کالری">
              <input
                name="calories"
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                value={draft.calories}
                onChange={(event) => update('calories', event.target.value)}
                required
                {...inputErrors('calories')}
              />
            </Field>
            {fieldError('calories')}
          </div>
          <p className="muted small">
            درشت‌مغذی‌ها اختیاری‌اند. مقدار خالی صفر ذخیره می‌شود و مجموع آن‌ها ممکن است ناقص باشد.
            کالری مستقل از آن‌ها ذخیره می‌شود.
          </p>
          <div className="form-grid">
            {macroFields.map(([key, label]) => (
              <div key={key}>
                <Field label={`${label} (گرم، اختیاری)`}>
                  <input
                    name={key}
                    type="number"
                    min={0}
                    step="any"
                    inputMode="decimal"
                    value={draft[key]}
                    onChange={(event) => update(key, event.target.value)}
                    {...inputErrors(key)}
                  />
                </Field>
                {fieldError(key)}
              </div>
            ))}
          </div>
          {kind === 'meal' && (
            <label className="row small min-h-11 w-fit cursor-pointer">
              <input
                type="checkbox"
                checked={(draft as MealDraft).cheat}
                onChange={(event) => update('cheat', event.target.checked)}
              />
              وعدهٔ آزاد
            </label>
          )}
          <div className="row flex-wrap justify-end">
            <Button variant="secondary" onClick={onClose}>
              انصراف
            </Button>
            <Button type="submit">
              {busy ? 'در حال ذخیره…' : kind === 'meal' ? 'ذخیره وعده' : 'ذخیره غذا'}
            </Button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
