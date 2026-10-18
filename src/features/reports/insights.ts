import type { AppData } from '../../db/types';
import { addDays, dateRange } from '../../lib/dates';
import { dayCompletion, bestHabitStreak, movingAverage } from '../../lib/calculations';
export function periodSummary(data: AppData, start: string, end: string) {
  const inRange = (date: string) => date >= start && date <= end;
  const days = data.days.filter((d) => inRange(d.date));
  const diet = days.filter((d) => d.adherence !== null);
  const completion = dateRange(start, end).map((date) =>
    dayCompletion(data.habits, data.habitLogs, date),
  );
  const scheduled = completion.reduce((s, c) => s + c.total, 0);
  const done = completion.reduce((s, c) => s + c.done, 0);
  const meals = data.meals.filter((m) => inRange(m.date));
  const mealDays = new Set(meals.map((m) => m.date)).size;
  const sleeps = days.filter((d) => d.sleepHours !== null);
  const weights = movingAverage(data.weights.filter((w) => inRange(w.date)));
  return {
    dietDays: diet.length,
    adherence: diet.length
      ? Math.round(
          (diet.reduce(
            (s, d) => s + (d.adherence === 'full' ? 1 : d.adherence === 'partial' ? 0.5 : 0),
            0,
          ) /
            diet.length) *
            100,
        )
      : null,
    habitPercent: scheduled ? Math.round((done / scheduled) * 100) : null,
    completedDays: completion.filter((c) => c.total > 0 && c.done === c.total).length,
    workouts: data.workouts.filter((w) => inRange(w.date)).length,
    minutes: data.workouts.filter((w) => inRange(w.date)).reduce((s, w) => s + w.duration, 0),
    steps: days.reduce((s, d) => s + d.steps, 0),
    averageSleep: sleeps.length
      ? sleeps.reduce((s, d) => s + (d.sleepHours ?? 0), 0) / sleeps.length
      : null,
    averageCalories: mealDays ? meals.reduce((s, m) => s + m.calories, 0) / mealDays : null,
    mealDays,
    weightChange: weights.length > 1 ? weights.at(-1)!.weightKg - weights[0].weightKg : null,
  };
}
export function bestDayStreak(data: AppData, asOf: string): number {
  const start = data.habits.map((h) => h.createdAt).sort()[0];
  if (!start) return 0;
  let best = 0,
    current = 0;
  for (const date of dateRange(start, asOf)) {
    const c = dayCompletion(data.habits, data.habitLogs, date);
    if (!c.total) continue;
    current = c.done === c.total ? current + 1 : 0;
    best = Math.max(best, current);
  }
  return best;
}
export function achievements(data: AppData, asOf: string) {
  const days = new Set(
    [
      ...data.days.map((d) => d.date),
      ...data.weights.map((w) => w.date),
      ...data.habitLogs.map((l) => l.date),
    ].filter((d) => d <= asOf),
  );
  const best = bestDayStreak(data, asOf);
  const weights = movingAverage(data.weights.filter((w) => w.date <= asOf));
  const first = data.profile?.startWeightKg ?? weights[0]?.weightKg;
  const last = weights.at(-1)?.weightKg;
  const goal = data.profile?.goalWeightKg;
  const total = first !== undefined && goal !== undefined ? Math.abs(first - goal) : 0;
  const progress =
    first !== undefined && last !== undefined && goal !== undefined
      ? (first - goal) * (first - last) > 0
        ? Math.abs(first - last)
        : 0
      : 0;
  const result = [
    {
      id: 'week',
      title: 'اولین هفته',
      description: 'ثبت اطلاعات در هفت روز متفاوت',
      earned: days.size >= 7,
    },
    {
      id: 'streak7',
      title: 'هفت روز پیوسته',
      description: 'تکمیل همهٔ عادت‌های برنامه‌ریزی‌شده',
      earned: best >= 7,
    },
    {
      id: 'streak30',
      title: 'سی روز پیوسته',
      description: 'یک زنجیرهٔ سی‌روزهٔ کامل',
      earned: best >= 30,
    },
    {
      id: 'half',
      title: 'نیمهٔ راه',
      description: 'پنجاه درصد مسیر وزن هدف',
      earned: total > 0 && progress >= total * 0.5,
    },
    {
      id: 'goal',
      title: 'رسیدن به هدف',
      description: 'رسیدن به وزن هدف ثبت‌شده',
      earned: total > 0 && progress >= total,
    },
  ];
  for (
    let i = 1;
    i <=
    Math.max(
      3,
      Math.min(20, Math.floor(first !== undefined && last !== undefined ? first - last : 0) + 1),
    );
    i++
  )
    result.push({
      id: `kg-${i}`,
      title: `${i} کیلوگرم تغییر`,
      description: `کاهش دست‌کم ${i} کیلوگرم از وزن شروع`,
      earned: first !== undefined && last !== undefined && first - last >= i,
    });
  return result;
}
export function bestHabits(data: AppData, asOf: string) {
  return data.habits
    .map((h) => ({ id: h.id, name: h.name, streak: bestHabitStreak(h, data.habitLogs, asOf) }))
    .sort((a, b) => b.streak - a.streak)
    .slice(0, 5);
}
export function correlationHint(data: AppData, asOf: string): string {
  const rows = movingAverage(
    data.weights.filter((w) => w.date <= asOf && w.date >= addDays(asOf, -90)),
  );
  const pairs: { x: number; y: number }[] = [];
  for (const row of rows) {
    const next = rows.find(
      (w) => w.date >= addDays(row.date, 7) && w.date <= addDays(row.date, 10),
    );
    const day = data.days.find((d) => d.date === row.date);
    if (next && day?.adherence)
      pairs.push({
        x: day.adherence === 'full' ? 1 : day.adherence === 'partial' ? 0.5 : 0,
        y: next.trend - row.trend,
      });
  }
  if (pairs.length < 10)
    return 'برای بررسی همراهی پایبندی و روند وزن، دست‌کم ده روز ثبت هم‌زمان غذا و وزن، با یک هفته سابقهٔ بعدی لازم است.';
  const mx = pairs.reduce((s, p) => s + p.x, 0) / pairs.length,
    my = pairs.reduce((s, p) => s + p.y, 0) / pairs.length;
  const numerator = pairs.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
  const denominator = Math.sqrt(
    pairs.reduce((s, p) => s + (p.x - mx) ** 2, 0) * pairs.reduce((s, p) => s + (p.y - my) ** 2, 0),
  );
  if (!denominator)
    return 'تنوع ثبت‌های پایبندی یا وزن برای مقایسه کافی نیست. ثبت منظم، تصویر روشن‌تری می‌سازد.';
  const r = numerator / denominator;
  return Math.abs(r) < 0.3
    ? 'در ثبت‌های فعلی، همراهی روشنی بین پایبندی غذایی و تغییر وزن هفتهٔ بعد دیده نمی‌شود. این یک مشاهده است، نه نتیجهٔ پزشکی.'
    : r < 0
      ? 'روزهای با پایبندی بیشتر، در ثبت‌های شما با روند پایین‌تر وزن در هفتهٔ بعد همراه بوده‌اند. همبستگی، علت را نشان نمی‌دهد.'
      : 'روزهای با پایبندی بیشتر، در ثبت‌های شما با روند بالاتر وزن در هفتهٔ بعد همراه بوده‌اند. جهت هدف و عوامل دیگر را در نظر بگیرید؛ این رابطه علّی نیست.';
}
