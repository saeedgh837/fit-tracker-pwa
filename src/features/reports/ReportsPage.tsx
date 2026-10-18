import { useState } from 'react';
import {
  Award,
  ChartNoAxesCombined,
  Dumbbell,
  Flame,
  Lightbulb,
  Moon,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { Card, PageHeader, Segments, Stat, EmptyState } from '../../components/ui';
import DataChart from '../../components/DataChart';
import { useData } from '../../hooks/useData';
import { useUI } from '../../store/ui';
import { addDays, dateRange, formatDate, shortDate, startOfWeek } from '../../lib/dates';
import { formatNumber, fromKg } from '../../lib/format';
import { dayCompletion } from '../../lib/calculations';
import {
  achievements,
  bestDayStreak,
  bestHabits,
  correlationHint,
  periodSummary,
} from './insights';
export default function ReportsPage() {
  const data = useData();
  const { date } = useUI();
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const { settings } = data;
  const monthDay = Number(
    new Intl.DateTimeFormat(`en-u-ca-${settings.calendar}`, {
      day: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${date}T12:00:00Z`)),
  );
  const start =
    period === 'week' ? startOfWeek(date, settings.weekStartsOn) : addDays(date, -monthDay + 1);
  const summary = periodSummary(data, start, date);
  const n = (v: number, d = 0) => formatNumber(v, settings, d);
  const badges = achievements(data, date);
  const rows = dateRange(addDays(date, -29), date).map((d) => {
    const c = dayCompletion(data.habits, data.habitLogs, d);
    return { label: shortDate(d, settings), percent: c.total ? c.percent : null };
  });
  const any =
    data.days.length + data.habitLogs.length + data.weights.length + data.workouts.length > 0;
  return (
    <div className="stack">
      <PageHeader title="یک نگاه به مسیر" subtitle="الگوها را ببینید، نه فقط عددهای امروز را." />
      <Segments
        value={period}
        onChange={setPeriod}
        label="بازهٔ گزارش"
        options={[
          { value: 'week', label: 'هفتهٔ جاری' },
          { value: 'month', label: 'ماه جاری' },
        ]}
      />
      <p className="muted small">
        {formatDate(start, settings)} تا {formatDate(date, settings)}؛ فقط روزهای سپری‌شده
      </p>
      {!any && (
        <Card>
          <EmptyState
            icon={ChartNoAxesCombined}
            title="گزارش شما از اولین ثبت شروع می‌شود"
            description="یک عادت، وزن یا وعده ثبت کنید. با بیشتر شدن اطلاعات، الگوها واضح‌تر می‌شوند."
          />
        </Card>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <Stat
            icon={Sparkles}
            label="انجام عادت‌ها"
            value={summary.habitPercent === null ? 'ثبت نشده' : `${n(summary.habitPercent)}٪`}
            detail={`${n(summary.completedDays)} روز کامل`}
          />
        </Card>
        <Card>
          <Stat
            icon={Flame}
            label="پایبندی غذایی"
            value={summary.adherence === null ? 'ثبت نشده' : `${n(summary.adherence)}٪`}
            detail={`بر پایهٔ ${n(summary.dietDays)} روز دارای امتیاز`}
          />
        </Card>
        <Card>
          <Stat
            icon={Dumbbell}
            label="تمرین‌های دوره"
            value={`${n(summary.workouts)} جلسه`}
            detail={`${n(summary.minutes)} دقیقه فعالیت`}
          />
        </Card>
        <Card>
          <Stat
            icon={TrendingUp}
            label="تغییر وزن دوره"
            value={
              summary.weightChange === null
                ? 'دادهٔ کافی نیست'
                : `${summary.weightChange > 0 ? '+' : ''}${n(fromKg(summary.weightChange, settings.weightUnit), 2)}`
            }
            detail={
              settings.weightUnit === 'kg' ? 'کیلوگرم؛ آخرین ثبت روزانه' : 'پوند؛ آخرین ثبت روزانه'
            }
          />
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="stack">
          <h2>ریتم عادت‌ها در سی روز گذشته</h2>
          {rows.some((r) => r.percent !== null) ? (
            <DataChart
              title="درصد انجام روزانهٔ عادت‌ها"
              data={rows}
              series={[{ key: 'percent', label: 'درصد انجام', type: 'bar' }]}
              valueFormatter={(v) => `${n(v)}٪`}
            />
          ) : (
            <p className="muted">هنوز عادت برنامه‌ریزی‌شده‌ای در این بازه ندارید.</p>
          )}
        </Card>
        <Card className="stack">
          <h2 className="row">
            <Moon size={22} aria-hidden="true" />
            جزئیات روزمره
          </h2>
          <div className="grid grid-cols-2 gap-6">
            <Stat
              label="میانگین خواب"
              value={
                summary.averageSleep === null ? 'ثبت نشده' : `${n(summary.averageSleep, 1)} ساعت`
              }
            />
            <Stat label="مجموع قدم‌ها" value={n(summary.steps)} />
            <Stat
              label="میانگین کالری ثبت‌شده"
              value={summary.averageCalories === null ? 'ثبت نشده' : n(summary.averageCalories)}
              detail={`${n(summary.mealDays)} روز دارای وعده؛ ثبت ناقص ممکن است.`}
            />
            <Stat
              label="بهترین زنجیرهٔ کامل"
              value={`${n(bestDayStreak(data, date))} روز`}
              detail="از ابتدای ثبت تا روز انتخاب‌شده"
            />
          </div>
          <div className="banner mt-3">
            <h3 className="row mb-2">
              <Lightbulb size={18} aria-hidden="true" />
              یک نکته از ثبت‌های شما
            </h3>
            <p className="small">{correlationHint(data, date)}</p>
          </div>
        </Card>
      </div>
      <Card className="stack">
        <h2>پایدارترین عادت‌ها</h2>
        {bestHabits(data, date).length ? (
          bestHabits(data, date).map((h) => (
            <div
              className="row justify-between border-b border-[var(--line)] pb-3 last:border-0"
              key={h.id}
            >
              <span>{h.name}</span>
              <span className="badge">{n(h.streak)} روز برنامه‌ریزی‌شده</span>
            </div>
          ))
        ) : (
          <p className="muted small">با ثبت عادت‌ها، بهترین زنجیرهٔ هر کدام اینجا دیده می‌شود.</p>
        )}
      </Card>
      <section className="stack">
        <h2 className="row">
          <Award size={23} aria-hidden="true" />
          نشانه‌های پیشرفت
        </h2>
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          {badges.map((b) => (
            <Card
              key={b.id}
              className={`text-center flex flex-col items-center gap-3 ${b.earned ? 'border-[var(--primary)]' : 'opacity-75'}`}
            >
              <div
                className={`w-12 h-12 rounded-2xl grid place-items-center ${b.earned ? 'bg-[var(--primary-soft)] text-[var(--primary-strong)]' : 'bg-[var(--surface-soft)] text-[var(--muted)]'}`}
              >
                <Award size={27} aria-hidden="true" />
              </div>
              <h3>{b.title.replace(/\d+/g, (v) => n(+v))}</h3>
              <p className="muted text-xs">{b.description.replace(/\d+/g, (v) => n(+v))}</p>
              <span className="small">{b.earned ? 'به دست آمد' : 'هنوز در مسیر'}</span>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
