import { useEffect, useRef, useState } from 'react';
import {
  Apple,
  Coffee,
  Droplets,
  Flame,
  Moon,
  Pencil,
  Plus,
  Search,
  Star,
  Sun,
  Trash2,
  Utensils,
} from 'lucide-react';
import {
  Button,
  Card,
  Confirm,
  EmptyState,
  Field,
  IconButton,
  PageHeader,
  Progress,
  Segments,
} from '../../components/ui';
import DataChart from '../../components/DataChart';
import { useData } from '../../hooks/useData';
import { changeWater, updateDay } from '../../db';
import type { Food, MealEntry, MealType } from '../../db/types';
import { formatDate } from '../../lib/dates';
import { formatNumber } from '../../lib/format';
import { useUI, run } from '../../store/ui';
import {
  buildDietCharts,
  dietTargets,
  libraryFoods,
  summarizeDay,
  type LibraryView,
  type NutritionDraft,
} from './dietLogic';
import {
  deleteFood,
  deleteMeal,
  toggleFavorite,
  toggleMealCheat,
  type FoodDraft,
  type MealDraft,
} from './dietWrites';
import NutritionEditor from './NutritionEditor';

const blank: NutritionDraft = { name: '', calories: '', protein: '', carbs: '', fat: '' };
const mealTypes = [
  { value: 'breakfast', label: 'صبحانه', icon: Coffee, color: 'orange' },
  { value: 'lunch', label: 'ناهار', icon: Sun, color: 'teal' },
  { value: 'dinner', label: 'شام', icon: Moon, color: 'violet' },
  { value: 'snack', label: 'میان‌وعده', icon: Apple, color: 'rose' },
] as const;
const macros = [
  ['protein', 'پروتئین'],
  ['carbs', 'کربوهیدرات'],
  ['fat', 'چربی'],
] as const;
type Editor = { kind: 'meal' | 'food'; draft: MealDraft | FoodDraft };
type Deletion = { kind: 'meal' | 'food'; id: string; name: string };
const nutritionDraft = (record: Food | MealEntry): NutritionDraft => ({
  name: record.name,
  calories: String(record.calories),
  protein: String(record.protein),
  carbs: String(record.carbs),
  fat: String(record.fat),
});

export default function DietPage() {
  const { meals, foods, days, weights, profile, settings } = useData();
  const { date } = useUI();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [deleting, setDeleting] = useState<Deletion | null>(null);
  const [search, setSearch] = useState('');
  const [view, setView] = useState<LibraryView>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  const summary = summarizeDay(meals, date);
  const targets = dietTargets(profile, weights, date);
  const day = days.find((record) => record.date === date);
  const charts = buildDietCharts(meals, date, settings, targets?.calories ?? null);
  const library = libraryFoods(foods, search, view);
  const n = (value: number) => formatNumber(value, settings, Number.isInteger(value) ? 0 : 1);
  const waterGoal = profile && profile.waterGoalMl > 0 ? profile.waterGoalMl : null;
  const recordedDays = charts.daily.reduce((count, row) => count + row.recordedDays, 0);
  const cheat = !!day?.cheatMeal || summary.hasCheatMeal;

  // The shared modal may autofocus before its effect captures the opener.
  // Capture before mounting and restore after the child dialog has unmounted.
  useEffect(() => {
    if (!editor && !deleting && opener.current?.isConnected) opener.current.focus();
  }, [editor, deleting]);

  function rememberFocus() {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setError('');
  }
  function openEditor(next: Editor) {
    rememberFocus();
    setEditor(next);
  }
  function openDeletion(next: Deletion) {
    rememberFocus();
    setDeleting(next);
  }
  function addMeal(meal: MealType = 'breakfast', food?: Food) {
    openEditor({
      kind: 'meal',
      draft: {
        ...(food ? nutritionDraft(food) : blank),
        date,
        meal,
        cheat: false,
        ...(food ? { foodId: food.id, usedFood: true } : {}),
      },
    });
  }
  async function action(
    write: () => Promise<unknown>,
    failure = 'ثبت انجام نشد. دوباره تلاش کنید.',
  ) {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError('');
    const ok = await run(write);
    lock.current = false;
    setBusy(false);
    if (!ok) setError(failure);
    return ok;
  }
  async function confirmDeletion() {
    if (!deleting || lock.current) return;
    const chosen = deleting;
    const ok = await action(
      () => (chosen.kind === 'food' ? deleteFood(chosen.id) : deleteMeal(chosen.id)),
      'حذف انجام نشد. دوباره تلاش کنید یا انصراف دهید.',
    );
    if (ok) setDeleting(null);
  }

  return (
    <main dir="rtl" className="stack">
      <PageHeader
        title="تغذیه، با آگاهی"
        subtitle={`وعده‌های ${formatDate(date, settings)}؛ قرار نیست هر روز بی‌نقص باشد.`}
        action={
          <Button disabled={busy} onClick={() => addMeal()}>
            <Plus size={18} aria-hidden="true" />
            ثبت غذا
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Card className="stack">
          <div className="row flex-wrap justify-between">
            <div className="row">
              <span className="tone-icon tone-orange">
                <Flame size={23} aria-hidden="true" />
              </span>
              <div>
                <h2>انرژی روز انتخاب‌شده</h2>
                <p className="muted small">مجموع کیلوکالری ثبت‌شده</p>
              </div>
            </div>
            <strong className="metric">
              <bdi>{n(summary.totals.calories)}</bdi>
            </strong>
          </div>
          {targets ? (
            <>
              <Progress
                value={summary.totals.calories}
                max={targets.calories}
                label="کالری روز انتخاب‌شده"
              />
              <p className="muted small">
                برآورد روزانه {n(targets.calories)} کیلوکالری؛{' '}
                {summary.totals.calories > targets.calories
                  ? `${n(summary.totals.calories - targets.calories)} کیلوکالری بیشتر از برآورد`
                  : `${n(targets.calories - summary.totals.calories)} کیلوکالری تا برآورد`}
              </p>
            </>
          ) : (
            <p className="banner">
              برآورد کالری در دسترس نیست. مشخصات پروفایل یا شرایط ویژه ممکن است مانع محاسبه باشد؛
              ثبت غذا همچنان فعال است.
            </p>
          )}
          <div className="grid grid-cols-1 gap-4 min-[400px]:grid-cols-3">
            {macros.map(([key, label]) => (
              <div key={key} className="stack gap-2">
                <span className="muted small">{label}</span>
                <strong>
                  {n(summary.totals[key])}{' '}
                  <span className="muted small font-normal">
                    گرم{targets && ` از برآورد ${n(targets[key])}`}
                  </span>
                </strong>
                {targets && (
                  <Progress value={summary.totals[key]} max={targets[key]} label={label} />
                )}
              </div>
            ))}
          </div>
          {!summary.entries.length && (
            <p className="muted small">
              این روز هنوز وعدهٔ ثبت‌شده ندارد؛ صفر نمایش‌داده‌شده مجموع ثبت‌هاست، نه مصرف واقعی.
            </p>
          )}
          <p className="muted small">
            درشت‌مغذی‌ها اختیاری‌اند و مقدار خالی صفر ذخیره می‌شود؛ مجموع درشت‌مغذی‌ها ممکن است ناقص
            باشد.
          </p>
          <p className="small muted">
            برآورد بر پایهٔ پروفایل فعلی و آخرین وزن تا روز انتخاب‌شده است، نه برنامهٔ تاریخی یا
            توصیهٔ پزشکی. اگر وزنی ثبت نشده باشد، وزن شروع پروفایل مبناست. کالری ورزش از غذا کم
            نمی‌شود.
          </p>
        </Card>
        <Card className="stack">
          <div className="row flex-wrap justify-between">
            <h2 className="row">
              <Droplets size={23} className="text-[var(--blue)]" aria-hidden="true" />
              آب روز انتخاب‌شده
            </h2>
            <strong>
              {n(day?.waterMl ?? 0)} <span className="muted small font-normal">میلی‌لیتر</span>
            </strong>
          </div>
          {waterGoal !== null && (
            <Progress
              value={day?.waterMl ?? 0}
              max={waterGoal}
              label="آب روز انتخاب‌شده"
              color="var(--blue)"
            />
          )}
          <p className="muted small">
            {waterGoal !== null
              ? `هدف روزانه ${n(waterGoal)} میلی‌لیتر`
              : 'هدف آب تعیین نشده است؛ در تنظیمات آن را انتخاب کنید.'}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {[250, 500].map((value) => (
              <Button
                variant="secondary"
                key={value}
                aria-label={`افزودن ${n(value)} میلی‌لیتر آب`}
                disabled={busy}
                onClick={() =>
                  void action(() => changeWater(date, value), 'آب ثبت نشد. دوباره تلاش کنید.')
                }
              >
                <bdi dir="ltr">+{n(value)}</bdi> میلی‌لیتر
              </Button>
            ))}
            {[250, 500].map((value) => (
              <Button
                variant="ghost"
                key={-value}
                aria-label={`کاهش ${n(value)} میلی‌لیتر آب`}
                disabled={busy}
                onClick={() =>
                  void action(() => changeWater(date, -value), 'آب ثبت نشد. دوباره تلاش کنید.')
                }
              >
                <bdi dir="ltr">−{n(value)}</bdi> میلی‌لیتر
              </Button>
            ))}
          </div>
        </Card>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {mealTypes.map(({ value, label, icon: Icon, color }) => (
          <Card key={value} aria-label={label} className="stack">
            <div className="row justify-between">
              <h2 className="row">
                <span className={`tone-icon tone-${color}`}>
                  <Icon size={21} aria-hidden="true" />
                </span>
                {label}
              </h2>
              <IconButton label={`افزودن ${label}`} disabled={busy} onClick={() => addMeal(value)}>
                <Plus size={20} aria-hidden="true" />
              </IconButton>
            </div>
            {summary.groups[value].entries.length ? (
              <div>
                {summary.groups[value].entries.map((entry) => (
                  <article key={entry.id} className="list-item">
                    <div className="row flex-wrap justify-between items-start">
                      <div className="min-w-0 flex-1 break-words">
                        <h3>
                          <bdi>{entry.name}</bdi>
                        </h3>
                        <p className="muted small">{n(entry.calories)} کیلوکالری</p>
                        <p className="muted small">
                          پروتئین: {n(entry.protein)}؛ کربوهیدرات: {n(entry.carbs)}؛ چربی:{' '}
                          {n(entry.fat)} گرم
                        </p>
                        {entry.cheat && <span className="badge">وعدهٔ آزاد</span>}
                      </div>
                      <div className="row gap-2">
                        <IconButton
                          label={`ویرایش ${entry.name}`}
                          disabled={busy}
                          onClick={() =>
                            openEditor({
                              kind: 'meal',
                              draft: {
                                id: entry.id,
                                date: entry.date,
                                meal: entry.meal,
                                cheat: entry.cheat,
                                foodId: entry.foodId,
                                ...nutritionDraft(entry),
                              },
                            })
                          }
                        >
                          <Pencil size={16} aria-hidden="true" />
                        </IconButton>
                        <IconButton
                          label={`حذف ${entry.name}`}
                          disabled={busy}
                          onClick={() =>
                            openDeletion({ kind: 'meal', id: entry.id, name: entry.name })
                          }
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </IconButton>
                      </div>
                    </div>
                    <Button
                      className="small"
                      variant="ghost"
                      aria-label={`علامت وعدهٔ آزاد برای ${entry.name}`}
                      aria-pressed={entry.cheat}
                      disabled={busy}
                      onClick={() => void action(() => toggleMealCheat(entry.id))}
                    >
                      {entry.cheat ? 'حذف علامت وعدهٔ آزاد' : 'وعدهٔ آزاد'}
                    </Button>
                  </article>
                ))}
              </div>
            ) : (
              <p className="muted small py-4">هنوز غذایی برای این وعده ثبت نشده است.</p>
            )}
            <div
              className="small muted border-t border-[var(--line)] pt-3"
              aria-label={`مجموع ${label}`}
            >
              <p>مجموع {n(summary.groups[value].totals.calories)} کیلوکالری</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {macros.map(([key, macroLabel]) => (
                  <p key={key}>
                    {macroLabel} {n(summary.groups[value].totals[key])} گرم
                  </p>
                ))}
              </div>
            </div>
          </Card>
        ))}
      </div>
      <Card className="stack">
        <div className="row justify-between flex-wrap">
          <h2>پایبندی به برنامه</h2>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void action(() => updateDay(date, { adherence: null }))}
          >
            پاک کردن وضعیت پایبندی
          </Button>
        </div>
        <div className="row flex-wrap" role="group" aria-label="وضعیت پایبندی">
          {(
            [
              ['full', 'کامل'],
              ['partial', 'نسبی'],
              ['off', 'خارج از برنامه'],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              variant={day?.adherence === value ? 'primary' : 'secondary'}
              aria-pressed={day?.adherence === value}
              disabled={busy}
              onClick={() => void action(() => updateDay(date, { adherence: value }))}
            >
              {label}
            </Button>
          ))}
        </div>
        <Button
          variant="secondary"
          aria-label="علامت روزانهٔ وعدهٔ آزاد"
          aria-pressed={day?.cheatMeal ?? false}
          disabled={busy}
          onClick={() => void action(() => updateDay(date, { cheatMeal: !day?.cheatMeal }))}
        >
          {day?.cheatMeal ? 'برداشتن علامت روزانهٔ وعدهٔ آزاد' : 'علامت روزانهٔ وعدهٔ آزاد'}
        </Button>
        <p role="status" aria-label="خلاصهٔ وعدهٔ آزاد" className="small">
          {cheat ? 'این روز دارای وعدهٔ آزاد است.' : 'برای این روز وعدهٔ آزاد ثبت نشده است.'}
        </p>
        <p className="small muted">
          علامت روزانه مستقل از علامت هر وعده است. خلاصهٔ روز هر دو را در نظر می‌گیرد.
        </p>
      </Card>
      <Card className="stack">
        <div className="row flex-wrap justify-between">
          <h2>کتابخانهٔ غذا</h2>
          <IconButton
            label="افزودن غذای کتابخانه"
            disabled={busy}
            onClick={() => openEditor({ kind: 'food', draft: { ...blank } })}
          >
            <Plus size={20} aria-hidden="true" />
          </IconButton>
        </div>
        <p className="muted small">
          مقادیر برای هر سهم ذخیره‌شده است، نه لزوماً صد گرم. پیش از ذخیرهٔ وعده، نام و مقادیر را
          متناسب با مصرف خود تغییر دهید.
        </p>
        <Field label="جست‌وجوی غذا">
          <div className="relative">
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pe-11"
            />
            <Search
              size={20}
              className="absolute end-3 top-3 text-[var(--muted)]"
              aria-hidden="true"
            />
          </div>
        </Field>
        <Segments
          value={view}
          onChange={setView}
          label="نمای کتابخانه"
          options={[
            { value: 'all', label: 'همه' },
            { value: 'favorites', label: 'علاقه‌مندی‌ها' },
            { value: 'recent', label: 'اخیراً استفاده‌شده' },
          ]}
        />
        {library.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {library.map((food) => (
              <article
                key={food.id}
                className="rounded-2xl border border-[var(--line)] p-4 stack gap-2"
              >
                <div className="row justify-between">
                  <h3 className="min-w-0 break-words">
                    <bdi>{food.name}</bdi>
                  </h3>
                  <IconButton
                    label={`علاقه‌مندی ${food.name}`}
                    aria-pressed={food.favorite}
                    disabled={busy}
                    onClick={() => void action(() => toggleFavorite(food.id))}
                  >
                    <Star
                      size={18}
                      fill={food.favorite ? 'currentColor' : 'none'}
                      aria-hidden="true"
                    />
                  </IconButton>
                </div>
                <p className="small muted">{n(food.calories)} کیلوکالری در هر سهم</p>
                <p className="small muted">
                  پروتئین: {n(food.protein)}؛ کربوهیدرات: {n(food.carbs)}؛ چربی: {n(food.fat)} گرم
                </p>
                <div className="row flex-wrap gap-2">
                  <Button
                    className="flex-1"
                    variant="secondary"
                    disabled={busy}
                    aria-label={`ثبت وعده با ${food.name}`}
                    onClick={() => addMeal('breakfast', food)}
                  >
                    ثبت وعده
                  </Button>
                  <IconButton
                    label={`ویرایش غذای ${food.name}`}
                    disabled={busy}
                    onClick={() =>
                      openEditor({ kind: 'food', draft: { id: food.id, ...nutritionDraft(food) } })
                    }
                  >
                    <Pencil size={17} aria-hidden="true" />
                  </IconButton>
                  <IconButton
                    label={`حذف غذای ${food.name}`}
                    disabled={busy}
                    onClick={() => openDeletion({ kind: 'food', id: food.id, name: food.name })}
                  >
                    <Trash2 size={17} aria-hidden="true" />
                  </IconButton>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Utensils}
            title={
              view === 'recent' && !search
                ? 'هنوز از غذای ذخیره‌شده‌ای استفاده نکرده‌اید'
                : view === 'favorites' && !search
                  ? 'هنوز غذای موردعلاقه‌ای ندارید'
                  : 'غذایی پیدا نشد'
            }
            description={
              search
                ? 'عبارت جست‌وجو را تغییر دهید یا غذای تازه‌ای اضافه کنید.'
                : 'یک غذای پرمصرف اضافه کنید تا دفعات بعد ثبت آن آسان‌تر باشد.'
            }
            action={
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => openEditor({ kind: 'food', draft: { ...blank } })}
              >
                غذای جدید
              </Button>
            }
          />
        )}
      </Card>
      <section className="stack" aria-label="روند کالری">
        <h2>روند کالری تا روز انتخاب‌شده</h2>
        <p className="small muted">
          ثبت یک وعده به معنی ثبت کامل روز نیست؛ روزهای بدون داده، صفر فرض نمی‌شوند. برآورد هر هفته
          بر اساس روزهای سپری‌شدهٔ آن هفته است، نه فقط روزهای دارای ثبت.
        </p>
        <p className="small">
          روزهای دارای ثبت در هفت روز گذشته: {n(recordedDays)} از {n(charts.daily.length)}
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="stack">
            <h3>کالری روزانه</h3>
            {charts.daily.some((row) => row.calories !== null) ? (
              <DataChart
                title="کالری روزانه در هفت روز گذشته"
                data={charts.daily}
                series={[{ key: 'calories', label: 'کالری ثبت‌شده', type: 'bar' }]}
                goal={targets?.calories}
                goalLabel="برآورد روزانهٔ فعلی"
                valueFormatter={n}
              />
            ) : (
              <EmptyState
                icon={Flame}
                title="هنوز وعده‌ای در این بازه ثبت نشده است"
                description="با ثبت اولین وعده، مقایسهٔ روزانه ظاهر می‌شود."
                action={
                  <Button disabled={busy} onClick={() => addMeal()}>
                    ثبت وعده
                  </Button>
                }
              />
            )}
          </Card>
          <Card className="stack">
            <h3>کالری هفتگی</h3>
            {charts.weekly.some((row) => row.calories !== null) ? (
              <DataChart
                title="کالری هفتگی در هشت هفته گذشته"
                data={charts.weekly}
                series={[
                  { key: 'calories', label: 'کالری ثبت‌شده', type: 'bar' },
                  ...(targets
                    ? [{ key: 'target', label: 'برآورد روزهای سپری‌شده', dashed: true }]
                    : []),
                ]}
                valueFormatter={n}
              />
            ) : (
              <EmptyState
                icon={Flame}
                title="هنوز وعده‌ای در این بازه ثبت نشده است"
                description="مجموع هفتهٔ جاری فقط روزهای سپری‌شده را در نظر می‌گیرد."
                action={
                  <Button disabled={busy} onClick={() => addMeal()}>
                    ثبت وعده
                  </Button>
                }
              />
            )}
          </Card>
        </div>
        {charts.weekly.some((row) => row.calories !== null) && (
          <details className="small">
            <summary>پوشش ثبت هفتگی</summary>
            <div
              className="chart-table"
              role="region"
              aria-label="جدول پوشش ثبت هفتگی"
              tabIndex={0}
            >
              <table aria-label="پوشش ثبت هفتگی">
                <thead>
                  <tr>
                    <th scope="col">هفته</th>
                    <th scope="col">روزهای دارای ثبت از روزهای سپری‌شده</th>
                  </tr>
                </thead>
                <tbody>
                  {charts.weekly.map((row) => (
                    <tr key={row.date}>
                      <th scope="row">
                        <bdi>{formatDate(row.date, settings)}</bdi> تا{' '}
                        <bdi>{formatDate(row.endDate, settings)}</bdi>
                      </th>
                      <td>
                        {n(row.recordedDays)} از {n(row.elapsedDays)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </section>
      {error && (
        <p role="alert" className="banner">
          {error}
        </p>
      )}
      {editor && (
        <NutritionEditor
          initial={editor.draft}
          kind={editor.kind}
          onClose={() => setEditor(null)}
        />
      )}
      <Confirm
        open={!!deleting}
        danger
        title={deleting?.kind === 'food' ? 'حذف غذای کتابخانه' : 'حذف وعده'}
        description={`«${deleting?.name ?? ''}» حذف شود؟ ${deleting?.kind === 'food' ? 'همهٔ وعده‌های قبلی و مقادیرشان باقی می‌مانند؛ فقط ارتباط آن‌ها با کتابخانه برداشته می‌شود.' : 'این وعده از روز ثبت‌شده حذف می‌شود.'} ${busy ? 'در حال حذف…' : error}`}
        onClose={() => {
          if (!lock.current) {
            setDeleting(null);
            setError('');
          }
        }}
        onConfirm={() => void confirmDeletion()}
      />
    </main>
  );
}
