import type { Habit, HabitConfig, HabitLog } from '../../db/types';
import {
  bestHabitStreak,
  dayCompletion,
  habitAtDate,
  habitStreak,
  isHabitScheduled,
} from '../../lib/calculations';
import { addDays, dateRange } from '../../lib/dates';
import { compareHabits } from './model';

export interface DailyHabit {
  habit: Habit;
  config: HabitConfig;
  value: number;
  target: number;
  done: boolean;
  percent: number;
  streak: number;
  bestStreak: number;
  hasLog: boolean;
}
export interface HeatmapCell {
  date: string;
  done: number;
  total: number;
  percent: number;
}

export function buildDailyHabits(habits: Habit[], logs: HabitLog[], date: string): DailyHabit[] {
  const dailyLogs = new Map(
    logs.filter((log) => log.date === date).map((log) => [log.habitId, log]),
  );
  return [...habits].sort(compareHabits).flatMap((habit) => {
    const config = habitAtDate(habit, date);
    if (!config || !isHabitScheduled(habit, date)) return [];
    const log = dailyLogs.get(habit.id);
    const value = log?.value ?? 0;
    const target = log?.target ?? config.target;
    return [
      {
        habit,
        config,
        value,
        target,
        done: value >= target,
        percent: Math.min(100, Math.max(0, (value / target) * 100)),
        streak: habitStreak(habit, logs, date),
        bestStreak: bestHabitStreak(habit, logs, date),
        hasLog: !!log,
      },
    ];
  });
}

export function buildHeatmap(
  habits: Habit[],
  logs: HabitLog[],
  date: string,
  habitId?: string,
): HeatmapCell[] {
  const filtered = habitId ? habits.filter((habit) => habit.id === habitId) : habits;
  return dateRange(addDays(date, -83), date).map((day) => ({
    date: day,
    ...dayCompletion(filtered, logs, day),
  }));
}
