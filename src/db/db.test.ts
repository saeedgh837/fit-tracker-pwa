import { beforeEach, describe, expect, it } from 'vitest';
import { db, changeWater, updateDay } from './index';
import { exportBackup, importBackup } from './backup';
beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});
describe('local persistence', () => {
  it('merges concurrent daily fields without loss', async () => {
    await Promise.all([
      updateDay('2026-10-18', { steps: 5000 }),
      updateDay('2026-10-18', { note: 'یادداشت' }),
    ]);
    const d = await db.days.get('2026-10-18');
    expect(d?.steps).toBe(5000);
    expect(d?.note).toBe('یادداشت');
  });
  it('updates water atomically and never negative', async () => {
    await Promise.all([changeWater('2026-10-18', 250), changeWater('2026-10-18', 250)]);
    expect((await db.days.get('2026-10-18'))?.waterMl).toBe(500);
    await changeWater('2026-10-18', -1000);
    expect((await db.days.get('2026-10-18'))?.waterMl).toBe(0);
  });
  it('round trips backups and rejects malformed files without erasing data', async () => {
    await updateDay('2026-10-18', { steps: 4321 });
    const backup = await exportBackup();
    await updateDay('2026-10-18', { steps: 1 });
    await importBackup(JSON.stringify(backup));
    expect((await db.days.get('2026-10-18'))?.steps).toBe(4321);
    await expect(importBackup('{"version":99}')).rejects.toThrow();
    expect((await db.days.get('2026-10-18'))?.steps).toBe(4321);
  });
  it('rejects duplicate identities and impossible dates before writes', async () => {
    await updateDay('2026-10-18', { steps: 7 });
    const b = await exportBackup();
    b.data.days.push({ ...b.data.days[0] });
    await expect(importBackup(JSON.stringify(b))).rejects.toThrow();
    expect((await db.days.get('2026-10-18'))?.steps).toBe(7);
    b.data.days = [{ ...b.data.days[0], date: '2026-02-30' }];
    await expect(importBackup(JSON.stringify(b))).rejects.toThrow();
  });
});
