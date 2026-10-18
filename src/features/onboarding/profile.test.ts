import { describe, expect, it } from 'vitest';
import { profileFromDraft, profileToDraft } from './profile';
import { defaultProfile, defaultSettings } from '../../db';
import { fromKg, fromCm } from '../../lib/format';
describe('profile forms and safety', () => {
  it('rejects minors, impossible measurements and contradicting goals', () => {
    const d = profileToDraft(defaultProfile, defaultSettings);
    expect(profileFromDraft({ ...d, age: '17' }, defaultSettings).ok).toBe(false);
    expect(profileFromDraft({ ...d, height: '0' }, defaultSettings).ok).toBe(false);
    expect(profileFromDraft({ ...d, goal: 'lose', goalWeight: '90' }, defaultSettings).ok).toBe(
      false,
    );
  });
  it('converts pounds and inches once and caps pace at one percent', () => {
    const s = { ...defaultSettings, weightUnit: 'lb' as const, heightUnit: 'in' as const };
    const d = profileToDraft(
      { ...defaultProfile, startWeightKg: 80, goalWeightKg: 75, heightCm: 180 },
      s,
    );
    expect(+d.weight).toBeCloseTo(fromKg(80, 'lb'), 2);
    expect(+d.height).toBeCloseTo(fromCm(180, 'in'), 2);
    const result = profileFromDraft({ ...d, pace: '9' }, s);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profile.startWeightKg).toBeCloseTo(80, 1);
      expect(result.profile.weeklyPaceKg).toBeLessThanOrEqual(0.8);
    }
  });
  it('accepts special conditions but keeps automated target unavailable downstream', () => {
    const d = profileToDraft(defaultProfile, defaultSettings);
    const r = profileFromDraft({ ...d, specialCondition: true }, defaultSettings);
    expect(r.ok && r.profile.specialCondition).toBe(true);
  });
});
