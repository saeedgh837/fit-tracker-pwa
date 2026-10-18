import { useState } from 'react';
import { Activity, ArrowLeft, Check, LockKeyhole, Sprout } from 'lucide-react';
import { Button, Card, Confirm, Stat } from '../../components/ui';
import { db, defaultHabits, defaultProfile, uid } from '../../db';
import { seedDemo } from '../../db/seed';
import { useData } from '../../hooks/useData';
import { nutritionTargets } from '../../lib/calculations';
import { today } from '../../lib/dates';
import { formatNumber } from '../../lib/format';
import { run } from '../../store/ui';
import ProfileFields from './ProfileFields';
import { profileFromDraft, profileToDraft } from './profile';
export default function Onboarding() {
  const { settings } = useData();
  const [draft, setDraft] = useState(() => profileToDraft(defaultProfile, settings));
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState(false);
  const parsed = profileFromDraft(draft, settings);
  const targets = parsed.ok ? nutritionTargets(parsed.profile) : null;
  async function next(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (step === 0) {
      if (
        !Number.isInteger(+draft.age) ||
        +draft.age < 18 ||
        +draft.age > 100 ||
        !draft.height.trim() ||
        +draft.height <= 0
      ) {
        setError('سن باید از ۱۸ تا ۱۰۰ سال و قد یک عدد مثبت باشد.');
        return;
      }
      setStep(1);
      return;
    }
    if (step === 1) {
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      setStep(2);
      return;
    }
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    const profile = parsed.profile;
    const ok = await run(
      () =>
        db.transaction('rw', db.profiles, db.settings, db.habits, db.weights, async () => {
          await db.profiles.put(profile);
          await db.settings.put({ ...settings, onboardingComplete: true });
          if (!(await db.habits.count())) await db.habits.bulkPut(defaultHabits());
          await db.weights.put({
            id: uid(),
            date: today(),
            time: new Date().toTimeString().slice(0, 5),
            weightKg: profile.startWeightKg,
            note: 'وزن شروع مسیر',
          });
        }),
      'مسیر شما آماده است.',
    );
    setBusy(false);
    if (!ok) setError('آغاز مسیر ذخیره نشد. دوباره تلاش کنید.');
  }
  return (
    <div className="min-h-dvh grid lg:grid-cols-2 max-w-[1440px] mx-auto">
      <aside className="hidden lg:flex flex-col justify-between p-16 text-white bg-gradient-to-bl from-[#087f80] to-[#154c68] min-h-dvh">
        <div className="row text-3xl font-bold">
          <Activity size={37} aria-hidden="true" />
          همگام
        </div>
        <div className="max-w-lg">
          <div className="w-64 h-64 rounded-full border border-white/25 grid place-items-center mb-14 relative">
            <div className="absolute w-44 h-44 rounded-full border border-white/30" />
            <div className="absolute w-20 h-20 rounded-full bg-white/15 grid place-items-center">
              <Sprout size={43} aria-hidden="true" />
            </div>
            <div className="absolute end-1 top-10 w-14 h-14 rounded-2xl bg-white text-[#087f80] grid place-items-center rotate-12">
              <Check size={28} aria-hidden="true" />
            </div>
          </div>
          <h1 className="text-5xl leading-relaxed mb-6">
            قدم‌های کوچک،
            <br />
            حالِ بهتر.
          </h1>
          <p className="text-lg text-teal-100 leading-loose">
            عادت‌ها، غذا و حرکت را کنار هم ببینید. مسیر خودتان را بسازید، نه یک روز بی‌نقص را.
          </p>
        </div>
        <p className="row text-sm text-teal-100">
          <LockKeyhole size={18} aria-hidden="true" />
          بدون حساب کاربری. اطلاعات روی دستگاه می‌ماند.
        </p>
      </aside>
      <main className="px-6 py-9 sm:p-12 lg:p-16 max-w-xl mx-auto w-full flex flex-col justify-center">
        <div className="row mb-8 lg:hidden">
          <span className="brand-mark">
            <Activity size={25} aria-hidden="true" />
          </span>
          <strong className="text-2xl">همگام</strong>
        </div>
        <p className="muted small mb-3" role="status">
          {`شروعی ساده، در سه قدم — مرحلهٔ ${formatNumber(step + 1, settings)} از ۳`}
        </p>
        <div className="flex gap-2 mb-8" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div
              className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-[var(--primary)]' : 'bg-[var(--line)]'}`}
              key={i}
            />
          ))}
        </div>
        <h1 className="mb-2">
          {['کمی از خودتان بگویید', 'مسیرتان را انتخاب کنید', 'ریتم روزهایتان چیست؟'][step]}
        </h1>
        <p className="muted small mb-7">
          {
            [
              'برای برآورد اولیه؛ همهٔ این موارد بعداً قابل‌تغییر است.',
              'هدف واقع‌بینانه، همراه بهتری برای ادامهٔ مسیر است.',
              'از این اطلاعات، هدف اولیهٔ انرژی و درشت‌مغذی‌ها برآورد می‌شود.',
            ][step]
          }
        </p>
        <form className="stack" onSubmit={(e) => void next(e)} noValidate>
          <ProfileFields draft={draft} setDraft={setDraft} settings={settings} step={step} />
          {step === 2 && targets && (
            <Card className="bg-[var(--primary-soft)] shadow-none">
              <div className="grid grid-cols-2 gap-4">
                <Stat
                  label="هدف انرژی روزانه"
                  value={formatNumber(targets.calories, settings)}
                  detail="کیلوکالری تخمینی"
                />
                <Stat
                  label="پروتئین"
                  value={`${formatNumber(targets.protein, settings)} گرم`}
                  detail={`چربی ${formatNumber(targets.fat, settings)} و کربوهیدرات ${formatNumber(targets.carbs, settings)} گرم`}
                />
              </div>
              {targets.limited && (
                <p className="small mt-4">
                  سرعت هدف با محدودیت یک درصد وزن و کف انرژی تعدیل شد: حدود{' '}
                  {formatNumber(targets.paceKg, settings, 2)} کیلوگرم در هفته.
                </p>
              )}
            </Card>
          )}
          {error && (
            <p role="alert" className="banner">
              {error}
            </p>
          )}
          <div className="row mt-3">
            {step > 0 && (
              <Button
                variant="secondary"
                onClick={() => {
                  setStep(step - 1);
                  setError('');
                }}
                disabled={busy}
              >
                قبلی
              </Button>
            )}
            <Button type="submit" className="flex-1" disabled={busy}>
              {busy ? 'در حال آماده‌سازی…' : step === 2 ? 'شروع مسیر من' : 'ادامه'}
              <ArrowLeft size={18} aria-hidden="true" />
            </Button>
          </div>
        </form>
        <Button variant="ghost" className="mt-5" onClick={() => setDemo(true)} disabled={busy}>
          ابتدا با دادهٔ نمونه ببینم
        </Button>
        <p className="muted text-xs text-center mt-4">
          نه ثبت‌نامی در کار است، نه ارسال اطلاعات سلامت به سرور.
        </p>
      </main>
      <Confirm
        open={demo}
        title="مشاهدهٔ نمونه"
        description="۴۵ روز اطلاعات ساختگی برای آشنایی با نمودارها ساخته می‌شود. پیش از ثبت اطلاعات واقعی، از تنظیمات نمونه‌ها را بازنشانی کنید."
        danger={false}
        onClose={() => setDemo(false)}
        onConfirm={() => {
          setDemo(false);
          setBusy(true);
          void run(seedDemo).finally(() => setBusy(false));
        }}
      />
    </div>
  );
}
