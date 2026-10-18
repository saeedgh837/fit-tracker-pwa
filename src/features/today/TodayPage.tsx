import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowUpLeft,
  Check,
  ChevronLeft,
  Droplets,
  Dumbbell,
  Flame,
  Footprints,
  Heart,
  Moon,
  Plus,
  Scale,
  Sparkles,
  Sun,
} from 'lucide-react';
import { Button, Card, IconButton, Modal, Progress, Stat } from '../../components/ui';
import { useData } from '../../hooks/useData';
import { changeWater, db, setHabitValue, uid } from '../../db';
import {
  dayCompletion,
  dayStreak,
  habitAtDate,
  isHabitScheduled,
  nutritionTargets,
} from '../../lib/calculations';
import { formatDate, today } from '../../lib/dates';
import { formatNumber, fromKg, toKg } from '../../lib/format';
import { run, useUI } from '../../store/ui';
export default function TodayPage() {
  const { profile, settings, habits, habitLogs, days, weights, meals, workouts } = useData();
  const { date } = useUI();
  const day = days.find((d) => d.date === date);
  const completion = dayCompletion(habits, habitLogs, date);
  const streak = dayStreak(habits, habitLogs, date);
  const latest = [...weights]
    .filter((w) => w.date <= date)
    .sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time))[0];
  const target = profile
    ? nutritionTargets(profile, latest?.weightKg ?? profile.startWeightKg)
    : null;
  const consumed = meals
    .filter((m) => m.date === date)
    .reduce(
      (s, m) => ({
        calories: s.calories + m.calories,
        protein: s.protein + m.protein,
        carbs: s.carbs + m.carbs,
        fat: s.fat + m.fat,
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 },
    );
  const [weightOpen, setWeightOpen] = useState(false);
  const [weight, setWeight] = useState('');
  const [busy, setBusy] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const prev = useRef(completion.percent);
  const reduced = useReducedMotion();
  const n = (v: number, d = 0) => formatNumber(v, settings, d);
  useEffect(() => {
    if (completion.total > 0 && completion.percent === 100 && prev.current < 100) {
      setCelebrate(true);
      const timer = setTimeout(() => setCelebrate(false), 2200);
      prev.current = completion.percent;
      return () => clearTimeout(timer);
    }
    prev.current = completion.percent;
  }, [completion.percent, completion.total]);
  const hour = new Date().getHours();
  const greeting =
    date !== today()
      ? 'روزهای مسیر شما'
      : hour < 12
        ? 'صبح به‌خیر'
        : hour < 18
          ? 'روزتان به‌خیر'
          : 'عصر به‌خیر';
  const scheduled = habits
    .filter((h) => isHabitScheduled(h, date))
    .sort((a, b) => a.order - b.order)
    .slice(0, 4);
  const circumference = 2 * Math.PI * 62;
  async function saveWeight(e: React.FormEvent) {
    e.preventDefault();
    const kg = toKg(Number(weight), settings.weightUnit);
    if (!weight.trim() || kg < 20 || kg > 500 || !Number.isFinite(kg)) return;
    setBusy(true);
    if (
      await run(
        () =>
          db.weights.put({
            id: uid(),
            date,
            time: new Date().toTimeString().slice(0, 5),
            weightKg: kg,
            note: '',
          }),
        'وزن ثبت شد.',
      )
    )
      setWeightOpen(false);
    setBusy(false);
  }
  return (
    <div className="stack gap-6">
      <header className="row justify-between items-start">
        <div>
          <p className="muted small mb-1">{formatDate(date, settings, { weekday: 'long' })}</p>
          <h1>
            {greeting}
            {profile?.name ? `، ${profile.name}` : ''}
          </h1>
          <p className="muted small mt-2">امروز، یک قدم به حالِ بهتر نزدیک‌تر.</p>
        </div>
        <span className="hidden sm:inline-flex badge mt-3">
          <Heart size={15} aria-hidden="true" />
          فضای شخصی شما
        </span>
      </header>
      <div className="grid gap-4 lg:grid-cols-[1.45fr_1fr]">
        <Card className="hero-card">
          <div className="row justify-between gap-4 h-full">
            <div className="flex flex-col items-start gap-3">
              <span className="row small text-teal-50">
                <Sparkles size={18} aria-hidden="true" />
                قدم‌های امروز
              </span>
              <h2 className="text-2xl">
                {completion.percent === 100 && completion.total
                  ? 'آفرین، روزتان کامل شد!'
                  : 'هر قدم، ارزش خودش را دارد.'}
              </h2>
              <p className="muted small">
                {completion.total
                  ? `${n(completion.done)} از ${n(completion.total)} عادت انجام شده`
                  : 'عادت‌های روزتان را از چک‌لیست بسازید.'}
              </p>
              <Link
                to="/habits"
                className="row rounded-xl bg-white/15 px-4 py-2 min-h-11 text-sm mt-1"
              >
                ادامهٔ چک‌لیست
                <ChevronLeft size={17} aria-hidden="true" />
              </Link>
            </div>
            <div className="hero-ring">
              <svg viewBox="0 0 144 144" className="w-full h-full" aria-hidden="true">
                <circle cx="72" cy="72" r="62" stroke="#ffffff25" strokeWidth="9" fill="none" />
                <circle
                  cx="72"
                  cy="72"
                  r="62"
                  stroke="#a1f1dc"
                  strokeWidth="9"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={circumference * (1 - completion.percent / 100)}
                  style={{ transition: 'stroke-dashoffset 600ms ease' }}
                />
              </svg>
              <div
                className="hero-ring-content"
                role="img"
                aria-label={`${n(completion.percent)} درصد انجام عادت‌ها`}
              >
                <strong>
                  {n(completion.percent)}
                  <span className="text-xl">٪</span>
                </strong>
                <span className="text-xs text-teal-100">یک روز، یک مسیر</span>
              </div>
            </div>
          </div>
        </Card>
        <Card className="stack justify-between">
          <div className="row justify-between">
            <h2 className="row">
              <Scale size={21} aria-hidden="true" />
              وزن امروز
            </h2>
            <IconButton
              label="ثبت سریع وزن"
              onClick={() => {
                setWeight(
                  latest ? String(+fromKg(latest.weightKg, settings.weightUnit).toFixed(2)) : '',
                );
                setWeightOpen(true);
              }}
            >
              <Plus size={20} aria-hidden="true" />
            </IconButton>
          </div>
          <div>
            <span className="metric text-4xl">
              {latest ? n(fromKg(latest.weightKg, settings.weightUnit), 1) : 'ثبت نشده'}
            </span>
            <span className="muted small ms-2">
              {settings.weightUnit === 'kg' ? 'کیلوگرم' : 'پوند'}
            </span>
          </div>
          <div className="row justify-between small">
            <span className="muted">
              هدف {profile ? n(fromKg(profile.goalWeightKg, settings.weightUnit), 1) : 'ثبت نشده'}
            </span>
            <Link to="/health/weight" className="row text-[var(--primary-strong)]">
              روند وزن
              <ArrowUpLeft size={16} aria-hidden="true" />
            </Link>
          </div>
        </Card>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card className="stack">
          <div className="row justify-between">
            <h2 className="row">
              <span className="tone-icon tone-orange">
                <Flame size={23} aria-hidden="true" />
              </span>
              انرژی روز
            </h2>
            <Link to="/health/diet" aria-label="باز کردن تغذیه" className="icon-btn border-0">
              <ArrowUpLeft size={20} aria-hidden="true" />
            </Link>
          </div>
          <div>
            <strong className="text-3xl">{n(consumed.calories)}</strong>
            <span className="muted small ms-2">
              از {target ? n(target.calories) : 'هدف نامشخص'} کیلوکالری
            </span>
          </div>
          <Progress
            value={consumed.calories}
            max={target?.calories ?? 0}
            label="کالری روز"
            color="var(--orange)"
          />
          <div className="grid grid-cols-3 gap-3 pt-1">
            {(
              [
                ['protein', 'پروتئین'],
                ['carbs', 'کربوهیدرات'],
                ['fat', 'چربی'],
              ] as const
            ).map(([k, l]) => (
              <div key={k}>
                <p className="muted text-xs">{l}</p>
                <p className="small font-semibold">
                  {n(consumed[k])}
                  <span className="muted font-normal"> / {target ? n(target[k]) : '…'}</span>
                </p>
              </div>
            ))}
          </div>
        </Card>
        <Card className="stack">
          <div className="row justify-between">
            <h2 className="row">
              <span className="tone-icon tone-blue">
                <Droplets size={23} aria-hidden="true" />
              </span>
              یک لیوان آرامش
            </h2>
            <span className="badge">{n(Math.floor((day?.waterMl ?? 0) / 250))} لیوان</span>
          </div>
          <div>
            <strong className="text-3xl">{n((day?.waterMl ?? 0) / 1000, 2)}</strong>
            <span className="muted small ms-2">
              از {n((profile?.waterGoalMl ?? 2000) / 1000, 1)} لیتر
            </span>
          </div>
          <Progress
            value={day?.waterMl ?? 0}
            max={profile?.waterGoalMl ?? 2000}
            label="آب روزانه"
            color="var(--blue)"
          />
          <div className="row">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => void run(() => changeWater(date, 250))}
            >
              + {n(250)} میلی‌لیتر
            </Button>
            <Button
              variant="ghost"
              onClick={() => void run(() => changeWater(date, -250))}
              aria-label="کم کردن یک لیوان آب"
            >
              −
            </Button>
          </div>
        </Card>
        <Card className="stack">
          <div className="row justify-between">
            <h2 className="row">
              <span className="tone-icon tone-violet">
                <Dumbbell size={23} aria-hidden="true" />
              </span>
              وقت حرکت
            </h2>
            <Link to="/health/exercise" className="icon-btn border-0" aria-label="باز کردن ورزش">
              <ArrowUpLeft size={20} aria-hidden="true" />
            </Link>
          </div>
          <strong className="text-xl">
            {workouts.some((w) => w.date === date)
              ? `${n(workouts.filter((w) => w.date === date).reduce((s, w) => s + w.duration, 0))} دقیقه فعالیت`
              : day?.restDay
                ? 'روز استراحت شما'
                : 'یک قدم کوچک بردارید'}
          </strong>
          <p className="muted small">
            {workouts.some((w) => w.date === date)
              ? 'فعالیت این روز ثبت شده است.'
              : 'حتی یک پیاده‌روی کوتاه هم به حساب می‌آید.'}
          </p>
          <Link to="/health/exercise" className="btn btn-secondary mt-auto">
            {workouts.some((w) => w.date === date) ? 'مشاهدهٔ تمرین‌ها' : 'ثبت فعالیت'}
          </Link>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.45fr_1fr]">
        <Card className="stack">
          <div className="row justify-between">
            <h2>چک‌لیست شما</h2>
            <Link
              to="/habits"
              className="small text-[var(--primary-strong)] min-h-11 flex items-center"
            >
              همهٔ عادت‌ها
              <ChevronLeft size={16} aria-hidden="true" />
            </Link>
          </div>
          {scheduled.length ? (
            scheduled.map((h) => {
              const cfg = habitAtDate(h, date)!;
              const log = habitLogs.find((l) => l.habitId === h.id && l.date === date);
              const done = !!log && log.value >= log.target;
              return (
                <button
                  type="button"
                  className="row justify-between py-3 border-b border-[var(--line)] last:border-0 text-start"
                  key={h.id}
                  onClick={() =>
                    void run(() => setHabitValue(h, date, done ? 0 : (log?.target ?? cfg.target)))
                  }
                  aria-pressed={done}
                >
                  <span className="row">
                    <span
                      className={`w-6 h-6 rounded-lg border grid place-items-center ${done ? 'bg-[var(--primary)] border-[var(--primary)] text-white' : 'border-[var(--muted)]'}`}
                    >
                      {done && <Check size={17} aria-hidden="true" />}
                    </span>
                    <span className={done ? 'muted line-through' : ''}>{cfg.name}</span>
                  </span>
                  <span className="muted small">
                    {n(log?.value ?? 0)} / {n(log?.target ?? cfg.target)} {cfg.unit}
                  </span>
                </button>
              );
            })
          ) : (
            <p className="muted small">
              برای این روز عادتی در برنامه نیست. از چک‌لیست، روزهای انجام را انتخاب کنید.
            </p>
          )}
        </Card>
        <div className="stack">
          <Card>
            <div className="row justify-between">
              <div>
                <p className="muted small">زنجیرهٔ روزهای کامل</p>
                <p className="metric">
                  {n(streak)} <span className="text-base font-normal">روز</span>
                </p>
              </div>
              <span className="tone-icon tone-orange">
                <Flame size={26} aria-hidden="true" />
              </span>
            </div>
            <p className="muted small mt-3">
              {streak
                ? 'این پیوستگی را با یک قدم ساده ادامه دهید.'
                : 'از امروز شروع کنید؛ روزهای بدون برنامه زنجیره را نمی‌شکنند.'}
            </p>
          </Card>
          <Card className="grid grid-cols-2 gap-4">
            <Stat icon={Footprints} label="قدم‌های روز" value={n(day?.steps ?? 0)} />
            <Stat
              icon={Moon}
              label="خواب"
              value={
                day?.sleepHours === null || day?.sleepHours === undefined
                  ? 'ثبت نشده'
                  : `${n(day.sleepHours, 1)} ساعت`
              }
            />
            <Link
              to="/health/journal"
              className="small text-[var(--primary-strong)] col-span-2 row justify-between"
            >
              حال و یادداشت روز
              <ChevronLeft size={17} aria-hidden="true" />
            </Link>
          </Card>
        </div>
      </div>
      <p className="row justify-center muted small py-3">
        <Sun size={17} aria-hidden="true" />
        {
          [
            'قرار نیست بی‌نقص باشید؛ فقط دوباره شروع کنید.',
            'پیشرفت همیشه خط مستقیم نیست.',
            'قدم کوچک امروز، از تصمیم بزرگ فردا نزدیک‌تر است.',
          ][Number(date.slice(-2)) % 3]
        }
      </p>
      {celebrate && !reduced && (
        <div className="fixed inset-0 z-50 pointer-events-none overflow-hidden" aria-hidden="true">
          {Array.from({ length: 28 }, (_, i) => (
            <motion.span
              key={i}
              className="absolute w-2 h-4 rounded-sm"
              style={{
                left: `${(i * 37) % 100}%`,
                background: ['#087f80', '#2a78d6', '#eb6834', '#a1e5cf'][i % 4],
              }}
              initial={{ y: -20, rotate: 0, opacity: 1 }}
              animate={{ y: '100vh', rotate: i % 2 ? 350 : -300, opacity: 0 }}
              transition={{ duration: 1.5 + (i % 5) * 0.1, delay: (i % 7) * 0.07 }}
            />
          ))}
        </div>
      )}
      <Modal
        open={weightOpen}
        title="ثبت سریع وزن"
        onClose={() => {
          if (!busy) setWeightOpen(false);
        }}
      >
        <form className="stack" onSubmit={(e) => void saveWeight(e)}>
          <label className="field">
            <span>وزن ({settings.weightUnit === 'kg' ? 'کیلوگرم' : 'پوند'})</span>
            <input
              type="number"
              step="any"
              min={1}
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              required
              autoFocus
            />
          </label>
          <p className="muted small">برای {formatDate(date, settings)} ثبت می‌شود.</p>
          <Button type="submit" disabled={busy}>
            ذخیره وزن
          </Button>
        </form>
      </Modal>
    </div>
  );
}
