import { db, defaultHabits, defaultSettings, emptyDay, uid } from './index';
import type {
  Food,
  Profile,
  WeightEntry,
  MealEntry,
  WorkoutEntry,
  HabitLog,
  MeasurementEntry,
} from './types';
import { addDays, today } from '../lib/dates';
import { metCalories } from '../lib/calculations';
export async function seedDemo(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    const counts = await Promise.all([
      db.weights.count(),
      db.days.count(),
      db.meals.count(),
      db.workouts.count(),
      db.habitLogs.count(),
      db.measurements.count(),
      db.photos.count(),
    ]);
    if (counts.some((n) => n > 0))
      throw new Error(
        'برای حفظ اطلاعات شخصی، نمونه فقط در فضای خالی ساخته می‌شود. ابتدا پشتیبان بگیرید و در صورت نیاز اطلاعات را بازنشانی کنید.',
      );
    const end = today(),
      start = addDays(end, -44);
    const profile: Profile = {
      id: 'main',
      name: 'همراه',
      sex: 'female',
      age: 29,
      heightCm: 168,
      startWeightKg: 76,
      goalWeightKg: 68,
      activity: 'moderate',
      goal: 'lose',
      weeklyPaceKg: 0.4,
      waterGoalMl: 2000,
      workoutGoal: 3,
      specialCondition: false,
    };
    const habits = defaultHabits(start).map((h, i) => ({ ...h, id: `demo-habit-${i}` }));
    const foods: Food[] = [
      {
        id: 'demo-food-1',
        name: 'املت و نان سنگک',
        calories: 340,
        protein: 19,
        carbs: 32,
        fat: 15,
        favorite: true,
        lastUsedAt: new Date().toISOString(),
      },
      {
        id: 'demo-food-2',
        name: 'مرغ و برنج',
        calories: 540,
        protein: 42,
        carbs: 65,
        fat: 12,
        favorite: true,
        lastUsedAt: new Date().toISOString(),
      },
      {
        id: 'demo-food-3',
        name: 'ماست و میوه',
        calories: 210,
        protein: 14,
        carbs: 29,
        fat: 5,
        favorite: false,
        lastUsedAt: null,
      },
    ];
    const weights: WeightEntry[] = [],
      meals: MealEntry[] = [],
      workouts: WorkoutEntry[] = [],
      logs: HabitLog[] = [],
      measurements: MeasurementEntry[] = [];
    const days = [];
    for (let i = 0; i < 45; i++) {
      const date = addDays(start, i),
        weightKg = Math.round((76 - i * 0.055 + Math.sin(i * 1.3) * 0.21) * 10) / 10;
      weights.push({
        id: `demo-weight-${i}`,
        date,
        time: '07:30',
        weightKg,
        note: i === 44 ? 'نمونهٔ نمایشی، نه اطلاعات واقعی' : '',
      });
      const active = i % 3 !== 1;
      const adherence = i % 9 === 0 ? 'partial' : 'full';
      const day = {
        ...emptyDay(date),
        waterMl: i === 44 ? 1250 : 1500 + (i % 4) * 250,
        steps: 4800 + ((i * 373) % 6200),
        sleepHours: 6.5 + (i % 4) * 0.5,
        mood: 3 + (i % 3),
        energy: 3 + (i % 3),
        note:
          i === 44
            ? 'امروز با یک پیاده‌روی کوتاه شروع کردم. ادامه دادن مهم‌تر از بی‌نقص بودن است.'
            : '',
        adherence: adherence as 'partial' | 'full',
        restDay: !active,
      };
      days.push(day);
      for (let m = 0; m < 4; m++) {
        if (i === 44 && m > 1) continue;
        const food = foods[m % 3];
        meals.push({
          id: `demo-meal-${i}-${m}`,
          date,
          meal: (['breakfast', 'lunch', 'dinner', 'snack'] as const)[m],
          name: m === 2 ? 'سوپ سبزیجات' : food.name,
          calories: m === 2 ? 410 : food.calories,
          protein: food.protein,
          carbs: food.carbs,
          fat: food.fat,
          cheat: false,
          foodId: food.id,
        });
      }
      if (active) {
        const strength = i % 2 === 0;
        workouts.push({
          id: `demo-workout-${i}`,
          date,
          type: strength ? 'strength' : 'walk',
          duration: strength ? 45 : 30,
          intensity: 'moderate',
          calories: metCalories(
            strength ? 'strength' : 'walk',
            strength ? 45 : 30,
            'moderate',
            weightKg,
          ),
          notes: 'جلسهٔ نمونه',
          exercises: strength
            ? [
                { name: 'اسکوات', sets: 3, reps: 12, weightKg: 20 + Math.floor(i / 10) * 5 },
                { name: 'پرس سینه', sets: 3, reps: 10, weightKg: 15 + Math.floor(i / 12) * 2.5 },
              ]
            : [],
        });
      }
      habits.forEach((h, j) => {
        const completed = i === 44 ? j < 3 : i % 11 !== 3 || j < 4;
        logs.push({
          id: `demo-log-${i}-${j}`,
          date,
          habitId: h.id,
          value: completed ? h.target : 0,
          target: h.target,
        });
      });
      if (i % 7 === 0)
        measurements.push({
          id: `demo-measurement-${i}`,
          date,
          waist: 88 - i * 0.07,
          chest: 99 - i * 0.03,
          hip: 102 - i * 0.04,
          arm: 30 + i * 0.01,
          thigh: 59 - i * 0.025,
        });
    }
    await db.profiles.put(profile);
    await db.settings.put({ ...defaultSettings, onboardingComplete: true });
    await db.habits.clear();
    await db.habits.bulkPut(habits);
    await db.foods.bulkPut(foods);
    await db.days.bulkPut(days);
    await db.weights.bulkPut(weights);
    await db.meals.bulkPut(meals);
    await db.workouts.bulkPut(workouts);
    await db.habitLogs.bulkPut(logs);
    await db.measurements.bulkPut(measurements);
    await db.routines.put({
      id: uid(),
      name: 'قدرت پایه',
      type: 'strength',
      duration: 45,
      intensity: 'moderate',
      exercises: [
        { name: 'اسکوات', sets: 3, reps: 12, weightKg: 20 },
        { name: 'پرس سینه', sets: 3, reps: 10, weightKg: 15 },
      ],
    });
  });
}
