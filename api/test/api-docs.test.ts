import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildOpenApi, buildPostman, OPS } from '../scripts/build-docs';

const root = path.join(__dirname, '../..');
const read = (f: string) => readFileSync(path.join(root, f), 'utf8');

/** Every route the server mounts, found by reading the code that mounts it. */
function mountedRoutes(): string[] {
  const out: string[] = [];
  for (const file of ['api/src/routes/catalog.ts', 'api/src/routes/me.ts']) {
    for (const m of read(file).matchAll(/\br\.(get|post|put|delete)\(\s*'([^']+)'/g)) {
      out.push(`${m[1]} /v1${m[2]}`.replace(/:(\w+)/g, '{$1}'));
    }
  }
  const app = read('api/src/app.ts');
  for (const m of app.matchAll(/\bapp\.(get|post)\(\s*'([^']+)'/g)) {
    out.push(`${m[1]} ${m[2]}`.replace(/:(\w+)/g, '{$1}'));
  }
  for (const m of read('api/src/routes/health.ts').matchAll(/\.(get)\('([^']+)'/g)) {
    out.push(`${m[1]} ${m[2]}`);
  }
  return out;
}

describe('API documentation', () => {
  const documented = OPS.map((o) => `${o.method} ${o.path}`);

  it('documents every route the server mounts', () => {
    const missing = mountedRoutes().filter((r) => !documented.includes(r));
    expect(missing).toEqual([]);
  });

  it('does not document routes that do not exist', () => {
    const mounted = mountedRoutes();
    const extra = documented.filter((r) => !mounted.includes(r));
    expect(extra).toEqual([]);
  });

  it('has unique operations and resolvable schema references', () => {
    expect(new Set(documented).size).toBe(documented.length);
    const spec = buildOpenApi();
    const refs = [...JSON.stringify(spec).matchAll(/#\/components\/schemas\/(\w+)/g)].map(
      (m) => m[1],
    );
    const unknown = refs.filter((r) => !((r as string) in spec.components.schemas));
    expect(unknown).toEqual([]);
  });

  it("commits the generated files in the repo's Prettier format (so format:check passes in CI)", () => {
    const bin = path.join(root, 'node_modules/.bin/prettier');
    const r = spawnSync(
      bin,
      ['--check', 'docs/openapi.json', 'docs/invoiceflow.postman_collection.json'],
      { cwd: root, encoding: 'utf8' },
    );
    expect(r.stdout + r.stderr).toContain('All matched files use Prettier code style');
    expect(r.status).toBe(0);
  });

  it('keeps the committed files in sync with the generator', () => {
    expect(JSON.parse(read('docs/openapi.json'))).toEqual(
      JSON.parse(JSON.stringify(buildOpenApi())),
    );
    expect(JSON.parse(read('docs/invoiceflow.postman_collection.json'))).toEqual(
      JSON.parse(JSON.stringify(buildPostman())),
    );
  });
});
