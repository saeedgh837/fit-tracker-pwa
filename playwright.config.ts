import { defineConfig, devices } from '@playwright/test';

/**
 * These tests exist because the two worst bugs in this app were invisible to
 * unit tests: the service worker was registered behind the onboarding gate, so
 * a first visit was never installable, and `clientsClaim` was missing, so every
 * route failed offline until a manual reload. Both only appear on a fresh
 * device driving the real build. So we test the built app, not the dev server.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Locally, use the installed Chrome so no browser download is needed.
        // CI installs the bundled build and runs without this.
        channel: process.env.CI ? undefined : 'chrome',
      },
    },
  ],
  webServer: {
    // `vite preview` serves dist/ the way a static host does, which is what the
    // service worker scope and the manifest paths depend on.
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    // Never reuse a server we did not start. A leftover preview from another
    // run can be serving a different build (say the GitHub Pages base), and the
    // tests would then be checking an artifact nobody ships.
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      // Root-served, like the nginx install; the Pages build is covered by CI.
      APP_BASE: '/',
    },
  },
});
