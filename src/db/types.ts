export type ISODate = string;
export type Sex = 'female' | 'male';
export type Activity = 'sedentary' | 'light' | 'moderate' | 'active' | 'very-active';
export type Goal = 'lose' | 'maintain' | 'gain';
export interface Profile {
  id: 'main';
  name: string;
  sex: Sex;
  age: number;
  heightCm: number;
  startWeightKg: number;
  goalWeightKg: number;
  activity: Activity;
  goal: Goal;
  weeklyPaceKg: number;
  waterGoalMl: number;
  workoutGoal: number;
  specialCondition: boolean;
}
export interface Settings {
  id: 'main';
  weightUnit: 'kg' | 'lb';
  heightUnit: 'cm' | 'in';
  calendar: 'persian' | 'gregory';
  weekStartsOn: number;
  persianDigits: boolean;
  theme: 'light' | 'dark' | 'auto';
  reminders: boolean;
  reminderHour: number;
  onboardingComplete: boolean;
}
export type HabitIcon =
  'water' | 'food' | 'workout' | 'sleep' | 'steps' | 'vitamin' | 'sugar' | 'heart' | 'book' | 'sun';
export type HabitColor = 'teal' | 'blue' | 'orange' | 'violet' | 'rose';
export interface HabitConfig {
  name: string;
  icon: HabitIcon;
  color: HabitColor;
  days: number[];
  target: number;
  unit: string;
  archived: boolean;
}
export interface HabitRevision extends HabitConfig {
  from: ISODate;
}
export interface Habit extends HabitConfig {
  id: string;
  order: number;
  createdAt: ISODate;
  updatedFrom: ISODate;
  history: HabitRevision[];
}
export interface HabitLog {
  id: string;
  date: ISODate;
  habitId: string;
  value: number;
  target: number;
}
export type Adherence = 'full' | 'partial' | 'off';
export interface DailyLog {
  date: ISODate;
  waterMl: number;
  steps: number;
  sleepHours: number | null;
  mood: number | null;
  energy: number | null;
  note: string;
  adherence: Adherence | null;
  restDay: boolean;
  cheatMeal: boolean;
}
export interface WeightEntry {
  id: string;
  date: ISODate;
  time: string;
  weightKg: number;
  note: string;
}
export interface MeasurementEntry {
  id: string;
  date: ISODate;
  waist?: number;
  chest?: number;
  hip?: number;
  arm?: number;
  thigh?: number;
}
export interface Nutrition {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}
export interface Food extends Nutrition {
  id: string;
  name: string;
  favorite: boolean;
  lastUsedAt: string | null;
}
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export interface MealEntry extends Nutrition {
  id: string;
  date: ISODate;
  meal: MealType;
  name: string;
  cheat: boolean;
  foodId?: string;
}
export type WorkoutType =
  'walk' | 'run' | 'cycle' | 'swim' | 'strength' | 'yoga' | 'hiit' | 'other';
export type Intensity = 'light' | 'moderate' | 'vigorous';
export interface ExerciseSet {
  name: string;
  sets: number;
  reps: number;
  weightKg: number;
}
export interface Routine {
  id: string;
  name: string;
  type: WorkoutType;
  duration: number;
  intensity: Intensity;
  exercises: ExerciseSet[];
}
export interface WorkoutEntry {
  id: string;
  date: ISODate;
  type: WorkoutType;
  duration: number;
  intensity: Intensity;
  calories: number;
  notes: string;
  exercises: ExerciseSet[];
}
export interface Photo {
  id: string;
  date: ISODate;
  dataUrl: string;
  note: string;
}
export interface AppData {
  profile: Profile | undefined;
  settings: Settings;
  habits: Habit[];
  habitLogs: HabitLog[];
  days: DailyLog[];
  weights: WeightEntry[];
  measurements: MeasurementEntry[];
  foods: Food[];
  meals: MealEntry[];
  workouts: WorkoutEntry[];
  routines: Routine[];
}
