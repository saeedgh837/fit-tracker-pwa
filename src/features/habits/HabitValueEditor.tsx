import { useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { CalendarDays, LoaderCircle, RotateCcw, Save } from 'lucide-react';
import { setHabitValue } from '../../db';
import type { Settings } from '../../db/types';
import { Button, Field, Modal, Progress } from '../../components/ui';
import { formatDate } from '../../lib/dates';
import { formatNumber } from '../../lib/format';
import { run } from '../../store/ui';
import type { DailyHabit } from './history';
import { validateHabitValue } from './model';
import HabitSymbol from './HabitSymbol';

interface Props {
  entry: DailyHabit;
  date: string;
  settings: Settings;
  onClose: () => void;
}

export default function HabitValueEditor({ entry, date, settings, onClose }: Props) {
  const id = useId();
  const locked = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(String(entry.value));
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const close = () => {
    if (!locked.current) onClose();
  };

  async function save(raw: string) {
    if (locked.current) return;
    const result = validateHabitValue(raw);
    if (!result.valid) {
      setError(result.error);
      inputRef.current?.focus();
      return;
    }
    // Both identity and day come from the opened editor, never from live UI state.
    const operationHabit = entry.habit;
    const operationDate = date;
    const operationValue = result.value;
    locked.current = true;
    setPending(true);
    setError('');
    try {
      const success = await run(
        () => setHabitValue(operationHabit, operationDate, operationValue),
        'مقدار روزانه ذخیره شد.',
      );
      if (success) onClose();
      else setError('مقدار ذخیره نشد. مقدار واردشده حفظ شده است؛ دوباره تلاش کنید.');
    } finally {
      locked.current = false;
      setPending(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void save(value);
  }
  const parsed = validateHabitValue(value);

  return (
    <Modal open title={`مقدار ${entry.config.name}`} onClose={close}>
      <form
        aria-label="فرم مقدار روزانه"
        className="stack"
        onSubmit={submit}
        noValidate
        aria-busy={pending}
      >
        <div className="row">
          <HabitSymbol icon={entry.config.icon} color={entry.config.color} />
          <div>
            <h3>{entry.config.name}</h3>
            <p className="muted small row gap-2">
              <CalendarDays size={15} aria-hidden="true" />
              {formatDate(date, settings)}
            </p>
          </div>
        </div>
        <p className="banner">
          این مقدار برای روز بالا ثبت می‌شود، حتی اگر تاریخ صفحه را تغییر دهید.
        </p>
        <Field
          label="مقدار انجام‌شده"
          hint={`هدف این روز: ${formatNumber(entry.target, settings, 2)} ${entry.config.unit}؛ ثبت بیش از هدف مجاز است.`}
        >
          <input
            ref={inputRef}
            aria-label="مقدار انجام‌شده"
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            value={value}
            disabled={pending}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(event) => {
              setValue(event.target.value);
              setError('');
            }}
          />
        </Field>
        {error && (
          <p role="alert" id={`${id}-error`} className="habit-field-error">
            {error}
          </p>
        )}
        <div className={`tone-${entry.config.color} stack gap-2`}>
          <div className="row justify-between">
            <span className="muted small">پیشرفت این روز</span>
            <span className="small">
              <bdi>{formatNumber(parsed.valid ? parsed.value : 0, settings, 2)}</bdi> از{' '}
              <bdi>{formatNumber(entry.target, settings, 2)}</bdi> {entry.config.unit}
            </span>
          </div>
          <Progress
            value={parsed.valid ? parsed.value : 0}
            max={entry.target}
            label={`پیشرفت ${entry.config.name}`}
            color="var(--tone)"
          />
        </div>
        <div className="habit-form-actions">
          <Button type="submit" disabled={pending}>
            {pending ? (
              <LoaderCircle size={18} aria-hidden="true" className="animate-spin" />
            ) : (
              <Save size={18} aria-hidden="true" />
            )}
            {pending ? 'در حال ذخیره…' : 'ذخیرهٔ مقدار'}
          </Button>
          <Button variant="secondary" disabled={pending} onClick={close}>
            انصراف
          </Button>
        </div>
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => {
            void save('0');
          }}
        >
          <RotateCcw size={17} aria-hidden="true" />
          بازنشانی به صفر
        </Button>
      </form>
    </Modal>
  );
}
