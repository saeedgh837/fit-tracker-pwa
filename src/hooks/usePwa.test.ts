import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const registerSW = vi.fn(() => vi.fn(async () => undefined));
vi.mock('virtual:pwa-register', () => ({
  registerSW: () => registerSW(),
}));

const { registerPwa, usePwa } = await import('./usePwa');

describe('usePwa', () => {
  beforeEach(() => {
    registerSW.mockClear();
  });

  it('registers the service worker exactly once, however often it is called', () => {
    registerPwa();
    registerPwa();
    expect(registerSW).toHaveBeenCalledTimes(1);
  });

  it('exposes the install and update surface the UI reads', () => {
    const { result } = renderHook(() => usePwa());
    expect(result.current.installed).toBeTypeOf('boolean');
    expect(result.current.canInstall).toBe(false);
    expect(result.current.needRefresh).toBe(false);
    expect(result.current.offlineReady).toBe(false);
    expect(result.current.updateServiceWorker).toBeTypeOf('function');
  });

  it('reports cannot-install when the browser offered no prompt', async () => {
    const { result } = renderHook(() => usePwa());
    await expect(result.current.install()).resolves.toBe(false);
  });
});
