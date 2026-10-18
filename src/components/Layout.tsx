import { Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  Activity,
  CalendarDays,
  ChartNoAxesCombined,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  HeartPulse,
  House,
  Plus,
  Settings,
  WifiOff,
  X,
} from 'lucide-react';
import { Button, IconButton } from './ui';
import QuickAdd from './QuickAdd';
import { useData } from '../hooks/useData';
import { useTheme } from '../hooks/useTheme';
import { usePwa } from '../hooks/usePwa';
import { addDays, formatDate, today } from '../lib/dates';
import { dayCompletion } from '../lib/calculations';
import { useUI } from '../store/ui';
const tabs = [
  { to: '/', label: 'امروز', icon: House, end: true },
  { to: '/habits', label: 'چک‌لیست', icon: CheckCheck },
  { to: '/health', label: 'سلامت', icon: HeartPulse },
  { to: '/reports', label: 'گزارش‌ها', icon: ChartNoAxesCombined },
  { to: '/settings', label: 'تنظیمات', icon: Settings },
];
export default function Layout() {
  const { settings, habits, habitLogs } = useData();
  useTheme(settings.theme);
  const { date, setDate, setQuickAdd } = useUI();
  const [offline, setOffline] = useState(!navigator.onLine);
  const [dismissed, setDismissed] = useState('');
  const [dbUpgrade, setDbUpgrade] = useState(false);
  const location = useLocation();
  const pwa = usePwa();
  const completion = dayCompletion(habits, habitLogs, today());
  useEffect(() => {
    const online = () => setOffline(!navigator.onLine);
    const upgrade = () => setDbUpgrade(true);
    window.addEventListener('online', online);
    window.addEventListener('offline', online);
    window.addEventListener('fit-db-versionchange', upgrade);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', online);
      window.removeEventListener('fit-db-versionchange', upgrade);
    };
  }, []);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    document.getElementById('main-content')?.focus({ preventScroll: true });
  }, [location.pathname]);
  const reminder =
    settings.reminders &&
    new Date().getHours() >= settings.reminderHour &&
    completion.total > 0 &&
    completion.percent < 100 &&
    dismissed !== today();
  return (
    <>
      <a href="#main-content" className="skip-link">
        رفتن به محتوای اصلی
      </a>
      <div className="app-shell">
        <header className="app-header">
          <Link to="/" className="brand" aria-label="همگام، صفحهٔ امروز">
            <span className="brand-mark">
              <Activity size={27} aria-hidden="true" />
            </span>
            <span>
              همگام<span className="brand-sub">همراه روزهای سالم‌تر</span>
            </span>
          </Link>
          <div className="date-control">
            <IconButton label="روز قبل" onClick={() => setDate(addDays(date, -1))}>
              <ChevronRight size={18} aria-hidden="true" />
            </IconButton>
            <label className="date-input">
              <span className="row gap-2">
                <CalendarDays size={16} aria-hidden="true" />
                {formatDate(date, settings, { year: undefined, month: 'long', day: 'numeric' })}
              </span>
              <input
                type="date"
                aria-label="انتخاب روز"
                value={date}
                min="1900-01-01"
                max="2200-12-31"
                onChange={(e) => {
                  if (e.target.value) setDate(e.target.value);
                }}
              />
            </label>
            <IconButton
              label="روز بعد"
              disabled={date >= today()}
              onClick={() => setDate(addDays(date, 1))}
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </IconButton>
            {date !== today() && (
              <Button variant="ghost" onClick={() => setDate(today())}>
                امروز
              </Button>
            )}
          </div>
        </header>
        {offline && (
          <p role="status" className="banner row mb-4">
            <WifiOff size={18} aria-hidden="true" />
            آفلاین هستید؛ ثبت‌ها همچنان روی دستگاه ذخیره می‌شوند.
          </p>
        )}
        {(pwa.needRefresh || dbUpgrade) && (
          <div role="status" className="banner row justify-between mb-4 flex-wrap">
            <span>نسخهٔ تازه آماده است. ابتدا فرم‌های باز را ذخیره کنید.</span>
            <Button
              variant="secondary"
              onClick={() => {
                if (dbUpgrade) window.location.reload();
                else void pwa.updateServiceWorker(true);
              }}
            >
              بارگذاری نسخهٔ تازه
            </Button>
          </div>
        )}
        {reminder && (
          <div className="banner row justify-between mb-5">
            <p>یک قدم دیگر برای امروز؛ چک‌لیستتان هنوز کامل نشده است.</p>
            <IconButton label="بستن یادآوری امروز" onClick={() => setDismissed(today())}>
              <X size={17} aria-hidden="true" />
            </IconButton>
          </div>
        )}
        <main id="main-content" tabIndex={-1} className="outline-none">
          <Suspense
            fallback={
              <div role="status" aria-label="در حال باز کردن صفحه" className="stack">
                <div className="skeleton h-20" />
                <div className="skeleton h-64" />
                <div className="skeleton h-40" />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </main>
      </div>
      <button
        type="button"
        className="quick-fab"
        aria-label="ثبت سریع"
        onClick={() => setQuickAdd(true)}
      >
        <Plus size={27} aria-hidden="true" />
      </button>
      <nav aria-label="ناوبری اصلی" className="bottom-nav">
        {tabs.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <Icon size={22} strokeWidth={1.8} aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <QuickAdd />
    </>
  );
}
