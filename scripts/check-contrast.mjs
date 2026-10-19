/** WCAG contrast regression check, using the shipped CSS tokens (no duplicate palette). */
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
function tokens(selector) {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`Missing theme: ${selector}`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries(
    [...body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );
}
function rgb(hex) {
  if (!/^#[\da-f]{6}$/i.test(hex)) throw new Error(`Expected opaque hex token, got ${hex}`);
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
}
function luminance(hex) {
  const c = rgb(hex).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const tones = ['teal', 'blue', 'orange', 'violet', 'rose'];
let failures = 0;
for (const [name, selector] of [
  ['light', ':root {'],
  ['dark', ":root[data-theme='dark'] {"],
]) {
  const t = tokens(selector);
  const rows = [];
  // Missing values throw: silently skipping a role would produce a false pass.
  const need = (fg, bg, min) => {
    if (!t[fg] || !t[bg]) throw new Error(`${name}: missing ${!t[fg] ? fg : bg}`);
    const ratio = contrast(t[fg], t[bg]);
    rows.push({ pair: `${fg} / ${bg}`, ratio: +ratio.toFixed(2), min, pass: ratio >= min });
  };
  const surfaces = [
    'bg',
    'surface',
    'surface-soft',
    'primary-soft',
    'heat-partial',
    ...tones.map((tone) => `${tone}-soft`),
  ];
  for (const bg of surfaces) {
    need('ink', bg, 4.5);
    need('muted', bg, 4.5);
  }
  for (const bg of ['bg', 'surface', 'surface-soft']) {
    need('primary-strong', bg, 4.5);
    need('primary', bg, 3); // Focus/control state, not normal text.
    need('danger', bg, 4.5);
    need('control-line', bg, 3);
  }
  need('primary-strong', 'primary-soft', 4.5);
  need('on-primary', 'primary', 4.5);
  need('on-primary', 'primary-strong', 4.5);
  need('on-danger', 'danger', 4.5);
  need('on-heat-full', 'heat-full', 4.5);
  for (const tone of tones) {
    need(tone, 'surface', 4.5);
    need(tone, `${tone}-soft`, 4.5);
    need(tone, 'surface-soft', 3); // Progress fills on their actual track.
  }
  // Every gradient channel is monotone between these stops, so the minimum
  // text contrast occurs at a stop. The action has its own opaque background.
  for (const bg of ['hero-start', 'hero-end', 'hero-action']) {
    need('on-hero', bg, 4.5);
    need('hero-muted', bg, 4.5);
    need('on-hero', bg, 3); // Inverse focus ring.
  }
  need('hero-progress', 'hero-start', 3);
  need('hero-progress', 'hero-end', 3);
  need('hero-progress', 'hero-track', 3);
  for (const key of ['series-1', 'series-2', 'series-3']) need(key, 'surface', 3);
  const failed = rows.filter((r) => !r.pass);
  failures += failed.length;
  console.log(`${name}: ${rows.length - failed.length}/${rows.length} contrast pairs pass`);
  if (failed.length) console.table(failed);
}
process.exitCode = failures ? 1 : 0;
