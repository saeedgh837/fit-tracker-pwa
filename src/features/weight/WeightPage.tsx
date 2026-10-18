import { useMemo, useRef, useState } from 'react';
import {
  Activity,
  CalendarClock,
  Pencil,
  Plus,
  Ruler,
  Scale,
  Target,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import DataChart from '../../components/DataChart';
import {
  Button,
  Card,
  Confirm,
  EmptyState,
  IconButton,
  PageHeader,
  Segments,
  Stat,
} from '../../components/ui';
import { db } from '../../db';
import type { MeasurementEntry, WeightEntry } from '../../db/types';
import { useData } from '../../hooks/useData';
import { formatDate, shortDate } from '../../lib/dates';
import { formatNumber, fromKg } from '../../lib/format';
import { run, useUI } from '../../store/ui';
import { MeasurementEditor, WeightEditor } from './WeightForms';
import {
  buildMeasurementSeries,
  buildWeightSeries,
  createMeasurementDraft,
  createWeightDraft,
  measurementFields,
  weightSummary,
  type MeasurementDraft,
  type Range,
  type WeightDraft,
} from './weightLogic';

export default function WeightPage() {
  const { weights, measurements, settings, profile } = useData();
  const { date } = useUI();
  const [range, setRange] = useState<Range>('30');
  const [weightDraft, setWeightDraft] = useState<WeightDraft | null>(null);
  const [measurementDraft, setMeasurementDraft] = useState<MeasurementDraft | null>(null);
  const [deleting, setDeleting] = useState<
    { kind: 'weight'; entry: WeightEntry } | { kind: 'measurement'; entry: MeasurementEntry } | null
  >(null);
  const [deleteError, setDeleteError] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const deleteLock = useRef(false);
  const view = useMemo(
    () => buildWeightSeries(weights, date, range, settings.weightUnit),
    [weights, date, range, settings.weightUnit],
  );
  const summary = useMemo(
    () => weightSummary(weights, profile, date, settings.weightUnit),
    [weights, profile, date, settings.weightUnit],
  );
  const bodyPoints = useMemo(
    () => buildMeasurementSeries(measurements, date, range, settings.heightUnit),
    [measurements, date, range, settings.heightUnit],
  );
  const weightUnit = settings.weightUnit === 'kg' ? 'کیلوگرم' : 'پوند';
  const heightUnit = settings.heightUnit === 'cm' ? 'سانتی‌متر' : 'اینچ';
  const weightValue = (value: number) => `${formatNumber(value, settings, 2)} ${weightUnit}`;
  const heightValue = (value: number) => `${formatNumber(value, settings, 2)} ${heightUnit}`;
  const changeValue = (change: typeof summary.week) =>
    change === null ? (
      'دادهٔ کافی نیست'
    ) : (
      <bdi>
        {change.deltaKg > 0 ? '+' : ''}
        {weightValue(fromKg(change.deltaKg, settings.weightUnit))}
      </bdi>
    );
  const changeDetail = (change: typeof summary.week) =>
    change === null
      ? 'به یک ثبت در یا پیش از مبنای بازه نیاز است.'
      : `${formatDate(change.from, settings)} تا ${formatDate(change.to, settings)}`;
  const newWeight = () => setWeightDraft(createWeightDraft(undefined, date, settings.weightUnit));
  const newMeasurement = () =>
    setMeasurementDraft(createMeasurementDraft(undefined, date, settings.heightUnit));
  async function remove() {
    if (!deleting || deleteLock.current) return;
    const target = deleting;
    deleteLock.current = true;
    setDeleteBusy(true);
    setDeleteError('');
    const ok = await run(
      () =>
        target.kind === 'weight'
          ? db.weights.delete(target.entry.id)
          : db.measurements.delete(target.entry.id),
      'ثبت انتخاب‌شده حذف شد.',
    );
    deleteLock.current = false;
    setDeleteBusy(false);
    if (ok) setDeleting(null);
    else setDeleteError('حذف انجام نشد. ثبت شما همچنان محفوظ است؛ دوباره تلاش کنید.');
  }
  return (
    <div dir="rtl" className="stack">
      <PageHeader
        title="وزن و اندازه‌های بدن"
        subtitle={`روند شما تا ${formatDate(date, settings)}`}
        action={
          <Button onClick={newWeight}>
            <Plus size={18} aria-hidden="true" />
            ثبت وزن
          </Button>
        }
      />
      <section
        aria-label="خلاصه وزن تا روز انتخاب‌شده"
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <Card>
          <Stat
            icon={Scale}
            label="آخرین وزن"
            value={
              summary.latest
                ? weightValue(fromKg(summary.latest.weightKg, settings.weightUnit))
                : 'ثبت نشده'
            }
            detail={
              summary.latest
                ? `${formatDate(summary.latest.date, settings)}، ${summary.latest.time}`
                : 'یک وزن ثبت کنید تا روند شما آغاز شود.'
            }
          />
        </Card>
        <Card>
          <Stat
            icon={Activity}
            label="شاخص تودهٔ بدنی (BMI)"
            value={
              summary.bmi === null ? 'دادهٔ کافی نیست' : formatNumber(summary.bmi, settings, 1)
            }
            detail="بر پایهٔ آخرین وزن و قد پروفایل؛ شاخص کلی، نه تشخیص پزشکی."
          />
        </Card>
        <Card>
          <Stat
            icon={Target}
            label="هدف پروفایل"
            value={summary.goal === null ? 'هدف معتبر ندارید' : weightValue(summary.goal)}
            detail={
              summary.reached
                ? 'به هدف ثبت‌شده رسیده‌اید.'
                : 'هدف و قد از بخش تنظیمات قابل‌ویرایش هستند.'
            }
          />
        </Card>
        <Card>
          <Stat
            icon={CalendarClock}
            label="زمان تخمینی رسیدن به هدف"
            value={
              summary.reached
                ? 'هدف محقق شده'
                : summary.eta
                  ? formatDate(summary.eta, settings)
                  : 'قابل‌برآورد نیست'
            }
            detail={
              profile?.goal === 'maintain'
                ? 'در حالت نگه‌داشت وزن، تاریخ رسیدن تخمین زده نمی‌شود.'
                : 'برآورد روند ثبت‌شده است؛ توصیه یا پیش‌بینی پزشکی نیست.'
            }
          />
        </Card>
      </section>
      <section aria-label="تغییرهای دوره‌ای وزن" className="grid gap-4 sm:grid-cols-2">
        <Card>
          <Stat
            icon={TrendingUp}
            label="تغییر نسبت به ۷ روز قبل"
            value={changeValue(summary.week)}
            detail={changeDetail(summary.week)}
          />
        </Card>
        <Card>
          <Stat
            icon={TrendingUp}
            label="تغییر نسبت به ۳۰ روز قبل"
            value={changeValue(summary.month)}
            detail={changeDetail(summary.month)}
          />
        </Card>
      </section>
      <p className="muted small">
        تغییر دوره‌ای نسبت به آخرین ثبت در یا پیش از ۷ و ۳۰ روز قبل محاسبه می‌شود. تاریخ‌های
        نمایش‌داده‌شده، تاریخ واقعی دو ثبت هستند.
      </p>
      <section aria-label="بازه نمودارها و سوابق" className="stack">
        <Segments
          value={range}
          onChange={setRange}
          label="بازه وزن و اندازه‌ها"
          options={[
            { value: '7', label: '۷ روز' },
            { value: '30', label: '۳۰ روز' },
            { value: '90', label: '۹۰ روز' },
            { value: 'all', label: 'همه' },
          ]}
        />
        <p className="muted small">
          بازهٔ نمودارها و جدول‌ها به روز انتخاب‌شده ختم می‌شود. خلاصه‌ها، آخرین دادهٔ موجود تا همین
          روز را نشان می‌دهند.
        </p>
        <Card className="stack">
          <h2>روند وزن</h2>
          <p className="muted small">
            وزن روزانه از آخرین زمان ثبت هر روز انتخاب می‌شود. میانگین هفت‌روزه بر پایهٔ روزهای
            تقویمی است؛ روز بدون داده صفر نیست. همهٔ ثبت‌ها در جدول سوابق دیده می‌شوند.
          </p>
          {view.points.length ? (
            <DataChart
              title="نمودار وزن و میانگین هفت‌روزه"
              data={view.points.map((point) => ({
                ...point,
                label: shortDate(point.date, settings),
              }))}
              series={[
                { key: 'weight', label: `وزن روزانه (${weightUnit})` },
                { key: 'trend', label: `میانگین هفت‌روزه (${weightUnit})`, dashed: true },
              ]}
              goal={summary.goal ?? undefined}
              goalLabel={`هدف (${weightUnit})`}
              valueFormatter={weightValue}
            />
          ) : (
            <EmptyState
              icon={Scale}
              title="وزنی در این بازه ثبت نشده است"
              description="بازه را تغییر دهید یا اولین وزن خود را ثبت کنید."
              action={<Button onClick={newWeight}>ثبت وزن</Button>}
            />
          )}
        </Card>
        <Card className="stack">
          <h2>سوابق وزن</h2>
          {view.raw.length ? (
            <div
              className="chart-table"
              role="region"
              aria-label="جدول وزن با پیمایش افقی"
              tabIndex={0}
            >
              <table aria-label="سوابق وزن">
                <caption className="muted small text-start pb-3">
                  {formatNumber(view.raw.length, settings)} ثبت؛ مرتب‌شده بر پایهٔ تاریخ، زمان و
                  شناسه
                </caption>
                <thead>
                  <tr>
                    <th scope="col">تاریخ</th>
                    <th scope="col">زمان</th>
                    <th scope="col">وزن ({weightUnit})</th>
                    <th scope="col">یادداشت</th>
                    <th scope="col">عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {view.raw.map((entry) => (
                    <tr key={entry.id}>
                      <th scope="row">{formatDate(entry.date, settings)}</th>
                      <td>
                        <bdi>{entry.time}</bdi>
                      </td>
                      <td>{weightValue(fromKg(entry.weightKg, settings.weightUnit))}</td>
                      <td
                        style={{
                          whiteSpace: 'pre-wrap',
                          minWidth: 120,
                          maxWidth: 280,
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {entry.note || 'بدون یادداشت'}
                      </td>
                      <td>
                        <div className="row">
                          <IconButton
                            label={`ویرایش وزن ${entry.time}`}
                            onClick={() =>
                              setWeightDraft(createWeightDraft(entry, date, settings.weightUnit))
                            }
                          >
                            <Pencil size={18} aria-hidden="true" />
                          </IconButton>
                          <IconButton
                            label={`حذف وزن ${entry.time}`}
                            onClick={() => {
                              setDeleteError('');
                              setDeleting({ kind: 'weight', entry });
                            }}
                          >
                            <Trash2 size={18} aria-hidden="true" />
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">هنوز سابقه‌ای در این بازه ندارید.</p>
          )}
        </Card>
        <div className="row flex-wrap justify-between">
          <h2 className="row">
            <Ruler size={22} aria-hidden="true" />
            اندازه‌های بدن
          </h2>
          <Button variant="secondary" onClick={newMeasurement}>
            <Plus size={18} aria-hidden="true" />
            ثبت اندازه‌ها
          </Button>
        </div>
        <p className="muted small">
          شمارهٔ ثبت‌های هم‌روز فقط برای تمایز است و ترتیب زمانی را نشان نمی‌دهد. اندازهٔ واردنشده،
          در نمودار نقطهٔ صفر نمی‌سازد.
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          {measurementFields.map(({ key, label }) => (
            <Card key={key} className="stack">
              <h3>{label}</h3>
              {bodyPoints.some((point) => point[key] !== null) ? (
                <DataChart
                  title={`نمودار ${label}`}
                  height={220}
                  data={bodyPoints.map((point) => ({
                    label: `${shortDate(point.date, settings)} · ${formatNumber(point.ordinal, settings)}`,
                    [key]: point[key],
                  }))}
                  series={[{ key, label: `${label} (${heightUnit})` }]}
                  valueFormatter={heightValue}
                />
              ) : (
                <EmptyState
                  icon={Ruler}
                  title={`${label} ثبت نشده است`}
                  description="برای این اندازه در بازهٔ انتخاب‌شده داده‌ای ندارید."
                />
              )}
            </Card>
          ))}
        </div>
        <Card className="stack">
          <h2>سوابق اندازه‌های بدن</h2>
          {bodyPoints.length ? (
            <div
              className="chart-table"
              role="region"
              aria-label="جدول اندازه‌ها با پیمایش افقی"
              tabIndex={0}
            >
              <table aria-label="سوابق اندازه‌های بدن">
                <caption className="muted small text-start pb-3">
                  همهٔ ثبت‌ها با واحد {heightUnit}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">تاریخ</th>
                    <th scope="col">ثبت هم‌روز</th>
                    {measurementFields.map((field) => (
                      <th scope="col" key={field.key}>
                        {field.label}
                      </th>
                    ))}
                    <th scope="col">عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {bodyPoints.map((point, index) => (
                    <tr key={point.id}>
                      <th scope="row">{formatDate(point.date, settings)}</th>
                      <td>{formatNumber(point.ordinal, settings)}</td>
                      {measurementFields.map(({ key }) => (
                        <td key={key}>
                          {point[key] === null ? 'ثبت نشده' : heightValue(point[key])}
                        </td>
                      ))}
                      <td>
                        <div className="row">
                          <IconButton
                            label={`ویرایش اندازه‌های ثبت ${formatNumber(index + 1, settings)}`}
                            onClick={() =>
                              setMeasurementDraft(
                                createMeasurementDraft(
                                  measurements.find((entry) => entry.id === point.id),
                                  date,
                                  settings.heightUnit,
                                ),
                              )
                            }
                          >
                            <Pencil size={18} aria-hidden="true" />
                          </IconButton>
                          <IconButton
                            label={`حذف اندازه‌های ثبت ${formatNumber(index + 1, settings)}`}
                            onClick={() => {
                              const entry = measurements.find((x) => x.id === point.id);
                              if (entry) {
                                setDeleteError('');
                                setDeleting({ kind: 'measurement', entry });
                              }
                            }}
                          >
                            <Trash2 size={18} aria-hidden="true" />
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              icon={Ruler}
              title="هنوز اندازه‌ای در این بازه ندارید"
              description="می‌توانید یکی یا همهٔ پنج اندازه را ثبت کنید."
              action={
                <Button variant="secondary" onClick={newMeasurement}>
                  ثبت اندازه‌ها
                </Button>
              }
            />
          )}
        </Card>
      </section>
      {deleteError && (
        <p role="alert" className="banner">
          {deleteError}
        </p>
      )}
      {deleteBusy && (
        <p role="status" className="muted">
          در حال حذف ثبت انتخاب‌شده…
        </p>
      )}
      <Confirm
        open={Boolean(deleting)}
        title={deleting?.kind === 'weight' ? 'حذف ثبت وزن؟' : 'حذف اندازه‌های بدن؟'}
        description={`فقط ثبت انتخاب‌شده در ${deleting ? formatDate(deleting.entry.date, settings) : ''} حذف می‌شود. این کار قابل‌بازگشت نیست.`}
        danger
        onClose={() => {
          if (!deleteLock.current) setDeleting(null);
        }}
        onConfirm={() => {
          void remove();
        }}
      />
      {weightDraft && (
        <WeightEditor
          initial={weightDraft}
          onClose={() => setWeightDraft(null)}
          onSaved={() => setWeightDraft(null)}
        />
      )}
      {measurementDraft && (
        <MeasurementEditor
          initial={measurementDraft}
          onClose={() => setMeasurementDraft(null)}
          onSaved={() => setMeasurementDraft(null)}
        />
      )}
    </div>
  );
}
