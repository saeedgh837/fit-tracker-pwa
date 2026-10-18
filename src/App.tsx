import { lazy, Suspense } from 'react';
import { HashRouter, Navigate, NavLink, Outlet, Route, Routes } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import Layout from './components/Layout';
import { DataProvider, useData } from './hooks/useData';
import { useTheme } from './hooks/useTheme';
import { useUI } from './store/ui';
const TodayPage = lazy(() => import('./features/today/TodayPage'));
const HabitsPage = lazy(() => import('./features/habits/HabitsPage'));
const WeightPage = lazy(() => import('./features/weight/WeightPage'));
const DietPage = lazy(() => import('./features/diet/DietPage'));
const ExercisePage = lazy(() => import('./features/exercise/ExercisePage'));
const JournalPage = lazy(() => import('./features/journal/JournalPage'));
const ReportsPage = lazy(() => import('./features/reports/ReportsPage'));
const SettingsPage = lazy(() => import('./features/settings/SettingsPage'));
const Onboarding = lazy(() => import('./features/onboarding/Onboarding'));
function HealthLayout() {
  return (
    <>
      <nav aria-label="بخش‌های سلامت" className="health-nav">
        {[
          ['weight', 'وزن و اندازه'],
          ['diet', 'تغذیه'],
          ['exercise', 'ورزش'],
          ['journal', 'حال و یادداشت'],
        ].map(([to, label]) => (
          <NavLink key={to} to={to}>
            {label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </>
  );
}
function Toaster() {
  const toasts = useUI((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          className={`toast ${t.kind === 'error' ? 'toast-error' : ''}`}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
function Application() {
  const { settings } = useData();
  useTheme(settings.theme);
  return (
    <>
      <Toaster />
      {!settings.onboardingComplete ? (
        <Suspense
          fallback={
            <div className="app-shell skeleton h-96" role="status" aria-label="در حال آماده‌سازی" />
          }
        >
          <Onboarding />
        </Suspense>
      ) : (
        <HashRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<TodayPage />} />
              <Route path="habits" element={<HabitsPage />} />
              <Route path="health" element={<HealthLayout />}>
                <Route index element={<Navigate to="weight" replace />} />
                <Route path="weight" element={<WeightPage />} />
                <Route path="diet" element={<DietPage />} />
                <Route path="exercise" element={<ExercisePage />} />
                <Route path="journal" element={<JournalPage />} />
              </Route>
              <Route path="reports" element={<ReportsPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </HashRouter>
      )}
    </>
  );
}
export default function App() {
  return (
    <MotionConfig reducedMotion="user">
      <DataProvider>
        <Application />
      </DataProvider>
    </MotionConfig>
  );
}
