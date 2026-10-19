import { expect, test, type Page } from '@playwright/test';

const ROUTES = [
  '/',
  '/habits',
  '/health/weight',
  '/health/diet',
  '/health/exercise',
  '/health/journal',
  '/reports',
  '/settings',
];

async function demo(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'ابتدا با دادهٔ نمونه ببینم' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'تأیید', exact: true }).click();
  await expect(page.locator('.hero-card')).toBeVisible();
}

for (const theme of ['light', 'dark'] as const) {
  for (const [device, viewport] of Object.entries({
    mobile: { width: 375, height: 812 },
    desktop: { width: 1440, height: 1000 },
  })) {
    test(`${theme} ${device}: routes, rendered colors and charts`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await demo(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const tokens = await page.evaluate(() => {
        const s = getComputedStyle(document.documentElement);
        return Object.fromEntries(
          ['bg', 'primary', 'on-primary', 'hero-start', 'hero-end', 'teal', 'blue'].map((key) => [
            key,
            s.getPropertyValue(`--${key}`).trim(),
          ]),
        );
      });
      expect(tokens.teal).not.toBe(tokens.primary);
      await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', tokens.bg);
      const hero = await page
        .locator('.hero-card')
        .evaluate((el) => getComputedStyle(el).backgroundImage);
      expect(hero).toContain(theme === 'light' ? 'rgb(37, 92, 219)' : 'rgb(35, 79, 184)');
      await expect(page.locator('.hero-action')).toHaveCSS('color', 'rgb(255, 255, 255)');
      await page.locator('.hero-action').focus();
      await expect(page.locator('.hero-action')).toHaveCSS('outline-color', 'rgb(255, 255, 255)');
      await page.locator('.hero-action').blur();
      const rendered = await page.evaluate(() => {
        const luminance = (color: string) => {
          const rgb = color
            .match(/[\d.]+/g)
            ?.slice(0, 3)
            .map(Number);
          if (!rgb || rgb.length !== 3) throw new Error(`Unresolved rendered color: ${color}`);
          const c = rgb.map((v) => {
            const s = v / 255;
            return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          });
          return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
        };
        const ratio = (a: string, b: string) => {
          const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
          return (hi + 0.05) / (lo + 0.05);
        };
        const rows: { selector: string; ratio: number; min: number }[] = [];
        for (const selector of [
          '.tone-icon',
          '.brand-mark',
          '.hero-action',
          '.nav-link.active',
          '.btn-secondary',
        ]) {
          const els = document.querySelectorAll(selector);
          if (!els.length) throw new Error(`Missing color sample ${selector}`);
          for (const el of els) {
            const s = getComputedStyle(el);
            rows.push({ selector, ratio: ratio(s.color, s.backgroundColor), min: 4.5 });
          }
        }
        const hero = document.querySelector('.hero-card')!;
        const stops = getComputedStyle(hero).backgroundImage.match(/rgb\([^)]+\)/g);
        if (stops?.length !== 2) throw new Error('Expected two opaque hero gradient stops');
        for (const selector of ['h2', '.muted', '.hero-secondary']) {
          const el = hero.querySelector(selector)!;
          for (const stop of stops)
            rows.push({
              selector: `hero ${selector}`,
              ratio: ratio(getComputedStyle(el).color, stop),
              min: 4.5,
            });
        }
        for (const el of document.querySelectorAll('.icon-btn')) {
          const s = getComputedStyle(el);
          if (parseFloat(s.borderTopWidth) > 0)
            rows.push({
              selector: 'control boundary',
              ratio: ratio(s.borderTopColor, s.backgroundColor),
              min: 3,
            });
        }
        return rows;
      });
      for (const row of rendered) expect(row.ratio, row.selector).toBeGreaterThanOrEqual(row.min);
      await testInfo.attach('rendered contrast', {
        body: JSON.stringify(rendered),
        contentType: 'application/json',
      });
      await page.screenshot({
        path: testInfo.outputPath(`today-${theme}-${device}.png`),
        fullPage: true,
      });

      for (const route of ROUTES) {
        await page.goto(`/#${route}`);
        await expect(page.locator('main h1')).toBeVisible();
        if (route === '/habits') {
          await expect(page.locator('.habit-heat-cell').first()).toHaveAttribute(
            'aria-label',
            /.+/,
          );
          for (const color of ['teal', 'blue', 'orange', 'violet', 'rose']) {
            expect(
              await page.evaluate(
                (tone) =>
                  getComputedStyle(document.documentElement).getPropertyValue(`--${tone}`).trim(),
                color,
              ),
            ).toMatch(/^#[\da-f]{6}$/i);
          }
        }
        await expect(page.getByText(/مشکلی پیش آمد|خطای غیرمنتظره/)).toHaveCount(0);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        );
        expect(overflow, `${route} horizontal overflow`).toBe(false);
        if (route === '/health/weight') {
          await expect(page.locator('.recharts-line').first()).toBeVisible();
          await expect(
            page.locator('.recharts-line path.recharts-line-curve').nth(1),
          ).toHaveAttribute('stroke-dasharray', '5 4');
          await page.screenshot({
            path: testInfo.outputPath(`weight-${theme}-${device}.png`),
            fullPage: true,
          });
        }
      }
      expect(errors).toEqual([]);
      await testInfo.attach('theme tokens', {
        body: JSON.stringify(tokens),
        contentType: 'application/json',
      });
    });
  }
}

test('theme preference updates chrome, controls and persists on reload', async ({ page }) => {
  await demo(page);
  await page.goto('/#/settings');
  const theme = page.getByRole('group', { name: 'ظاهر برنامه' });
  await theme.getByRole('button', { name: 'تیره', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.goto('/#/habits');
  await expect(page.locator('.btn-primary').first()).toHaveCSS('color', 'rgb(16, 35, 70)');
  await page.locator('.btn-primary').first().hover();
  await expect(page.locator('.btn-primary').first()).toHaveCSS(
    'background-color',
    'rgb(173, 202, 255)',
  );
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.goto('/#/settings');
  await theme.getByRole('button', { name: 'روشن', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#f5f7fc');
  await page.getByRole('button', { name: 'حذف همهٔ اطلاعات', exact: true }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm.locator('.btn-danger')).toHaveCSS('color', 'rgb(255, 255, 255)');
  await confirm.getByRole('button', { name: 'انصراف', exact: true }).click();
  await theme.getByRole('button', { name: 'همراه دستگاه', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'حذف همهٔ اطلاعات', exact: true }).click();
  await expect(confirm.locator('.btn-danger')).toHaveCSS('color', 'rgb(66, 19, 33)');
  await confirm.getByRole('button', { name: 'انصراف', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

for (const theme of ['light', 'dark'] as const) {
  test(`${theme}: first run, invalid fields and empty pages`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/');
    await expect(page.locator('.onboarding-art')).toBeVisible();
    await expect(page.locator('.onboarding-art')).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const age = page.getByLabel('سن (سال)', { exact: true });
    await age.fill('10');
    await page.getByRole('button', { name: 'ادامه', exact: true }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await age.fill('30');
    for (let step = 0; step < 3; step += 1)
      await page.locator('form button[type="submit"]').click();
    await expect(page.locator('.hero-card')).toBeVisible();
    await page.goto('/#/health/diet');
    await expect(page.locator('.empty-state').first()).toBeVisible();
    await expect(page.locator('.empty-orbit').first()).toHaveCSS(
      'color',
      theme === 'light' ? 'rgb(30, 70, 172)' : 'rgb(173, 202, 255)',
    );
    await page.goto('/#/health/weight');
    await page.getByRole('button', { name: 'ثبت وزن', exact: true }).first().click();
    const dialog = page.getByRole('dialog');
    const input = dialog.locator('#weight-weight');
    await input.fill('0');
    await dialog.locator('button[type="submit"]').click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog.locator('#weight-weight-error')).toHaveCSS(
      'color',
      theme === 'light' ? 'rgb(180, 35, 56)' : 'rgb(255, 159, 172)',
    );
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });
}
