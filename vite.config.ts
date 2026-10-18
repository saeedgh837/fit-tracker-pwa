import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { preloadFirstPaintFonts } from './scripts/vitePluginPreloadFonts';
/**
 * Deployment root. GitHub Pages serves the app from /fit-tracker-pwa/, while a
 * self-hosted nginx install serves it from / — set APP_BASE=/ when building for
 * a domain root. Always normalised to a single leading and trailing slash.
 */
function normaliseBase(value = '/fit-tracker-pwa'): string {
  const trimmed = value.trim().replace(/^\/+|\/+$/g, '');
  return trimmed ? `/${trimmed}/` : '/';
}
const base = normaliseBase(process.env.APP_BASE);

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    preloadFirstPaintFonts(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/*.png', 'favicon.svg'],
      manifest: {
        id: base,
        name: 'همگام | سلامت روزانه',
        short_name: 'همگام',
        description: 'چک‌لیست روزانه، تغذیه و مسیر تندرستی، روی دستگاه شما',
        lang: 'fa',
        dir: 'rtl',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'any',
        theme_color: '#087f80',
        background_color: '#f2f7fa',
        categories: ['health', 'fitness', 'lifestyle'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // Take over the tab that registered us so a first visit can go offline
        // without a manual reload. Updates still wait for the user's go-ahead
        // through the in-app banner, so skipWaiting stays off.
        clientsClaim: true,
      },
      devOptions: { enabled: false },
    }),
  ],
});
