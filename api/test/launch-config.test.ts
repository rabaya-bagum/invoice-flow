import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const mobile = path.join(__dirname, '../../mobile');
const json = (f: string) => JSON.parse(readFileSync(path.join(mobile, f), 'utf8'));

describe('release configuration', () => {
  const eas = json('eas.json');
  const app = json('app.json').expo;

  it('defines development, preview and production build profiles', () => {
    expect(Object.keys(eas.build)).toEqual(['development', 'preview', 'production']);
    expect(eas.build.development.developmentClient).toBe(true);
    expect(eas.build.production.autoIncrement).toBe(true);
    expect(eas.build.production.android.buildType).toBe('app-bundle');
    expect(eas.build.production.channel).toBe('production');
  });

  it('keeps secrets out of the build config', () => {
    const text = JSON.stringify(eas) + JSON.stringify(app);
    expect(text).not.toMatch(/sk_(live|test)_|service_role|whsec_|SECRET/i);
  });

  it('has store-required app metadata', () => {
    expect(app.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(app.ios.bundleIdentifier).toMatch(/^[a-z0-9.-]+$/i);
    expect(app.android.package).toBe(app.ios.bundleIdentifier);
    expect(app.ios.infoPlist.ITSAppUsesNonExemptEncryption).toBe(false);
    expect(app.scheme).toBe('invoiceflow');
    for (const f of [app.icon, app.android.adaptiveIcon.foregroundImage]) {
      expect(existsSync(path.join(mobile, f))).toBe(true);
    }
  });

  it('asks for permission only with a user-facing reason', () => {
    const plugins = JSON.stringify(app.plugins);
    expect(plugins).toContain('faceIDPermission');
    expect(plugins).toContain('photosPermission');
  });

  it('documents exactly the public env vars the app reads', () => {
    const used = new Set<string>();
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name)) {
          for (const m of readFileSync(p, 'utf8').matchAll(/EXPO_PUBLIC_[A-Z_]+/g)) used.add(m[0]);
        }
      }
    };
    walk(path.join(mobile, 'src'));
    const documented = [
      ...readFileSync(path.join(mobile, '.env.example'), 'utf8').matchAll(
        /^(EXPO_PUBLIC_[A-Z_]+)=/gm,
      ),
    ].map((m) => m[1]);
    expect([...used].sort()).toEqual([...new Set(documented)].sort());
  });
});
