/**
 * Stand-in for the PWA plugin's virtual module during tests; the real one is
 * generated at build time by vite-plugin-pwa.
 */
export function registerSW(): (reloadPage?: boolean) => Promise<void> {
  return async () => undefined;
}
