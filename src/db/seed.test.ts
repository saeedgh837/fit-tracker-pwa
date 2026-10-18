import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './index';
import { seedDemo } from './seed';
import { exportBackup, validateBackup } from './backup';
beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});
describe('synthetic demo data', () => {
  it('creates coherent charts and validates its complete backup', async () => {
    await seedDemo();
    expect(await db.weights.count()).toBeGreaterThan(30);
    expect(await db.workouts.count()).toBeGreaterThan(10);
    expect(await db.meals.count()).toBeGreaterThan(100);
    expect(validateBackup(JSON.stringify(await exportBackup())).data.days.length).toBe(45);
  });
  it('refuses to overwrite existing health data', async () => {
    await db.weights.put({
      id: 'real',
      date: '2026-10-18',
      time: '08:00',
      weightKg: 70,
      note: 'شخصی',
    });
    await expect(seedDemo()).rejects.toThrow();
    expect(await db.weights.get('real')).toBeDefined();
  });
});
