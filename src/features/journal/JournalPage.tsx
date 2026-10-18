import { useEffect, useRef, useState, type FormEvent } from 'react';
import { BookOpen, Moon, Save, Smile, Trash2, Zap } from 'lucide-react';
import { Button, Card, Confirm, Field, PageHeader } from '../../components/ui';
import { updateDay } from '../../db';
import type { DailyLog } from '../../db/types';
import { useData } from '../../hooks/useData';
import { formatDate } from '../../lib/dates';
import { formatNumber } from '../../lib/format';
import { run, useUI } from '../../store/ui';
import PhotoSection from './PhotoSection';
import {
  clearJournalPatch,
  createJournalDraft,
  journalDirty,
  reconcileJournalDraft,
  validateJournal,
} from './journalLogic';

export default function JournalPage() {
  const { date } = useUI();
  const { days, settings } = useData();
  const selectedDay = days.find((day) => day.date === date);
  const [draft, setDraft] = useState(() => createJournalDraft(date, selectedDay));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [clearDate, setClearDate] = useState<string | null>(null);
  const [discardDate, setDiscardDate] = useState<string | null>(null);
  const [saved, setSaved] = useState('');
  const lock = useRef(false);
  const currentSelection = useRef({ date, day: selectedDay });
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    currentSelection.current = { date, day: selectedDay };
  }, [date, selectedDay]);
  useEffect(() => {
    setDraft((current) => reconcileJournalDraft(current, date, selectedDay, lock.current));
  }, [date, selectedDay]);
  useEffect(() => {
    if (Object.keys(errors).length) errorRef.current?.focus();
  }, [errors]);
  const dirty = journalDirty(draft);
  function resetAfterWrite(
    destination: string,
    patch: ReturnType<typeof clearJournalPatch> | Parameters<typeof updateDay>[1],
  ) {
    const selection = currentSelection.current;
    if (selection.date !== destination) setDraft(createJournalDraft(selection.date, selection.day));
    else
      setDraft((current) =>
        createJournalDraft(destination, {
          ...(selection.day ?? current.baseline),
          ...patch,
        } as DailyLog),
      );
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    const result = validateJournal(draft);
    if (result.errors) {
      setErrors(result.errors);
      return;
    }
    if (!Object.keys(result.patch).length) {
      setSaved('تغییری برای ذخیره وجود ندارد.');
      return;
    }
    const destination = draft.date,
      patch = result.patch;
    lock.current = true;
    setBusy(true);
    setErrors({});
    setSaved('');
    const ok = await run(() => updateDay(destination, patch), 'ژورنال ذخیره شد.');
    lock.current = false;
    setBusy(false);
    if (ok) {
      resetAfterWrite(destination, patch);
      setSaved(`ژورنال ${formatDate(destination, settings)} ذخیره شد.`);
    } else
      setErrors({ save: 'ذخیره ژورنال انجام نشد. پیش‌نویس شما حفظ شده است؛ دوباره تلاش کنید.' });
  }
  async function clear() {
    if (!clearDate || lock.current) return;
    const destination = clearDate,
      patch = clearJournalPatch();
    lock.current = true;
    setBusy(true);
    setErrors({});
    setSaved('');
    const ok = await run(() => updateDay(destination, patch), 'ژورنال روز پاک شد.');
    lock.current = false;
    setBusy(false);
    if (ok) {
      setClearDate(null);
      resetAfterWrite(destination, patch);
      setSaved('فقط اطلاعات ژورنال پاک شد؛ اطلاعات دیگر روز محفوظ است.');
    } else {
      setClearDate(null);
      setErrors({ save: 'پاک کردن ژورنال انجام نشد. اطلاعات شما محفوظ است؛ دوباره تلاش کنید.' });
    }
  }
  function change(key: 'sleepHours' | 'mood' | 'energy' | 'note', value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
    setSaved('');
  }
  return (
    <div dir="rtl" className="stack">
      <PageHeader
        title="ژورنال و عکس‌ها"
        subtitle="خواب، حال روز و تغییرات خود را بدون ارسال داده به بیرون ثبت کنید."
      />
      <Card className="stack">
        <div className="row flex-wrap justify-between">
          <h2 className="row">
            <BookOpen size={22} aria-hidden="true" />
            ژورنال روزانه
          </h2>
          <span className="badge">{formatDate(draft.date, settings)}</span>
        </div>
        {draft.date !== date && (
          <div className="banner stack">
            <p>
              پیش‌نویس برای {formatDate(draft.date, settings)} است. تغییر روز بالای صفحه، مقصد این
              پیش‌نویس را عوض نمی‌کند.
            </p>
            <Button variant="secondary" disabled={busy} onClick={() => setDiscardDate(date)}>
              کنار گذاشتن پیش‌نویس و رفتن به روز انتخاب‌شده
            </Button>
          </div>
        )}
        <form onSubmit={save} noValidate className="stack" aria-busy={busy}>
          {Object.keys(errors).length > 0 && (
            <div
              role="alert"
              tabIndex={-1}
              ref={errorRef}
              className="banner"
              style={{ borderColor: 'var(--danger)' }}
            >
              <p className="font-semibold">ژورنال ثبت نشد</p>
              <ul className="m-0 list-disc ps-5">
                {Object.entries(errors).map(([key, message]) => (
                  <li key={key}>
                    {['save', 'date'].includes(key) ? (
                      message
                    ) : (
                      <a className="underline" href={`#journal-${key}`}>
                        {message}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <fieldset disabled={busy} className="m-0 grid gap-4 border-0 p-0">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="stack">
                <span className="tone-icon tone-blue">
                  <Moon size={22} aria-hidden="true" />
                </span>
                <Field label="ساعت خواب">
                  <input
                    aria-label="ساعت خواب"
                    id="journal-sleepHours"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={24}
                    step="any"
                    value={draft.sleepHours}
                    onChange={(e) => change('sleepHours', e.target.value)}
                    aria-describedby={`journal-sleep-help${errors.sleepHours ? ' journal-sleep-error' : ''}`}
                    aria-invalid={Boolean(errors.sleepHours)}
                  />
                  <span id="journal-sleep-help" className="field-hint">
                    از صفر تا ۲۴ ساعت؛ خالی یعنی ثبت نشده.
                  </span>
                  {errors.sleepHours && (
                    <span
                      id="journal-sleep-error"
                      className="small"
                      style={{ color: 'var(--danger)' }}
                    >
                      {errors.sleepHours}
                    </span>
                  )}
                </Field>
              </div>
              <div className="stack">
                <span className="tone-icon tone-rose">
                  <Smile size={22} aria-hidden="true" />
                </span>
                <Field label="خلق‌وخو">
                  <input
                    aria-label="خلق‌وخو"
                    id="journal-mood"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={5}
                    step={1}
                    value={draft.mood}
                    onChange={(e) => change('mood', e.target.value)}
                    aria-describedby={`journal-mood-help${errors.mood ? ' journal-mood-error' : ''}`}
                    aria-invalid={Boolean(errors.mood)}
                  />
                  <span id="journal-mood-help" className="field-hint">
                    ۱: بسیار بد، ۳: معمولی، ۵: بسیار خوب؛ اختیاری.
                  </span>
                  {errors.mood && (
                    <span
                      id="journal-mood-error"
                      className="small"
                      style={{ color: 'var(--danger)' }}
                    >
                      {errors.mood}
                    </span>
                  )}
                </Field>
              </div>
              <div className="stack">
                <span className="tone-icon tone-orange">
                  <Zap size={22} aria-hidden="true" />
                </span>
                <Field label="انرژی">
                  <input
                    aria-label="انرژی"
                    id="journal-energy"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={5}
                    step={1}
                    value={draft.energy}
                    onChange={(e) => change('energy', e.target.value)}
                    aria-describedby={`journal-energy-help${errors.energy ? ' journal-energy-error' : ''}`}
                    aria-invalid={Boolean(errors.energy)}
                  />
                  <span id="journal-energy-help" className="field-hint">
                    ۱: بسیار کم، ۳: متوسط، ۵: بسیار زیاد؛ اختیاری.
                  </span>
                  {errors.energy && (
                    <span
                      id="journal-energy-error"
                      className="small"
                      style={{ color: 'var(--danger)' }}
                    >
                      {errors.energy}
                    </span>
                  )}
                </Field>
              </div>
            </div>
            <Field label="یادداشت روز">
              <textarea
                id="journal-note"
                rows={5}
                value={draft.note}
                onChange={(e) => change('note', e.target.value)}
              />
            </Field>
          </fieldset>
          <div className="row flex-wrap justify-between">
            <div className="row flex-wrap">
              <Button type="submit" disabled={busy}>
                <Save size={18} aria-hidden="true" />
                {busy ? 'در حال ذخیره…' : 'ذخیره ژورنال'}
              </Button>
              <span className="muted small">
                {dirty ? 'تغییرهای ذخیره‌نشده دارید.' : 'تغییر ذخیره‌نشده‌ای ندارید.'}
              </span>
            </div>
            <Button
              variant="ghost"
              disabled={
                busy ||
                (!dirty &&
                  !Object.values(draft.baseline).some((value) => value !== null && value !== ''))
              }
              onClick={() => setClearDate(draft.date)}
            >
              <Trash2 size={18} aria-hidden="true" />
              پاک کردن ژورنال
            </Button>
          </div>
          {saved && (
            <p role="status" className="banner">
              {saved}
            </p>
          )}
        </form>
        <p className="muted small">
          خواب صفر با ثبت‌نشدن خواب تفاوت دارد. آب، قدم‌ها و اطلاعات برنامهٔ غذایی یا ورزش با ذخیره
          و پاک کردن این فرم تغییر نمی‌کنند.
        </p>
        {selectedDay?.note && !dirty && draft.date === date && (
          <details>
            <summary>یادداشت ذخیره‌شدهٔ روز</summary>
            <p className="whitespace-pre-wrap break-words">{selectedDay.note}</p>
          </details>
        )}
        <p className="muted small">
          امتیازهای خلق‌وخو و انرژی از {formatNumber(1, settings)} تا {formatNumber(5, settings)}{' '}
          هستند و برای پیگیری شخصی استفاده می‌شوند.
        </p>
      </Card>
      <PhotoSection date={date} settings={settings} />
      <Confirm
        open={clearDate !== null}
        title="پاک کردن ژورنال روز؟"
        description={`فقط خواب، خلق‌وخو، انرژی و یادداشت ${clearDate ? formatDate(clearDate, settings) : ''} پاک می‌شوند. اطلاعات دیگر روز محفوظ می‌ماند.`}
        danger
        onClose={() => {
          if (!lock.current) setClearDate(null);
        }}
        onConfirm={() => {
          void clear();
        }}
      />
      <Confirm
        open={discardDate !== null}
        title="کنار گذاشتن پیش‌نویس؟"
        description="تغییرهای ذخیره‌نشدهٔ ژورنال کنار گذاشته می‌شوند. هیچ دادهٔ ذخیره‌شده‌ای حذف نمی‌شود."
        danger={false}
        onClose={() => setDiscardDate(null)}
        onConfirm={() => {
          if (!lock.current && discardDate) {
            const destination = discardDate;
            setDraft(
              createJournalDraft(
                destination,
                days.find((day) => day.date === destination),
              ),
            );
            setErrors({});
            setSaved('');
            setDiscardDate(null);
          }
        }}
      />
    </div>
  );
}
