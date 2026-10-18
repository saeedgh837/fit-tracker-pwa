import { useRef, useState } from 'react';
import {
  Download,
  HardDriveDownload,
  Info,
  LockKeyhole,
  MonitorSmartphone,
  Moon,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Upload,
  UserRound,
} from 'lucide-react';
import { Button, Card, Confirm, Field, Modal, PageHeader, Segments } from '../../components/ui';
import { db, defaultProfile } from '../../db';
import {
  exportBackup,
  exportCSV,
  importBackup,
  MAX_BACKUP_BYTES,
  resetData,
  validateBackup,
} from '../../db/backup';
import { seedDemo } from '../../db/seed';
import { useData } from '../../hooks/useData';
import { usePwa } from '../../hooks/usePwa';
import type { Settings } from '../../db/types';
import { downloadFile, formatNumber } from '../../lib/format';
import { today } from '../../lib/dates';
import { nutritionTargets } from '../../lib/calculations';
import { run, toast } from '../../store/ui';
import ProfileFields from '../onboarding/ProfileFields';
import { profileFromDraft, profileToDraft } from '../onboarding/profile';
export default function SettingsPage() {
  const { settings, profile } = useData();
  const pwa = usePwa();
  const [profileOpen, setProfileOpen] = useState(false);
  const [draft, setDraft] = useState(() => profileToDraft(profile ?? defaultProfile, settings));
  const [inputSettings, setInputSettings] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<'reset' | 'demo' | 'import' | null>(null);
  const [backup, setBackup] = useState('');
  const [backupCount, setBackupCount] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const n = (v: number) => formatNumber(v, settings);
  const targets = profile ? nutritionTargets(profile) : null;
  async function changeSettings(patch: Partial<Settings>) {
    await run(async () => {
      await db.settings.update('main', patch);
    });
  }
  async function perform(fn: () => Promise<unknown>, message?: string) {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError('');
    const ok = await run(fn, message);
    lock.current = false;
    setBusy(false);
    if (!ok) setError('عملیات انجام نشد. اطلاعات فعلی محفوظ است. دوباره تلاش کنید.');
    return ok;
  }
  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    const result = profileFromDraft(draft, inputSettings);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (await perform(() => db.profiles.put(result.profile), 'پروفایل ذخیره شد.'))
      setProfileOpen(false);
  }
  async function readBackup(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('حجم پشتیبان باید حداکثر ۴۰ مگابایت باشد.');
      const raw = await file.text();
      const b = validateBackup(raw);
      setBackup(raw);
      setBackupCount(Object.values(b.data).reduce((sum, rows) => sum + rows.length, 0));
      setConfirm('import');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'خواندن فایل انجام نشد.', 'error');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }
  async function confirmAction() {
    const kind = confirm;
    setConfirm(null);
    if (kind === 'reset') {
      if (await perform(resetData, 'اطلاعات بازنشانی شد.')) window.location.hash = '/';
    } else if (kind === 'demo') await perform(seedDemo, 'نمونهٔ نمایشی آماده شد.');
    else if (kind === 'import') {
      if (await perform(() => importBackup(backup), 'پشتیبان بازیابی شد.')) setBackup('');
    }
  }
  return (
    <div className="stack">
      <PageHeader title="به سلیقهٔ شما" subtitle="هدف‌ها، ظاهر و اطلاعاتتان را مدیریت کنید." />
      <Card className="stack">
        <div className="row justify-between">
          <h2 className="row">
            <UserRound size={23} aria-hidden="true" />
            پروفایل و هدف‌ها
          </h2>
          <Button
            variant="secondary"
            onClick={() => {
              setDraft(profileToDraft(profile ?? defaultProfile, settings));
              setInputSettings(settings);
              setError('');
              setProfileOpen(true);
            }}
          >
            ویرایش پروفایل
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <p className="muted small">نام</p>
            <strong>{profile?.name || 'همراه همگام'}</strong>
          </div>
          <div>
            <p className="muted small">هدف انرژی تخمینی</p>
            <strong>{targets ? `${n(targets.calories)} کیلوکالری` : 'غیرفعال'}</strong>
          </div>
          <div>
            <p className="muted small">هدف ورزش</p>
            <strong>{n(profile?.workoutGoal ?? 0)} جلسه در هفته</strong>
          </div>
        </div>
        <p className="small muted">
          برآورد انرژی از Mifflin–St Jeor و ضریب فعالیت است. کف کالری و محدودیت سرعت تغییر، جای
          توصیهٔ پزشکی را نمی‌گیرند.
        </p>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="stack">
          <h2 className="row">
            <Settings2 size={22} aria-hidden="true" />
            نمایش و واحدها
          </h2>
          <div className="form-grid">
            <Field label="واحد وزن">
              <select
                value={settings.weightUnit}
                onChange={(e) =>
                  void changeSettings({ weightUnit: e.target.value as Settings['weightUnit'] })
                }
              >
                <option value="kg">کیلوگرم</option>
                <option value="lb">پوند</option>
              </select>
            </Field>
            <Field label="واحد قد و اندازه‌ها">
              <select
                value={settings.heightUnit}
                onChange={(e) =>
                  void changeSettings({ heightUnit: e.target.value as Settings['heightUnit'] })
                }
              >
                <option value="cm">سانتی‌متر</option>
                <option value="in">اینچ</option>
              </select>
            </Field>
            <Field label="تقویم">
              <select
                value={settings.calendar}
                onChange={(e) =>
                  void changeSettings({ calendar: e.target.value as Settings['calendar'] })
                }
              >
                <option value="persian">هجری شمسی</option>
                <option value="gregory">میلادی</option>
              </select>
            </Field>
            <Field label="شروع هفته">
              <select
                value={settings.weekStartsOn}
                onChange={(e) => void changeSettings({ weekStartsOn: Number(e.target.value) })}
              >
                {['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'].map(
                  (l, i) => (
                    <option key={i} value={i}>
                      {l}
                    </option>
                  ),
                )}
              </select>
            </Field>
          </div>
          <label className="row min-h-11">
            <input
              type="checkbox"
              checked={settings.persianDigits}
              onChange={(e) => void changeSettings({ persianDigits: e.target.checked })}
            />
            نمایش اعداد فارسی
          </label>
          <p className="small muted">
            داده‌ها همیشه با کیلوگرم، سانتی‌متر و تاریخ ISO ذخیره می‌شوند؛ تغییر نمایش، اطلاعات را
            تغییر نمی‌دهد.
          </p>
        </Card>
        <Card className="stack">
          <h2 className="row">
            <Moon size={22} aria-hidden="true" />
            ظاهر و یادآوری
          </h2>
          <Segments
            value={settings.theme}
            onChange={(v) => void changeSettings({ theme: v })}
            label="ظاهر برنامه"
            options={[
              { value: 'light', label: 'روشن' },
              { value: 'dark', label: 'تیره' },
              { value: 'auto', label: 'همراه دستگاه' },
            ]}
          />
          <label className="row min-h-11">
            <input
              type="checkbox"
              checked={settings.reminders}
              onChange={(e) => void changeSettings({ reminders: e.target.checked })}
            />
            یادآوری داخل برنامه
          </label>
          <Field label="ساعت شروع یادآوری">
            <input
              type="number"
              min={0}
              max={23}
              step={1}
              value={settings.reminderHour}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isInteger(v) && v >= 0 && v <= 23)
                  void changeSettings({ reminderHour: v });
              }}
            />
          </Field>
          <p className="small muted">
            اگر امروز هنوز کامل نشده باشد، پس از ساعت انتخاب‌شده بنر نمایش داده می‌شود. یادآوری فقط
            هنگام باز بودن برنامه فعال است؛ اعلان پس‌زمینه یا push ندارد.
          </p>
        </Card>
      </div>
      <Card className="stack">
        <h2 className="row">
          <HardDriveDownload size={23} aria-hidden="true" />
          پشتیبان، در اختیار شما
        </h2>
        <p className="muted small">
          فایل JSON همهٔ اطلاعات و عکس‌ها را نگه می‌دارد. CSV برای جدول‌هاست و عکس ندارد. هر دو فایل
          بدون رمزنگاری‌اند؛ آن‌ها را در جای امن نگه دارید.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void perform(
                async () =>
                  downloadFile(
                    JSON.stringify(await exportBackup(), null, 2),
                    `hamgam-backup-${today()}.json`,
                  ),
                'پشتیبان آمادهٔ دریافت است.',
              )
            }
          >
            <Download size={18} aria-hidden="true" />
            دریافت JSON
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void perform(
                async () =>
                  downloadFile(
                    await exportCSV(),
                    `hamgam-data-${today()}.csv`,
                    'text/csv;charset=utf-8',
                  ),
                'فایل CSV آماده است.',
              )
            }
          >
            <Download size={18} aria-hidden="true" />
            دریافت CSV
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Upload size={18} aria-hidden="true" />
            بازیابی پشتیبان
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          aria-label="انتخاب فایل پشتیبان"
          onChange={(e) => void readBackup(e.target.files?.[0])}
        />
        <div className="banner row items-start">
          <ShieldCheck size={20} className="mt-1" aria-hidden="true" />
          <p>
            پاک کردن داده‌های مرورگر، حالت خصوصی یا کمبود فضای دستگاه ممکن است اطلاعات را از بین
            ببرد. مرتب پشتیبان بگیرید. نصب برنامه جای پشتیبان را نمی‌گیرد.
          </p>
        </div>
        <Button
          variant="ghost"
          disabled={busy || !navigator.storage?.persist}
          onClick={() =>
            void perform(async () => {
              const allowed = await navigator.storage.persist();
              toast(
                allowed
                  ? 'مرورگر نگهداری پایدارتر اطلاعات را پذیرفت.'
                  : 'مرورگر تضمین نگهداری نداد. پشتیبان‌گیری همچنان ضروری است.',
              );
            })
          }
        >
          درخواست نگهداری پایدار از مرورگر
        </Button>
      </Card>
      <Card className="stack">
        <h2 className="row">
          <MonitorSmartphone size={23} aria-hidden="true" />
          نصب همگام
        </h2>
        {pwa.installed ? (
          <span className="badge self-start">برنامه نصب شده است</span>
        ) : pwa.canInstall ? (
          <Button className="self-start" onClick={() => void pwa.install()}>
            نصب برنامه
          </Button>
        ) : (
          <p className="muted small">اگر دکمهٔ نصب ظاهر نشد، از منوی مرورگر استفاده کنید.</p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl bg-[var(--surface-soft)] p-4">
            <h3>آیفون و آیپد</h3>
            <p className="small muted mt-2">
              این نشانی را در Safari باز کنید. دکمهٔ اشتراک‌گذاری (Share) را بزنید، سپس «افزودن به
              صفحهٔ اصلی» (Add to Home Screen) و Add را انتخاب کنید.
            </p>
          </div>
          <div className="rounded-2xl bg-[var(--surface-soft)] p-4">
            <h3>اندروید</h3>
            <p className="small muted mt-2">
              در Chrome، منوی سه‌نقطه را باز کنید. Install app یا «نصب برنامه» را بزنید. اگر نبود،
              Add to Home screen را انتخاب کنید.
            </p>
          </div>
        </div>
        <p className="small muted">
          یک‌بار آنلاین باز کنید تا فایل‌ها آمادهٔ استفادهٔ آفلاین شوند. اطلاعات هر دستگاه و مرورگر
          مستقل است و همگام‌سازی خودکار ندارد.
        </p>
      </Card>
      <Card className="stack">
        <h2 className="row">
          <Sparkles size={23} aria-hidden="true" />
          آشنایی با نمودارها
        </h2>
        <p className="muted small">
          ۴۵ روز اطلاعات ساختگی بسازید. برای جلوگیری از مخلوط شدن، فقط وقتی هنوز دادهٔ سلامت ندارید
          فعال می‌شود.
        </p>
        <Button
          variant="secondary"
          className="self-start"
          disabled={busy}
          onClick={() => setConfirm('demo')}
        >
          ساخت دادهٔ نمونه
        </Button>
      </Card>
      <Card className="stack">
        <h2 className="row">
          <LockKeyhole size={22} aria-hidden="true" />
          حریم خصوصی
        </h2>
        <p className="muted small">
          اطلاعات سلامت و عکس‌ها از دستگاه ارسال نمی‌شوند. برنامه تحلیل‌گر، حساب کاربری یا سرور
          ندارد. ذخیرهٔ محلی رمزنگاری اختصاصی ندارد. در GitHub Pages، سایت‌های دیگر همین حساب روی
          دامنهٔ یکسان، مبدأ مشترک دارند؛ برای جداسازی قوی‌تر، برنامه را روی دامنهٔ اختصاصی خود
          میزبانی کنید.
        </p>
        <p className="muted small row">
          <Info size={17} aria-hidden="true" />
          نسخهٔ ۱.۰.۰ · متن‌باز با مجوز MIT
        </p>
      </Card>
      <Card className="stack border-[var(--danger)]">
        <h2>بازنشانی اطلاعات</h2>
        <p className="muted small">
          همهٔ ثبت‌ها، عکس‌ها و تنظیمات این برنامه روی این مرورگر حذف می‌شوند. ابتدا فایل پشتیبان
          بگیرید.
        </p>
        <Button
          variant="danger"
          className="self-start"
          disabled={busy}
          onClick={() => setConfirm('reset')}
        >
          <RotateCcw size={18} aria-hidden="true" />
          حذف همهٔ اطلاعات
        </Button>
      </Card>
      {error && (
        <p role="alert" className="banner">
          {error}
        </p>
      )}
      {busy && (
        <p role="status" className="banner">
          در حال انجام عملیات؛ برنامه را نبندید.
        </p>
      )}
      <Modal
        open={profileOpen}
        title="پروفایل و هدف‌ها"
        onClose={() => {
          if (!busy) setProfileOpen(false);
        }}
      >
        <form className="stack" onSubmit={(e) => void saveProfile(e)} noValidate>
          <ProfileFields draft={draft} setDraft={setDraft} settings={inputSettings} />
          {error && (
            <p role="alert" className="banner">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy}>
            ذخیره پروفایل
          </Button>
        </form>
      </Modal>
      <Confirm
        open={confirm !== null}
        title={
          confirm === 'reset'
            ? 'حذف همهٔ اطلاعات؟'
            : confirm === 'import'
              ? 'جایگزینی کامل با پشتیبان؟'
              : 'ساخت نمونهٔ نمایشی؟'
        }
        description={
          confirm === 'reset'
            ? 'همهٔ داده‌های این برنامه روی این مرورگر، از جمله عکس‌ها، برای همیشه حذف می‌شوند. اگر پشتیبان ندارید، ابتدا انصراف دهید و پشتیبان بگیرید.'
            : confirm === 'import'
              ? `${n(backupCount)} رکورد از فایل، جای همهٔ اطلاعات فعلی را می‌گیرد. بازیابی اتمیک است؛ فایل نامعتبر اطلاعات فعلی را تغییر نمی‌دهد. پیش از ادامه، پشتیبان فعلی را بگیرید.`
              : 'اطلاعات نمونه ساختگی است و فقط در فضای بدون دادهٔ سلامت ساخته می‌شود.'
        }
        danger={confirm !== 'demo'}
        onClose={() => {
          setConfirm(null);
          setBackup('');
        }}
        onConfirm={() => void confirmAction()}
      />
    </div>
  );
}
