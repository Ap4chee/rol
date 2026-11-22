// Granice między częściami frontendu, sprawdzane na importach. Gdy test pęka, wspólna rzecz powinna trafić
// do shared/ albo features/fields/, a składanie funkcji w całość do app/.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const IMPORT = /^import\s[^'"]*['"]([^'"]+)['"]/gm;

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : /\.(jsx?|tsx?)$/.test(entry.name) ? [path] : [];
  });
}

/** Moduł docelowy importu jako ścieżka względem frontend/ (alias @/ albo ścieżka względna); pakiety pomijamy. */
function target(file, spec) {
  if (spec.startsWith('@/')) return spec.slice(2);
  if (!spec.startsWith('.')) return null;
  return relative(ROOT, join(file, '..', spec)).split(sep).join('/');
}

const imports = files(ROOT).map((file) => ({
  from: relative(ROOT, file).split(sep).join('/'),
  to: [...readFileSync(file, 'utf8').matchAll(IMPORT)].map((m) => target(file, m[1])).filter(Boolean),
}));

test('funkcje nie importują się nawzajem (poza wspólnym modelem pola)', () => {
  const crossing = imports.flatMap(({ from, to }) => {
    const own = from.match(/^features\/([^/]+)\//)?.[1];
    if (!own) return [];
    return to.filter((path) => path.startsWith('features/') && !path.startsWith(`features/${own}/`) && !path.startsWith('features/fields/'))
      .map((path) => `${from} → ${path}`);
  });
  assert.deepEqual(crossing, []);
});

test('shared/ nie zależy od funkcji ani od aplikacji', () => {
  const upward = imports.filter(({ from }) => from.startsWith('shared/'))
    .flatMap(({ from, to }) => to.filter((path) => /^(features|app)\//.test(path)).map((path) => `${from} → ${path}`));
  assert.deepEqual(upward, []);
});

test('kod Spectrum UI tylko przez shared/ui', () => {
  const direct = imports.filter(({ from }) => !from.startsWith('shared/'))
    .flatMap(({ from, to }) => to.filter((path) => path.startsWith('shared/vendor/')).map((path) => `${from} → ${path}`));
  assert.deepEqual(direct, []);
});

test('czysta logika (logic.js, format, api) nie importuje Reacta', () => {
  const pure = files(ROOT).filter((file) => /([\/]logic\.js|[\/]format[\/][a-z]+\.js|[\/]api[\/][a-z]+\.js)$/.test(file));
  const withReact = pure.filter((file) => /from ['"](react|react-dom)/.test(readFileSync(file, 'utf8')));
  assert.deepEqual(withReact.map((file) => relative(ROOT, file)), []);
});
