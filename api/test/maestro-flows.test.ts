import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The Maestro flows can only run on a device, so this keeps them honest between runs: every label a
 * flow taps or expects must still exist somewhere in the app's source (or in the flow's own typing).
 */
const flowsDir = path.join(__dirname, '../../mobile/.maestro');
const srcDir = path.join(__dirname, '../../mobile/src');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );
}
const source = walk(srcDir)
  .filter((f) => /\.tsx?$/.test(f))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

const flows = readdirSync(flowsDir).filter((f) => /^\d+-.*\.yaml$/.test(f));

describe('Maestro flows', () => {
  it('has flows', () => expect(flows.length).toBeGreaterThanOrEqual(3));

  it.each(flows)('%s only references labels that exist in the app', (file) => {
    const text = readFileSync(path.join(flowsDir, file), 'utf8');
    expect(text).toMatch(/^appId: com\.invoiceflow\.app$/m);
    const typed = [...text.matchAll(/inputText: "([^"]+)"/g)].map((m) => m[1]);
    const labels = [
      ...text.matchAll(/(?:tapOn|assertVisible):\s*"([^"]+)"/g),
      ...text.matchAll(/text:\s*"([^"]+)"/g),
    ]
      .map((m) => (m[1] as string).replace(/\.\*$/, ''))
      .filter((l) => !typed.includes(l));
    const missing = labels.filter((l) => !source.includes(l) && !/^Item \d/.test(l));
    expect(missing).toEqual([]);
  });

  it('uses the app id configured in app.json', () => {
    const app = JSON.parse(readFileSync(path.join(__dirname, '../../mobile/app.json'), 'utf8'));
    expect(app.expo.ios.bundleIdentifier).toBe('com.invoiceflow.app');
    expect(app.expo.android.package).toBe('com.invoiceflow.app');
  });
});
