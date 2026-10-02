/* global __dirname, process, console */
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Generates the app icon, Android adaptive-icon layers, splash mark and favicon into mobile/assets.
 *
 *   pnpm --filter @invoiceflow/mobile assets:build -- --color "#2563EB"
 *
 * The mark (a document with a check) is a simple stand-in so builds are never submitted with the Expo
 * template icon. Replace it with real brand artwork before launch; keep the sizes and rules checked by
 * __tests__/brand-assets.test.ts (opaque 1024 icon, adaptive layers inside the 66/108 safe zone, ...).
 */
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');

const OUT = path.join(__dirname, '../assets');
const SIZE = 1024;

function parseColor(argv) {
  const i = argv.indexOf('--color');
  const value = i >= 0 ? argv[i + 1] : '#2563EB';
  if (!/^#[0-9a-fA-F]{6}$/.test(value ?? '')) throw new Error('Use --color "#RRGGBB"');
  return value.toUpperCase();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * The mark: a sheet with a folded corner and three lines, and a check badge. `size` is the width of the
 * whole mark; `fg` is the sheet, `bg` is the colour "cut out" for lines and the badge ring.
 */
function drawMark(ctx, cx, cy, size, fg, bg) {
  const w = size * 0.62;
  const h = size * 0.8;
  const x = cx - w / 2 - size * 0.04;
  const y = cy - h / 2 - size * 0.02;
  const fold = w * 0.3;
  // sheet with the top-right corner folded
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.moveTo(x + size * 0.06, y);
  ctx.lineTo(x + w - fold, y);
  ctx.lineTo(x + w, y + fold);
  ctx.lineTo(x + w, y + h - size * 0.06);
  ctx.arcTo(x + w, y + h, x + w - size * 0.06, y + h, size * 0.06);
  ctx.lineTo(x + size * 0.06, y + h);
  ctx.arcTo(x, y + h, x, y + h - size * 0.06, size * 0.06);
  ctx.lineTo(x, y + size * 0.06);
  ctx.arcTo(x, y, x + size * 0.06, y, size * 0.06);
  ctx.closePath();
  ctx.fill();
  // the fold
  ctx.fillStyle = bg;
  ctx.globalAlpha = 0.28;
  ctx.beginPath();
  ctx.moveTo(x + w - fold, y);
  ctx.lineTo(x + w - fold, y + fold);
  ctx.lineTo(x + w, y + fold);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
  // text lines
  ctx.fillStyle = bg;
  const lx = x + w * 0.16;
  const lw = w * 0.68;
  for (const [i, frac] of [
    [0, 1],
    [1, 0.82],
    [2, 0.55],
  ]) {
    roundRect(ctx, lx, y + h * (0.34 + i * 0.13), lw * frac, h * 0.045, h * 0.022);
    ctx.fill();
  }
  // check badge
  const r = size * 0.19;
  const bx = x + w - r * 0.2;
  const by = y + h - r * 0.2;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(bx, by, r * 1.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.arc(bx, by, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = bg;
  ctx.lineWidth = r * 0.24;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(bx - r * 0.42, by + r * 0.02);
  ctx.lineTo(bx - r * 0.1, by + r * 0.34);
  ctx.lineTo(bx + r * 0.46, by - r * 0.3);
  ctx.stroke();
}

function render(size, paint) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  paint(ctx, size);
  return canvas.toBuffer('image/png');
}

function tint(hex, amount) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const mix = (v) => Math.round(255 - (255 - v) * amount);
  return `#${[r, g, b].map((v) => mix(v).toString(16).padStart(2, '0')).join('')}`;
}

function build(color) {
  const files = {};
  // iOS / store icon: opaque, full bleed (the system rounds the corners).
  files['icon.png'] = render(SIZE, (ctx, s) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, s, s);
    drawMark(ctx, s / 2, s / 2, s * 0.58, '#FFFFFF', color);
  });
  // Android adaptive icon: a plain background layer and a mark that stays inside the 66/108 safe zone.
  files['android-icon-background.png'] = render(SIZE, (ctx, s) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, s, s);
  });
  files['android-icon-foreground.png'] = render(SIZE, (ctx, s) => {
    drawMark(ctx, s / 2, s / 2, s * 0.44, '#FFFFFF', color);
  });
  // Themed (monochrome) icon: the mark in one colour on transparency.
  files['android-icon-monochrome.png'] = render(SIZE, (ctx, s) => {
    ctx.globalCompositeOperation = 'source-over';
    drawMark(ctx, s / 2, s / 2, s * 0.44, '#FFFFFF', '#000000');
    // Cut-outs must be transparent, not black: keep only the white parts, drop the rest.
    const img = ctx.getImageData(0, 0, s, s);
    for (let i = 0; i < img.data.length; i += 4) {
      const white = img.data[i] > 127 && img.data[i + 3] > 127;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = white ? 255 : 0;
    }
    ctx.putImageData(img, 0, 0);
  });
  // Splash mark: transparent, drawn in the accent colour on whatever background the splash uses.
  files['splash-icon.png'] = render(SIZE, (ctx, s) => {
    drawMark(ctx, s / 2, s / 2, s * 0.62, color, '#FFFFFF');
  });
  files['favicon.png'] = render(48, (ctx, s) => {
    ctx.fillStyle = color;
    roundRect(ctx, 0, 0, s, s, s * 0.22);
    ctx.fill();
    drawMark(ctx, s / 2, s / 2, s * 0.62, '#FFFFFF', color);
  });
  return files;
}

module.exports = { build, parseColor, tint };

if (require.main === module) {
  const color = parseColor(process.argv.slice(2));
  const files = build(color);
  for (const [name, buf] of Object.entries(files)) fs.writeFileSync(path.join(OUT, name), buf);
  console.log(`Wrote ${Object.keys(files).length} images to mobile/assets (accent ${color}).`);
  console.log(`Set expo.android.adaptiveIcon.backgroundColor to ${color} in app.json.`);
}
