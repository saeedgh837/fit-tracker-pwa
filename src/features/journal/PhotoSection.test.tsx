import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../db';
import type { Settings } from '../../db/types';
import PhotoSection from './PhotoSection';

vi.mock('../../store/ui', () => ({
  run: async (action: () => Promise<unknown>) => {
    try {
      await action();
      return true;
    } catch {
      return false;
    }
  },
  toast: vi.fn(),
}));
const settings: Settings = {
  id: 'main',
  weightUnit: 'kg',
  heightUnit: 'cm',
  calendar: 'gregory',
  persianDigits: false,
  theme: 'light',
  weekStartsOn: 6,
  reminders: false,
  reminderHour: 9,
  onboardingComplete: true,
};
const jpg = 'data:image/jpeg;base64,YWJj';
const upload = () =>
  fireEvent.change(screen.getByLabelText('فایل عکس'), {
    target: { files: [new File(['image'], 'photo.png', { type: 'image/png' })] },
  });
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
let objectCounter = 0;
beforeEach(async () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  await db.photos.clear();
  objectCounter = 0;
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => `blob:preview-${++objectCounter}`),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 2400, height: 1200, close: vi.fn() })),
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillStyle: '',
    fillRect: vi.fn(),
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) =>
    callback(new Blob(['new jpeg bytes'], { type: 'image/jpeg' })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('local photos and independent comparison', () => {
  it('separates loading from empty and reading failure with a retry', async () => {
    const view = render(<PhotoSection date="2026-10-18" settings={settings} />);
    expect(screen.getByRole('status')).toHaveTextContent('خواندن');
    await screen.findByText('هنوز عکسی برای این روز ندارید');
    view.unmount();
    vi.spyOn(db.photos, 'toArray').mockRejectedValueOnce(new Error('read'));
    render(<PhotoSection date="2026-10-18" settings={settings} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('خواندن عکس‌ها');
    click('تلاش دوباره');
    await screen.findByText('هنوز عکسی برای این روز ندارید');
  });
  it('compares independent dates, allows every photo on either side and clears deleted selections', async () => {
    await db.photos.bulkPut([
      { id: 'a', date: '2026-10-01', note: 'اول', dataUrl: jpg },
      { id: 'b', date: '2026-10-01', note: 'دوم', dataUrl: jpg },
      { id: 'c', date: '2026-10-18', note: 'جدید', dataUrl: jpg },
    ]);
    render(<PhotoSection date="2026-10-18" settings={settings} />);
    await screen.findByRole('button', { name: 'حذف عکس 1' });
    fireEvent.change(screen.getByLabelText('تاریخ اول مقایسه'), {
      target: { value: '2026-10-01' },
    });
    fireEvent.change(screen.getByLabelText('تاریخ دوم مقایسه'), {
      target: { value: '2026-10-18' },
    });
    const first = screen.getByRole('region', { name: 'عکس اول مقایسه' });
    expect(within(first).getByLabelText('انتخاب عکس اول')).toHaveValue('a');
    fireEvent.change(within(first).getByLabelText('انتخاب عکس اول'), { target: { value: 'b' } });
    expect(within(first).getByRole('img')).toHaveAttribute('alt', expect.stringContaining('دوم'));
    click('حذف عکس 1');
    click('انصراف');
    expect(await db.photos.count()).toBe(3);
    click('حذف عکس 1');
    click('تأیید');
    await waitFor(async () => expect(await db.photos.get('c')).toBeUndefined());
    const second = screen.getByRole('region', { name: 'عکس دوم مقایسه' });
    await waitFor(() => expect(within(second).queryByRole('img')).not.toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('تاریخ دوم مقایسه'), {
      target: { value: '2026-10-01' },
    });
    expect(screen.getByText('برای مقایسه، دو تاریخ متفاوت انتخاب کنید.')).toBeInTheDocument();
  });
  it('stores only re-encoded JPEG after explicit save, captures draft date and cleans preview URLs', async () => {
    const view = render(<PhotoSection date="2026-10-01" settings={settings} />);
    click('افزودن عکس');
    upload();
    expect(await db.photos.count()).toBe(0);
    expect(screen.getByAltText('پیش‌نمایش عکس انتخاب‌شده')).toHaveAttribute(
      'src',
      'blob:preview-1',
    );
    view.rerender(<PhotoSection date="2026-10-18" settings={settings} />);
    click('ذخیره عکس');
    await waitFor(async () => expect(await db.photos.count()).toBe(1));
    expect((await db.photos.toArray())[0]).toMatchObject({
      date: '2026-10-01',
      dataUrl: expect.stringMatching(/^data:image\/jpeg;base64,/),
    });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
  });
  it('cleans previews on file replacement and unmount', () => {
    const view = render(<PhotoSection date="2026-10-01" settings={settings} />);
    click('افزودن عکس');
    upload();
    upload();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-1');
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview-2');
  });
  it('rejects unsupported files and decode/canvas/blob/quota failures without incomplete writes', async () => {
    render(<PhotoSection date="2026-10-01" settings={settings} />);
    click('افزودن عکس');
    fireEvent.change(screen.getByLabelText('فایل عکس'), {
      target: { files: [new File(['svg'], 'x.svg', { type: 'image/svg+xml' })] },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('JPEG');
    expect(await db.photos.count()).toBe(0);
    upload();
    vi.mocked(createImageBitmap).mockRejectedValueOnce(new Error('decode'));
    click('ذخیره عکس');
    await screen.findByText(/عکس ذخیره نشد/);
    expect(await db.photos.count()).toBe(0);
    expect(screen.getByAltText('پیش‌نمایش عکس انتخاب‌شده')).toBeInTheDocument();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValueOnce(null);
    click('ذخیره عکس');
    await waitFor(() => expect(screen.getByRole('button', { name: 'ذخیره عکس' })).toBeEnabled());
    expect(await db.photos.count()).toBe(0);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementationOnce((callback) =>
      callback(null),
    );
    click('ذخیره عکس');
    await waitFor(() => expect(screen.getByRole('button', { name: 'ذخیره عکس' })).toBeEnabled());
    expect(await db.photos.count()).toBe(0);
    vi.spyOn(db.photos, 'put').mockRejectedValueOnce(new Error('quota'));
    click('ذخیره عکس');
    await waitFor(() => expect(screen.getByRole('button', { name: 'ذخیره عکس' })).toBeEnabled());
    expect(await db.photos.count()).toBe(0);
  });
  it('blocks duplicate save while decoding and never moves a pending photo to a new selected date', async () => {
    let resolve!: (value: ImageBitmap) => void;
    vi.mocked(createImageBitmap).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const view = render(<PhotoSection date="2026-10-01" settings={settings} />);
    click('افزودن عکس');
    upload();
    const form = screen.getByLabelText('فایل عکس').closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(createImageBitmap).toHaveBeenCalledOnce();
    view.rerender(<PhotoSection date="2026-10-18" settings={settings} />);
    await act(async () => {
      resolve({ width: 20, height: 10, close: vi.fn() } as unknown as ImageBitmap);
    });
    await waitFor(async () => expect(await db.photos.count()).toBe(1));
    expect((await db.photos.toArray())[0].date).toBe('2026-10-01');
  });
});
