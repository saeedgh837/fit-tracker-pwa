import { expect, test, type Page } from '@playwright/test';

/**
 * The routes the app serves. HashRouter means each one is a client route, but
 * the offline navigation still has to resolve to the precached shell.
 */
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

/** Finish onboarding so the app shell and its routes are reachable. */
async function completeOnboarding(page: Page): Promise<void> {
  await page.goto('/');
  // The onboarding flow is a few steps; click the primary action until it is gone.
  for (let i = 0; i < 12; i += 1) {
    const next = page.getByRole('button', { name: /ادامه|بعدی|شروع|تمام|ذخیره|بزن|بریم/i }).first();
    if ((await next.count()) === 0) break;
    await next.click().catch(() => undefined);
    await page.waitForTimeout(150);
  }
  await page.waitForLoadState('networkidle');
}

/** Wait until a service worker controls the page. */
async function waitForController(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    await navigator.serviceWorker.ready;
    for (let i = 0; i < 60; i += 1) {
      if (navigator.serviceWorker.controller) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return false;
  });
}

test.describe('service worker and offline behaviour', () => {
  test('registers a service worker on a first visit, before any interaction', async ({ page }) => {
    // This is the regression: registration used to live in a component that
    // rendered only after onboarding, so a first visit was never installable.
    const registrations: string[] = [];
    page.on('response', (response) => {
      const url = response.url();
      if (url.endsWith('/sw.js') || url.includes('workbox-')) registrations.push(url);
    });

    await page.goto('/');

    // Assert the worker appears without touching the page at all.
    const controlled = await waitForController(page);
    expect(controlled, 'service worker should control the page on a first visit').toBe(true);
    expect(registrations.length, 'sw.js should have been requested').toBeGreaterThan(0);
  });

  test('precaches the app shell', async ({ page }) => {
    await page.goto('/');
    await waitForController(page);

    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const workbox = names.find((n) => n.includes('workbox') || n.includes('precache'));
      if (!workbox) return null;
      const cache = await caches.open(workbox);
      const keys = await cache.keys();
      return keys.map((k) => new URL(k.url).pathname);
    });

    expect(cached, 'a workbox precache should exist').not.toBeNull();
    expect(cached!.some((p) => p.endsWith('/index.html'))).toBe(true);
    expect(cached!.some((p) => p.endsWith('/sw.js') || p.includes('workbox'))).toBe(true);
  });

  test('serves every route offline after a single load', async ({ page, context }) => {
    // This is the second regression: without clientsClaim the worker activated
    // but never controlled the tab, so every route except a reload failed.
    await completeOnboarding(page);
    const controlled = await waitForController(page);
    expect(controlled).toBe(true);

    // One pass online so each route's chunks are in the runtime cache.
    for (const route of ROUTES) {
      await page.goto(`/#${route}`);
      await page.waitForLoadState('networkidle');
    }

    await context.setOffline(true);

    for (const route of ROUTES) {
      await page.goto(`/#${route}`);
      // The shell must render: #root must have children and no error boundary.
      const root = page.locator('#root');
      await expect(root).not.toBeEmpty({ timeout: 15_000 });
      await expect(page.getByText(/مشکلی پیش آمد|خطای غیرمنتظره/i)).toHaveCount(0);
    }

    await context.setOffline(false);
  });

  test('ships a manifest that makes the app installable', async ({ page, request }) => {
    const response = await request.get('/manifest.webmanifest');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('manifest');

    const manifest = await response.json();
    expect(manifest.name).toBeTruthy();
    expect(manifest.start_url).toBeTruthy();
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons?.length).toBeGreaterThan(0);
    // A maskable icon is what keeps the home-screen icon from being cropped.
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose?.includes('maskable'))).toBe(
      true,
    );

    await page.goto('/');
    // The link the browser needs in order to offer the install prompt.
    await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
  });

  test('loads no chart code on the landing route', async ({ page }) => {
    // Recharts is 393 KB. It regressed into the startup path once via
    // manualChunks; this asserts it stays behind the lazy boundary.
    const scripts: string[] = [];
    page.on('response', (response) => {
      const url = response.url();
      if (url.endsWith('.js')) scripts.push(url);
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    expect(scripts.some((s) => s.includes('DataChart'))).toBe(false);
    expect(scripts.some((s) => s.includes('recharts'))).toBe(false);
  });
});
