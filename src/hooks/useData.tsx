import { createContext, useContext, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, defaultSettings } from '../db';
import type { AppData } from '../db/types';
const DataContext = createContext<AppData | null>(null);
export function DataProvider({ children }: { children: ReactNode }) {
  const data = useLiveQuery(async () => {
    const [
      profile,
      settings,
      habits,
      habitLogs,
      days,
      weights,
      measurements,
      foods,
      meals,
      workouts,
      routines,
    ] = await Promise.all([
      db.profiles.get('main'),
      db.settings.get('main'),
      db.habits.toArray(),
      db.habitLogs.toArray(),
      db.days.toArray(),
      db.weights.toArray(),
      db.measurements.toArray(),
      db.foods.toArray(),
      db.meals.toArray(),
      db.workouts.toArray(),
      db.routines.toArray(),
    ]);
    return {
      profile,
      settings: settings ?? defaultSettings,
      habits,
      habitLogs,
      days,
      weights,
      measurements,
      foods,
      meals,
      workouts,
      routines,
    };
  }, []);
  if (!data)
    return (
      <div className="app-shell" role="status" aria-label="در حال خواندن اطلاعات">
        <div className="skeleton h-14 mb-8 w-40" />
        <div className="skeleton h-64 mb-5" />
        <div className="grid grid-cols-2 gap-4">
          <div className="skeleton h-48" />
          <div className="skeleton h-48" />
        </div>
      </div>
    );
  return <DataContext.Provider value={data}>{children}</DataContext.Provider>;
}
export function useData(): AppData {
  const data = useContext(DataContext);
  if (!data) throw new Error('DataProvider is required');
  return data;
}
