import { Field, Segments } from '../../components/ui';
import type { Settings } from '../../db/types';
import type { ProfileDraft } from './profile';
export default function ProfileFields({
  draft,
  setDraft,
  settings,
  step,
}: {
  draft: ProfileDraft;
  setDraft: (draft: ProfileDraft) => void;
  settings: Settings;
  step?: number;
}) {
  const update = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) =>
    setDraft({ ...draft, [key]: value });
  const weightUnit = settings.weightUnit === 'kg' ? 'کیلوگرم' : 'پوند';
  const heightUnit = settings.heightUnit === 'cm' ? 'سانتی‌متر' : 'اینچ';
  return (
    <div className="stack">
      {(step === undefined || step === 0) && (
        <>
          <Field label="نام (اختیاری)">
            <input
              value={draft.name}
              onChange={(e) => update('name', e.target.value)}
              maxLength={120}
              autoComplete="given-name"
            />
          </Field>
          <Field
            label="جنس زیستی برای فرمول انرژی"
            hint="این گزینه فقط ضریب فرمول Mifflin–St Jeor را تعیین می‌کند."
          >
            <select
              value={draft.sex}
              onChange={(e) => update('sex', e.target.value as ProfileDraft['sex'])}
            >
              <option value="female">زن</option>
              <option value="male">مرد</option>
            </select>
          </Field>
          <div className="form-grid">
            <Field label="سن (سال)">
              <input
                type="number"
                min={18}
                max={100}
                step={1}
                value={draft.age}
                onChange={(e) => update('age', e.target.value)}
                required
              />
            </Field>
            <Field label={`قد (${heightUnit})`}>
              <input
                type="number"
                min={settings.heightUnit === 'cm' ? 100 : 39}
                max={settings.heightUnit === 'cm' ? 250 : 99}
                step="any"
                value={draft.height}
                onChange={(e) => update('height', e.target.value)}
                required
              />
            </Field>
          </div>
          <label className="row small items-start">
            <input
              className="mt-1"
              type="checkbox"
              checked={draft.specialCondition}
              onChange={(e) => update('specialCondition', e.target.checked)}
            />
            <span>
              بارداری، شیردهی یا شرایط پزشکی مؤثر بر تغذیه دارم. برآورد خودکار کالری برای من غیرفعال
              شود.
            </span>
          </label>
        </>
      )}
      {(step === undefined || step === 1) && (
        <>
          <div className="form-grid">
            <Field label={`وزن مبنا (${weightUnit})`}>
              <input
                type="number"
                step="any"
                min={1}
                value={draft.weight}
                onChange={(e) => update('weight', e.target.value)}
                required
              />
            </Field>
            <Field label={`وزن هدف (${weightUnit})`}>
              <input
                type="number"
                step="any"
                min={1}
                value={draft.goalWeight}
                onChange={(e) => update('goalWeight', e.target.value)}
                required
                disabled={draft.goal === 'maintain'}
              />
            </Field>
          </div>
          <div className="field">
            <span>هدف شما</span>
            <Segments
              value={draft.goal}
              onChange={(v) => update('goal', v)}
              label="جهت هدف وزن"
              options={[
                { value: 'lose', label: 'کاهش وزن' },
                { value: 'maintain', label: 'حفظ وزن' },
                { value: 'gain', label: 'افزایش وزن' },
              ]}
            />
          </div>
          <Field
            label={`سرعت تغییر هفتگی (${weightUnit})`}
            hint="سرعت حداکثر یک درصد وزن در هفته در نظر گرفته می‌شود؛ محدودیت کالری ممکن است آن را کمتر کند."
          >
            <input
              type="number"
              min={0}
              step="any"
              value={draft.pace}
              disabled={draft.goal === 'maintain'}
              onChange={(e) => update('pace', e.target.value)}
              required
            />
          </Field>
        </>
      )}
      {(step === undefined || step === 2) && (
        <>
          <Field label="سطح فعالیت معمول">
            <select
              value={draft.activity}
              onChange={(e) => update('activity', e.target.value as ProfileDraft['activity'])}
            >
              <option value="sedentary">بیشتر روز نشسته، بدون ورزش منظم</option>
              <option value="light">فعالیت سبک، یک تا سه جلسه در هفته</option>
              <option value="moderate">فعالیت متوسط، سه تا پنج جلسه</option>
              <option value="active">فعال، شش تا هفت جلسه</option>
              <option value="very-active">بسیار فعال یا کار بدنی سنگین</option>
            </select>
          </Field>
          <div className="form-grid">
            <Field label="هدف آب روزانه (میلی‌لیتر)">
              <input
                type="number"
                min={250}
                max={8000}
                step={50}
                value={draft.water}
                onChange={(e) => update('water', e.target.value)}
                required
              />
            </Field>
            <Field label="هدف ورزش هفتگی (جلسه)">
              <input
                type="number"
                min={0}
                max={14}
                step={1}
                value={draft.workouts}
                onChange={(e) => update('workouts', e.target.value)}
                required
              />
            </Field>
          </div>
          <p className="small muted">
            برآوردها برای بزرگسالان و صرفاً برای پیگیری شخصی‌اند. کف ۱۲۰۰ یا ۱۵۰۰ کیلوکالری تضمین
            ایمنی نیست؛ برنامهٔ غذایی مناسب را با متخصص هماهنگ کنید.
          </p>
        </>
      )}
    </div>
  );
}
