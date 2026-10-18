import { create } from 'zustand';
import { today } from '../lib/dates';
interface Toast {
  id: number;
  message: string;
  kind: 'success' | 'error';
}
interface UIState {
  date: string;
  setDate: (date: string) => void;
  quickAdd: boolean;
  setQuickAdd: (value: boolean) => void;
  toasts: Toast[];
  pushToast: (message: string, kind: 'success' | 'error') => void;
  removeToast: (id: number) => void;
}
let counter = 0;
export const useUI = create<UIState>((set) => ({
  date: today(),
  setDate: (date) => set({ date }),
  quickAdd: false,
  setQuickAdd: (quickAdd) => set({ quickAdd }),
  toasts: [],
  pushToast: (message, kind) => {
    const id = ++counter;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, message, kind }] }));
    setTimeout(() => useUI.getState().removeToast(id), 4500);
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
export function toast(message: string, kind: 'success' | 'error' = 'success'): void {
  useUI.getState().pushToast(message, kind);
}
export async function run(action: () => Promise<unknown>, message?: string): Promise<boolean> {
  try {
    await action();
    if (message) toast(message);
    return true;
  } catch (error) {
    const quota =
      error instanceof Error &&
      (error.name === 'QuotaExceededError' || error.message.includes('quota'));
    toast(
      quota
        ? 'فضای دستگاه کافی نیست. پشتیبان بگیرید و چند عکس قدیمی را حذف کنید.'
        : error instanceof Error && /[؀-ۿ]/.test(error.message)
          ? error.message
          : 'ذخیره انجام نشد. فضای دستگاه و دسترسی مرورگر را بررسی کنید.',
      'error',
    );
    return false;
  }
}
