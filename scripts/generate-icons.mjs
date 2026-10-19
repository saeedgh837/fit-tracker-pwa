import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
const dir = new URL('../public/icons/', import.meta.url);
await mkdir(dir, { recursive: true });
const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#255cdb"/><stop offset="1" stop-color="#203a80"/></linearGradient></defs><rect width="512" height="512" rx="112" fill="url(#g)"/><circle cx="256" cy="256" r="155" fill="none" stroke="#ffffff25" stroke-width="24"/><path d="M145 265h63l31-75 47 139 33-64h49" fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round" stroke-width="23"/><circle cx="363" cy="158" r="26" fill="#ffcf86"/></svg>`;
for (const size of [192, 512])
  await sharp(Buffer.from(icon))
    .resize(size, size)
    .png()
    .toFile(fileURLToPath(new URL(`icon-${size}.png`, dir)));
await sharp(Buffer.from(icon))
  .resize(180, 180)
  .png()
  .toFile(fileURLToPath(new URL('apple-touch-icon.png', dir)));
const maskable = icon.replace('rx="112"', 'rx="0"').replace('<circle cx="256"', '<circle cx="256"');
await sharp(Buffer.from(maskable))
  .png()
  .toFile(fileURLToPath(new URL('maskable-512.png', dir)));
await writeFile(new URL('../public/favicon.svg', import.meta.url), icon);
console.log('Generated app, maskable and Apple icons');
