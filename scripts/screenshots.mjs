import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const base = process.env.SCREENSHOT_BASE ?? 'http://localhost:4173/fit-tracker-pwa/';
const out = new URL('../docs/screenshots/', import.meta.url);
await mkdir(out, { recursive: true });
const shots = [
  ['today', ''],
  ['habits', '#/habits'],
  ['weight', '#/health/weight'],
  ['diet', '#/health/diet'],
  ['exercise', '#/health/exercise'],
  ['journal', '#/health/journal'],
  ['reports', '#/reports'],
  ['settings', '#/settings'],
];
const browser = await chromium.launch({
  executablePath: process.env.SCREENSHOT_BROWSER || undefined,
  channel: process.env.SCREENSHOT_BROWSER ? undefined : 'chrome',
});
for (const scheme of ['light', 'dark']) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: scheme,
    locale: 'fa-IR',
  });
  const page = await context.newPage();
  await page.goto(base, { waitUntil: 'networkidle' });
  const seed = page.getByRole('button', { name: 'ابتدا با دادهٔ نمونه ببینم' });
  if (await seed.count()) {
    await seed.click();
    await page.getByRole('dialog').getByRole('button', { name: 'تأیید' }).click();
  }
  await page.waitForSelector('.hero-card', { timeout: 30000 });
  for (const [name, hash] of shots) {
    await page.goto(`${base}${hash}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    if (scheme === 'dark' && name !== 'today') continue;
    await page.screenshot({ path: new URL(`${name}-${scheme}.png`, out).pathname.slice(1) });
  }
  await context.close();
}
await browser.close();
console.log('Screenshots written to docs/screenshots');
