import type { Profile, Settings } from '../../db/types';
import { fromCm, fromKg, toCm, toKg } from '../../lib/format';
import { profileSchema } from '../../db/backup';
export interface ProfileDraft {
  name: string;
  sex: Profile['sex'];
  age: string;
  height: string;
  weight: string;
  goalWeight: string;
  activity: Profile['activity'];
  goal: Profile['goal'];
  pace: string;
  water: string;
  workouts: string;
  specialCondition: boolean;
}
export function profileToDraft(p: Profile, s: Settings): ProfileDraft {
  return {
    name: p.name,
    sex: p.sex,
    age: String(p.age),
    height: String(+fromCm(p.heightCm, s.heightUnit).toFixed(3)),
    weight: String(+fromKg(p.startWeightKg, s.weightUnit).toFixed(3)),
    goalWeight: String(+fromKg(p.goalWeightKg, s.weightUnit).toFixed(3)),
    activity: p.activity,
    goal: p.goal,
    pace: String(+fromKg(p.weeklyPaceKg, s.weightUnit).toFixed(3)),
    water: String(p.waterGoalMl),
    workouts: String(p.workoutGoal),
    specialCondition: p.specialCondition,
  };
}
export function profileFromDraft(
  d: ProfileDraft,
  s: Settings,
): { ok: true; profile: Profile } | { ok: false; error: string } {
  const weight = toKg(Number(d.weight), s.weightUnit);
  const pace = toKg(Number(d.pace), s.weightUnit);
  const p: Profile = {
    id: 'main',
    name: d.name.trim(),
    sex: d.sex,
    age: Number(d.age),
    heightCm: toCm(Number(d.height), s.heightUnit),
    startWeightKg: weight,
    goalWeightKg: toKg(Number(d.goalWeight), s.weightUnit),
    activity: d.activity,
    goal: d.goal,
    weeklyPaceKg:
      d.goal === 'maintain' ? 0 : Math.floor(Math.min(pace, weight * 0.01) * 10000) / 10000,
    waterGoalMl: Number(d.water),
    workoutGoal: Number(d.workouts),
    specialCondition: d.specialCondition,
  };
  if (
    [d.age, d.height, d.weight, d.goalWeight, d.pace, d.water, d.workouts].some((v) => !v.trim()) ||
    !profileSchema.safeParse(p).success
  )
    return {
      ok: false,
      error:
        'اطلاعات را بررسی کنید: سن ۱۸ تا ۱۰۰ سال، قد ۱۰۰ تا ۲۵۰ سانتی‌متر، وزن ۳۰ تا ۴۰۰ کیلوگرم و هدف آب ۲۵۰ تا ۸۰۰۰ میلی‌لیتر.',
    };
  if (
    (p.goal === 'lose' && p.goalWeightKg >= p.startWeightKg) ||
    (p.goal === 'gain' && p.goalWeightKg <= p.startWeightKg)
  )
    return { ok: false, error: 'وزن هدف باید با جهت هدف کاهش یا افزایش وزن سازگار باشد.' };
  if (p.goal === 'maintain') p.goalWeightKg = p.startWeightKg;
  return { ok: true, profile: p };
}
