import { describe, expect, it, vi } from 'vitest';
import {
  compressPhoto,
  photoPolicy,
  validatePhotoFile,
  type PhotoAdapter,
} from './photoCompression';

const file = (type = 'image/jpeg', size = 100) =>
  new File([new Uint8Array(size)], 'photo', { type });
function adapter(width = 2400, height = 1200, sizes = [1000]) {
  const release = vi.fn();
  const calls: Array<{ width: number; height: number; quality: number }> = [];
  const value: PhotoAdapter = {
    decode: async () => ({ source: {} as CanvasImageSource, width, height, release }),
    encode: async (_source, w, h, quality) => {
      calls.push({ width: w, height: h, quality });
      return new Blob([new Uint8Array(sizes[Math.min(calls.length - 1, sizes.length - 1)])], {
        type: 'image/jpeg',
      });
    },
    read: async (blob) => `data:image/jpeg;base64,${btoa('a'.repeat(blob.size))}`,
  };
  return { value, release, calls };
}
describe('bounded local-only photo compression policy', () => {
  it('accepts only JPEG PNG WebP up to and including 10 MiB', () => {
    expect(photoPolicy.maxInputBytes).toBe(10 * 1024 * 1024);
    for (const type of ['image/jpeg', 'image/png', 'image/webp'])
      expect(validatePhotoFile(file(type))).toBeNull();
    for (const type of ['image/svg+xml', 'image/heic', 'image/gif', ''])
      expect(validatePhotoFile(file(type))).not.toBeNull();
    expect(validatePhotoFile(file('image/png', 10 * 1024 * 1024))).toBeNull();
    expect(validatePhotoFile(file('image/png', 10 * 1024 * 1024 + 1))).not.toBeNull();
    expect(validatePhotoFile(file('image/png', 0))).not.toBeNull();
  });
  it('re-encodes to JPEG with a 1280 long edge, preserves aspect, and releases decoder resources', async () => {
    const a = adapter();
    const result = await compressPhoto(file('image/png'), a.value);
    expect(result).toMatchObject({ width: 1280, height: 640, bytes: 1000 });
    expect(result.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(a.calls[0]).toMatchObject({ width: 1280, height: 640 });
    expect(a.release).toHaveBeenCalledOnce();
  });
  it('does not enlarge small portraits', async () => {
    const a = adapter(200, 400);
    expect(await compressPhoto(file(), a.value)).toMatchObject({ width: 200, height: 400 });
  });
  it('reduces quality then dimensions until payload is <=512 KiB', async () => {
    const a = adapter(2400, 1200, [700000, 700000, 700000, 700000, 700000, 400000]);
    const result = await compressPhoto(file(), a.value);
    expect(result.bytes).toBeLessThanOrEqual(512 * 1024);
    expect(a.calls.length).toBeGreaterThan(1);
    expect(a.calls.some((x) => x.width < 1280)).toBe(true);
    expect(a.calls.every((x) => x.height === x.width / 2)).toBe(true);
  });
  it('terminates oversized compression rather than storing original bytes', async () => {
    const a = adapter(2400, 1200, [600000]);
    await expect(compressPhoto(file(), a.value)).rejects.toThrow();
    expect(a.calls.length).toBeLessThanOrEqual(30);
    expect(a.release).toHaveBeenCalledOnce();
  });
  it('rejects invalid files before decoding', async () => {
    const a = adapter();
    const decode = vi.spyOn(a.value, 'decode');
    await expect(compressPhoto(file('image/heic'), a.value)).rejects.toThrow();
    expect(decode).not.toHaveBeenCalled();
  });
  it('propagates decode, canvas, missing blob and data URL failures without a successful result', async () => {
    const a = adapter();
    await expect(
      compressPhoto(file(), {
        ...a.value,
        decode: async () => {
          throw new Error('decode');
        },
      }),
    ).rejects.toThrow('decode');
    await expect(
      compressPhoto(file(), {
        ...a.value,
        encode: async () => {
          throw new Error('canvas');
        },
      }),
    ).rejects.toThrow('canvas');
    await expect(compressPhoto(file(), { ...a.value, encode: async () => null })).rejects.toThrow();
    await expect(
      compressPhoto(file(), { ...a.value, read: async () => 'data:image/png;base64,wrong' }),
    ).rejects.toThrow();
    await expect(
      compressPhoto(file(), {
        ...a.value,
        encode: async () => new Blob([], { type: 'image/jpeg' }),
      }),
    ).rejects.toThrow();
    await expect(compressPhoto(file(), adapter(0, 400).value)).rejects.toThrow();
    expect(a.release).toHaveBeenCalledTimes(4);
  });
});
