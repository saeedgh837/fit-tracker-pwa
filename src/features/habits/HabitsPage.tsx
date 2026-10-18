import { useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  Award,
  CalendarDays,
  Check,
  CircleCheck,
  Flame,
  ListChecks,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { removeHabit, setHabitValue } from '../../db';
import type { Habit } from '../../db/types';
import { useData } from '../../hooks/useData';
import { run, useUI } from '../../store/ui';
import { bestHabitStreak, dayCompletion, habitStreak } from '../../lib/calculations';
import { formatDate, today } from '../../lib/dates';
import { formatNumber } from '../../lib/format';
import {
  Button,
  Card,
  Confirm,
  EmptyState,
  IconButton,
  PageHeader,
  Progress,
} from '../../components/ui';
import { changeHabitArchive, moveHabit } from './actions';
import { buildDailyHabits } from './history';
import type { DailyHabit } from './history';
import { compareHabits, orderedWeekdays } from './model';
import HabitEditor from './HabitEditor';
import HabitHeatmap from './HabitHeatmap';
import HabitSymbol from './HabitSymbol';
import HabitValueEditor from './HabitValueEditor';
import './habits.css';

export default function HabitsPage() {
  const { habits, habitLogs, settings } = useData();
  const { date } = useUI();
  const [editor, setEditor] = useState<{ existing?: Habit } | null>(null);
  const [valueEditor, setValueEditor] = useState<{ entry: DailyHabit; date: string } | null>(null);
  const [deleting, setDeleting] = useState<Habit | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState(false);
  const actionLock = useRef<string | null>(null);
  const entries = useMemo(
    () => buildDailyHabits(habits, habitLogs, date),
    [habits, habitLogs, date],
  );
  const completion = useMemo(
    () => dayCompletion(habits, habitLogs, date),
    [habits, habitLogs, date],
  );
  const active = useMemo(
    () => habits.filter((habit) => !habit.archived).sort(compareHabits),
    [habits],
  );
  const archived = useMemo(
    () => habits.filter((habit) => habit.archived).sort(compareHabits),
    [habits],
  );
  const nextOrder = habits.length ? Math.max(...habits.map((habit) => habit.order)) + 1 : 0;
  const num = (value: number, decimals = 0) => formatNumber(value, settings, decimals);

  async function perform(
    key: string,
    action: () => Promise<unknown>,
    message: string,
  ): Promise<boolean> {
    if (actionLock.current) return false;
    actionLock.current = key;
    setBusy(key);
    setActionError(false);
    try {
      const success = await run(action, message);
      if (!success) setActionError(true);
      return success;
    } finally {
      actionLock.current = null;
      setBusy(null);
    }
  }

  function toggleDaily(entry: DailyHabit) {
    const operationDate = date;
    const operationHabit = entry.habit;
    const value = entry.done ? 0 : entry.target;
    void perform(
      `value:${entry.habit.id}`,
      () => setHabitValue(operationHabit, operationDate, value),
      entry.done ? 'مقدار این روز به صفر بازنشانی شد.' : 'هدف این روز ثبت شد.',
    );
  }
  function toggleArchive(habit: Habit) {
    const operationHabit = habit;
    const effectiveDate = today();
    void perform(
      `archive:${habit.id}`,
      () => changeHabitArchive(operationHabit, !operationHabit.archived, effectiveDate),
      habit.archived ? 'عادت از امروز بازگردانده شد.' : 'عادت از امروز بایگانی شد.',
    );
  }
  async function confirmDelete() {
    if (!deleting || actionLock.current) return;
    const id = deleting.id;
    const success = await perform(
      `delete:${id}`,
      () => removeHabit(id),
      'عادت و سوابق آن حذف شدند.',
    );
    if (success) setDeleting(null);
  }

  function managementRow(habit: Habit, index: number, list: Habit[]) {
    const current = habitStreak(habit, habitLogs, date);
    const best = bestHabitStreak(habit, habitLogs, date);
    return (
      <li key={habit.id} className="habit-management-row">
        <div className="row items-start">
          <HabitSymbol icon={habit.icon} color={habit.color} />
          <div className="min-w-0 flex-1">
            <div className="row flex-wrap gap-2">
              <h3 className="break-words">{habit.name}</h3>
              {habit.archived && <span className="badge">بایگانی‌شده</span>}
            </div>
            <p className="muted small">
              هدف: <bdi>{num(habit.target, 2)}</bdi> {habit.unit}
            </p>
            <p className="muted small">
              {orderedWeekdays(settings.weekStartsOn)
                .filter(({ value }) => habit.days.includes(value))
                .map(({ label }) => label)
                .join('، ')}
            </p>
            <p className="muted small">
              زنجیرهٔ فعلی: {num(current)} روز؛ بهترین زنجیره: {num(best)} روز
            </p>
          </div>
        </div>
        <div className="habit-management-controls">
          <div className="row gap-2">
            <IconButton
              label={`بالا بردن ${habit.name}`}
              disabled={!!busy || index === 0}
              onClick={() => {
                const id = habit.id;
                void perform(`order:${id}`, () => moveHabit(id, -1), 'ترتیب عادت‌ها ذخیره شد.');
              }}
            >
              <ArrowUp size={18} aria-hidden="true" />
            </IconButton>
            <IconButton
              label={`پایین بردن ${habit.name}`}
              disabled={!!busy || index === list.length - 1}
              onClick={() => {
                const id = habit.id;
                void perform(`order:${id}`, () => moveHabit(id, 1), 'ترتیب عادت‌ها ذخیره شد.');
              }}
            >
              <ArrowDown size={18} aria-hidden="true" />
            </IconButton>
          </div>
          <div className="row flex-wrap gap-2">
            <IconButton
              label={`ویرایش ${habit.name}`}
              disabled={!!busy}
              onClick={() => setEditor({ existing: habit })}
            >
              <Pencil size={18} aria-hidden="true" />
            </IconButton>
            <IconButton
              label={`${habit.archived ? 'بازگردانی' : 'بایگانی'} ${habit.name}`}
              disabled={!!busy}
              onClick={() => toggleArchive(habit)}
            >
              {habit.archived ? (
                <ArchiveRestore size={18} aria-hidden="true" />
              ) : (
                <Archive size={18} aria-hidden="true" />
              )}
            </IconButton>
            <IconButton
              label={`حذف دائمی ${habit.name}`}
              disabled={!!busy}
              onClick={() => setDeleting(habit)}
            >
              <Trash2 size={18} aria-hidden="true" className="text-[var(--danger)]" />
            </IconButton>
          </div>
        </div>
      </li>
    );
  }

  return (
    <div dir="rtl" lang="fa" className="habits-page">
      <PageHeader
        title="چک‌لیست عادت‌ها"
        subtitle="با قدم‌های کوچک، برنامه‌ای بسازید که ادامه پیدا کند."
        action={
          <Button disabled={!!busy} onClick={() => setEditor({})}>
            <Plus size={19} aria-hidden="true" />
            عادت جدید
          </Button>
        }
      />
      <div className="stack gap-6">
        <Card className="habit-day-summary">
          <div className="habit-summary-content">
            <div className="row gap-2 muted small">
              <CalendarDays size={18} aria-hidden="true" />
              <span>{formatDate(date, settings)}</span>
            </div>
            <h2 className="mt-3">
              {completion.total
                ? completion.done === completion.total
                  ? 'برنامهٔ این روز کامل شد.'
                  : 'هر ثبت، یک قدم رو به جلو'
                : 'برای این روز برنامه‌ای ندارید.'}
            </h2>
            <p className="muted small mt-2">
              {completion.total
                ? `${num(completion.done)} از ${num(completion.total)} عادت به هدف رسیده است.`
                : 'روزهای بدون برنامه در درصد تکمیل محاسبه نمی‌شوند.'}
            </p>
            {completion.total > 0 && (
              <div className="mt-4">
                <Progress
                  value={completion.done}
                  max={completion.total}
                  label="تکمیل برنامهٔ روز"
                />
              </div>
            )}
          </div>
          <div className="habit-summary-figure">
            {completion.total ? (
              <>
                <strong>
                  {num(completion.percent)}
                  <span>٪</span>
                </strong>
                <span className="muted small">تکمیل برنامه</span>
              </>
            ) : (
              <ListChecks size={44} strokeWidth={1.5} aria-hidden="true" />
            )}
          </div>
        </Card>

        {busy && (
          <p className="banner row" role="status" aria-label="عملیات عادت">
            <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />
            در حال ذخیرهٔ تغییرات…
          </p>
        )}
        {actionError && (
          <p className="habit-field-error banner" role="alert">
            عملیات انجام نشد. اطلاعات قبلی حفظ شده است؛ دوباره تلاش کنید.
          </p>
        )}

        <section aria-labelledby="habits-daily-heading" className="stack">
          <div className="habit-section-heading">
            <h2 id="habits-daily-heading">برنامهٔ این روز</h2>
            {entries.length > 0 && <span className="badge">{num(entries.length)} عادت</span>}
          </div>
          {!habits.length ? (
            <Card>
              <EmptyState
                icon={ListChecks}
                title="اولین عادت را بسازید"
                description="نام، هدف و روزهای انجام را مشخص کنید. هر روز مقدار انجام‌شده را ثبت کنید."
                action={
                  <Button onClick={() => setEditor({})}>
                    <Plus size={18} aria-hidden="true" />
                    ساخت اولین عادت
                  </Button>
                }
              />
            </Card>
          ) : !entries.length ? (
            <Card>
              <EmptyState
                icon={CalendarDays}
                title="برای این روز عادتی برنامه‌ریزی نشده است"
                description="برنامهٔ هفتگی یا روز دیگری را بررسی کنید. این روز در درصد تکمیل حساب نمی‌شود."
              />
            </Card>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {entries.map((entry) => (
                <Card
                  key={entry.habit.id}
                  role="article"
                  aria-label={`ثبت روزانهٔ ${entry.config.name}`}
                  className={`habit-daily-card tone-${entry.config.color}`}
                >
                  <div className="row justify-between items-start gap-3">
                    <div className="row min-w-0 items-start">
                      <HabitSymbol icon={entry.config.icon} color={entry.config.color} />
                      <div className="min-w-0">
                        <h3 className="break-words">{entry.config.name}</h3>
                        <p className="muted small">
                          هدف: <bdi>{num(entry.target, 2)}</bdi> {entry.config.unit}
                        </p>
                      </div>
                    </div>
                    {entry.done && (
                      <span className="badge whitespace-nowrap">
                        <CircleCheck size={15} aria-hidden="true" />
                        انجام شد
                      </span>
                    )}
                  </div>
                  <div className="habit-daily-value">
                    <strong>{num(entry.value, 2)}</strong>
                    <span className="muted">
                      از {num(entry.target, 2)} {entry.config.unit}
                    </span>
                  </div>
                  <Progress
                    value={entry.value}
                    max={entry.target}
                    label={`پیشرفت ${entry.config.name}`}
                    color="var(--tone)"
                  />
                  <div className="habit-streaks">
                    <span>
                      <Flame size={16} aria-hidden="true" />
                      زنجیره: {num(entry.streak)} روز
                    </span>
                    <span>
                      <Award size={16} aria-hidden="true" />
                      بهترین: {num(entry.bestStreak)} روز
                    </span>
                  </div>
                  <div className="habit-daily-actions">
                    <Button
                      variant={entry.done ? 'secondary' : 'primary'}
                      disabled={!!busy}
                      aria-label={`${entry.done ? 'بازنشانی' : 'تکمیل'} ${entry.config.name}`}
                      onClick={() => toggleDaily(entry)}
                    >
                      {entry.done ? (
                        <RotateCcw size={17} aria-hidden="true" />
                      ) : (
                        <Check size={17} aria-hidden="true" />
                      )}
                      {entry.done ? 'بازنشانی' : 'رسیدن به هدف'}
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={!!busy}
                      aria-label={`${entry.hasLog ? 'اصلاح' : 'ثبت'} مقدار ${entry.config.name}`}
                      onClick={() => setValueEditor({ entry, date })}
                    >
                      <Pencil size={17} aria-hidden="true" />
                      {entry.hasLog ? 'اصلاح مقدار' : 'ثبت مقدار'}
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        <HabitHeatmap habits={habits} logs={habitLogs} date={date} settings={settings} />

        <section aria-labelledby="habits-management-heading" className="stack">
          <div className="habit-section-heading">
            <div>
              <h2 id="habits-management-heading">مدیریت عادت‌ها</h2>
              <p className="muted small">
                ویرایش، بایگانی و بازگردانی از {formatDate(today(), settings)} اعمال می‌شوند.
              </p>
            </div>
            <span className="badge">{num(habits.length)} عادت</span>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <h3 className="section-title row">
                <ListChecks size={19} aria-hidden="true" />
                عادت‌های فعال <span className="badge">{num(active.length)}</span>
              </h3>
              {active.length ? (
                <ul className="habit-management-list">
                  {active.map((habit, index) => managementRow(habit, index, active))}
                </ul>
              ) : (
                <EmptyState
                  icon={ListChecks}
                  title="عادت فعالی ندارید"
                  description="عادت جدید بسازید یا یکی از عادت‌های بایگانی‌شده را بازگردانید."
                />
              )}
            </Card>
            <Card>
              <h3 className="section-title row">
                <Archive size={19} aria-hidden="true" />
                بایگانی <span className="badge">{num(archived.length)}</span>
              </h3>
              {archived.length ? (
                <ul className="habit-management-list">
                  {archived.map((habit, index) => managementRow(habit, index, archived))}
                </ul>
              ) : (
                <EmptyState
                  icon={Archive}
                  title="عادت بایگانی‌شده‌ای ندارید"
                  description="عادت‌های بایگانی‌شده همراه با سوابقشان اینجا می‌مانند و قابل بازگردانی هستند."
                />
              )}
            </Card>
          </div>
        </section>
      </div>
      {editor && (
        <HabitEditor
          existing={editor.existing}
          settings={settings}
          nextOrder={nextOrder}
          onClose={() => setEditor(null)}
        />
      )}
      {valueEditor && (
        <HabitValueEditor
          entry={valueEditor.entry}
          date={valueEditor.date}
          settings={settings}
          onClose={() => setValueEditor(null)}
        />
      )}
      <Confirm
        open={!!deleting}
        onClose={() => {
          if (!actionLock.current) setDeleting(null);
        }}
        onConfirm={() => {
          void confirmDelete();
        }}
        title="حذف دائمی عادت"
        description={`«${deleting?.name ?? ''}» و همهٔ سوابق روزانهٔ آن برای همیشه حذف می‌شوند. این کار قابل بازگشت نیست.`}
        danger
      />
    </div>
  );
}
