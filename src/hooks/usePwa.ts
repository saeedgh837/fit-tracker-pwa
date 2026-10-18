import { create } from 'zustand';
import { registerSW } from 'virtual:pwa-register';
interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
interface PwaState {
  needRefresh: boolean;
  offlineReady: boolean;
  installPrompt: InstallPrompt | null;
  installed: boolean;
  dismissRefresh: () => void;
  dismissOfflineReady: () => void;
  setInstalled: (installed: boolean) => void;
}
function detectStandalone(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches
  );
}
const usePwaStore = create<PwaState>((set) => ({
  needRefresh: false,
  offlineReady: false,
  installPrompt: null,
  installed: detectStandalone(),
  dismissRefresh: () => set({ needRefresh: false }),
  dismissOfflineReady: () => set({ offlineReady: false }),
  setInstalled: (installed) =>
    set((state) => ({ installed, installPrompt: installed ? null : state.installPrompt })),
}));
/**
 * Captures the browser's install prompt. The event only fires on a page the
 * browser considers installable, so it can arrive after React mounts.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    usePwaStore.setState({ installPrompt: event as InstallPrompt });
  });
  window.addEventListener('appinstalled', () => usePwaStore.getState().setInstalled(true));
}
let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | undefined;
/**
 * Registers the service worker once per page load, before any route or
 * onboarding gate renders, so a first visit is installable and offline-capable
 * even if the profile wizard is never completed.
 */
export function registerPwa(): void {
  if (updateServiceWorker) return;
  updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh: () => usePwaStore.setState({ needRefresh: true }),
    onOfflineReady: () => usePwaStore.setState({ offlineReady: true }),
  });
}
async function applyUpdate(reloadPage = true): Promise<void> {
  await updateServiceWorker?.(reloadPage);
}
async function install(): Promise<boolean> {
  const prompt = usePwaStore.getState().installPrompt;
  if (!prompt) return false;
  await prompt.prompt();
  const choice = await prompt.userChoice;
  const accepted = choice.outcome === 'accepted';
  usePwaStore.setState({ installPrompt: accepted ? null : prompt });
  if (accepted) usePwaStore.setState({ installed: true });
  return accepted;
}
export function usePwa() {
  const needRefresh = usePwaStore((s) => s.needRefresh);
  const offlineReady = usePwaStore((s) => s.offlineReady);
  const installPrompt = usePwaStore((s) => s.installPrompt);
  const installed = usePwaStore((s) => s.installed);
  const dismissRefresh = usePwaStore((s) => s.dismissRefresh);
  const dismissOfflineReady = usePwaStore((s) => s.dismissOfflineReady);
  return {
    canInstall: !!installPrompt,
    installed,
    install,
    needRefresh,
    dismissRefresh,
    offlineReady,
    dismissOfflineReady,
    updateServiceWorker: applyUpdate,
  };
}
