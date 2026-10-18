import type { Settings } from '../db/types';
export function formatNumber(
  n: number,
  settings: Pick<Settings, 'persianDigits'>,
  decimals = 0,
): string {
  if (!Number.isFinite(n)) return 'ثبت نشده';
  return new Intl.NumberFormat(settings.persianDigits ? 'fa-IR' : 'en-US', {
    maximumFractionDigits: decimals,
  }).format(n);
}
export function toKg(value: number, unit: 'kg' | 'lb'): number {
  return unit === 'lb' ? value / 2.2046226218 : value;
}
export function fromKg(value: number, unit: 'kg' | 'lb'): number {
  return unit === 'lb' ? value * 2.2046226218 : value;
}
export function toCm(value: number, unit: 'cm' | 'in'): number {
  return unit === 'in' ? value * 2.54 : value;
}
export function fromCm(value: number, unit: 'cm' | 'in'): number {
  return unit === 'in' ? value / 2.54 : value;
}
export function downloadFile(content: BlobPart, filename: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
