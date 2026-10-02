import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import app from '../app.json';

const dir = path.join(__dirname, '..', 'assets');
const load = (name: string) => PNG.sync.read(fs.readFileSync(path.join(dir, name)));
const px = (png: PNG, x: number, y: number) => {
  const i = (png.width * y + x) * 4;
  return { r: png.data[i], g: png.data[i + 1], b: png.data[i + 2], a: png.data[i + 3] };
};
const ACCENT = { r: 0x25, g: 0x63, b: 0xeb };

/** Visible pixels farthest from the centre, as a fraction of the canvas. */
function extent(png: PNG): number {
  let max = 0;
  const c = png.width / 2;
  for (let y = 0; y < png.height; y += 2) {
    for (let x = 0; x < png.width; x += 2) {
      if (px(png, x, y).a > 16) max = Math.max(max, Math.hypot(x - c, y - c));
    }
  }
  return max / png.width;
}

describe('brand assets', () => {
  it('has the sizes the stores and Expo expect', () => {
    for (const f of ['icon.png', 'splash-icon.png', 'android-icon-foreground.png']) {
      const p = load(f);
      expect([p.width, p.height]).toEqual([1024, 1024]);
    }
    expect(load('favicon.png').width).toBe(48);
  });

  it('keeps the iOS icon fully opaque (App Store rejects transparency)', () => {
    const p = load('icon.png');
    for (const [x, y] of [
      [0, 0],
      [1023, 0],
      [0, 1023],
      [1023, 1023],
      [512, 512],
    ]) {
      expect(px(p, x, y).a).toBe(255);
    }
  });

  it('uses a flat accent colour for the Android background and app.json', () => {
    const p = load('android-icon-background.png');
    expect(px(p, 0, 0)).toMatchObject({ ...ACCENT, a: 255 });
    expect(px(p, 700, 300)).toMatchObject({ ...ACCENT, a: 255 });
    expect(app.expo.android.adaptiveIcon.backgroundColor.toLowerCase()).toBe('#2563eb');
  });

  it('keeps adaptive-icon artwork inside the 66/108 safe zone', () => {
    for (const f of ['android-icon-foreground.png', 'android-icon-monochrome.png']) {
      const p = load(f);
      expect(px(p, 0, 0).a).toBe(0);
      expect(extent(p)).toBeLessThanOrEqual(66 / 108 / 2 + 0.01);
    }
  });

  it('draws the monochrome layer in white only', () => {
    const p = load('android-icon-monochrome.png');
    let seen = 0;
    for (let y = 0; y < p.height; y += 8) {
      for (let x = 0; x < p.width; x += 8) {
        const v = px(p, x, y);
        if (v.a > 0) {
          seen++;
          expect([v.r, v.g, v.b]).toEqual([255, 255, 255]);
        }
      }
    }
    expect(seen).toBeGreaterThan(100);
  });

  it('leaves the splash image transparent around the mark', () => {
    const p = load('splash-icon.png');
    expect(px(p, 0, 0).a).toBe(0);
    expect(px(p, 1023, 1023).a).toBe(0);
  });
});
