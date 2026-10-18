export const photoPolicy = {
  maxInputBytes: 10 * 1024 * 1024,
  maxOutputBytes: 512 * 1024,
  maxEdge: 1280,
} as const;
export interface DecodedPhoto {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}
export interface PhotoAdapter {
  decode: (file: File) => Promise<DecodedPhoto>;
  encode: (
    source: CanvasImageSource,
    width: number,
    height: number,
    quality: number,
  ) => Promise<Blob | null>;
  read: (blob: Blob) => Promise<string>;
}
export function validatePhotoFile(file: File): string | null {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    return 'فقط فایل JPEG، PNG یا WebP قابل‌استفاده است؛ SVG و HEIC پشتیبانی نمی‌شوند.';
  if (file.size === 0) return 'فایل انتخاب‌شده خالی است.';
  if (file.size > photoPolicy.maxInputBytes) return 'حجم فایل باید حداکثر ۱۰ مگابایت باشد.';
  return null;
}
const browserAdapter: PhotoAdapter = {
  async decode(file) {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    }
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('خواندن تصویر ممکن نیست.'));
        image.src = url;
      });
      return {
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        release: () => URL.revokeObjectURL(url),
      };
    } catch (error) {
      URL.revokeObjectURL(url);
      throw error;
    }
  },
  async encode(source, width, height, quality) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('مرورگر امکان پردازش تصویر را ندارد.');
    // Flatten transparency onto a defined white backdrop; only pixels are re-encoded, not metadata.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(source, 0, 0, width, height);
    return new Promise<Blob | null>((resolve, reject) => {
      try {
        canvas.toBlob(resolve, 'image/jpeg', quality);
      } catch (error) {
        reject(error);
      }
    });
  },
  read(blob) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        typeof reader.result === 'string'
          ? resolve(reader.result)
          : reject(new Error('خروجی تصویر معتبر نیست.'));
      reader.onerror = () => reject(new Error('خواندن خروجی تصویر ممکن نیست.'));
      reader.onabort = () => reject(new Error('پردازش تصویر متوقف شد.'));
      reader.readAsDataURL(blob);
    });
  },
};
export async function compressPhoto(
  file: File,
  adapter: PhotoAdapter = browserAdapter,
): Promise<{ dataUrl: string; bytes: number; width: number; height: number }> {
  const error = validatePhotoFile(file);
  if (error) throw new Error(error);
  const image = await adapter.decode(file);
  try {
    if (
      !Number.isFinite(image.width) ||
      !Number.isFinite(image.height) ||
      image.width < 1 ||
      image.height < 1
    )
      throw new Error('ابعاد تصویر معتبر نیست.');
    const scale = Math.min(1, photoPolicy.maxEdge / Math.max(image.width, image.height));
    // At most 6 size rounds × 5 quality levels. Never retain the original file or scale upward.
    for (let round = 0; round < 6; round++) {
      const factor = scale * 0.8 ** round;
      const width = Math.max(1, Math.round(image.width * factor));
      const height = Math.max(1, Math.round(image.height * factor));
      for (const quality of [0.9, 0.8, 0.7, 0.6, 0.5]) {
        const blob = await adapter.encode(image.source, width, height, quality);
        if (!blob || blob.type !== 'image/jpeg' || !blob.size)
          throw new Error('مرورگر خروجی JPEG معتبری نساخت.');
        if (blob.size > photoPolicy.maxOutputBytes) continue;
        const dataUrl = await adapter.read(blob);
        if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl))
          throw new Error('خروجی فشرده‌سازی معتبر نیست.');
        return { dataUrl, bytes: blob.size, width, height };
      }
    }
    throw new Error('تصویر به حجم مجاز نرسید. یک عکس کوچک‌تر انتخاب کنید.');
  } finally {
    image.release();
  }
}
