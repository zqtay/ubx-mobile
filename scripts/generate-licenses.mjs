// Generates src/legal/licenses.json: the open-source packages that ship in the app (from the
// Android bundle's source map) and their licence texts, plus the native libraries listed in
// scripts/native-licenses.json. Run with `npm run licenses` after changing dependencies.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'package.json'));
const own = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name;

function bundledPackages(mapPath) {
  const map = JSON.parse(readFileSync(mapPath, 'utf8'));
  const sources = map.sections ? map.sections.flatMap((s) => s.map.sources ?? []) : map.sources;
  const names = new Set();
  for (const raw of sources) {
    const s = raw.replaceAll('\\', '/');
    const i = s.lastIndexOf('node_modules/');
    if (i < 0) continue;
    const parts = s.slice(i + 'node_modules/'.length).split('/');
    names.add(parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]);
  }
  return names;
}

function exportBundle() {
  const out = mkdtempSync(join(tmpdir(), 'ubx-licenses-'));
  console.log('Exporting the Android bundle with source maps…');
  execFileSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['expo', 'export', '--platform', 'android', '--output-dir', out, '--source-maps', 'external', '--no-bytecode'],
    { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' },
  );
  const dir = join(out, '_expo', 'static', 'js', 'android');
  const map = readdirSync(dir).find((f) => f.endsWith('.map'));
  return { map: join(dir, map), cleanup: () => rmSync(out, { recursive: true, force: true }) };
}

const LICENSE_FILES = /^(licen[cs]e|copying)(\.(md|txt))?$/i;

function packageInfo(name) {
  let pkgPath;
  try {
    pkgPath = require.resolve(`${name}/package.json`);
  } catch {
    // Packages with an "exports" map that hides package.json.
    const guess = join(root, 'node_modules', name, 'package.json');
    if (!existsSync(guess)) return undefined;
    pkgPath = guess;
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const dir = dirname(pkgPath);
  const file = readdirSync(dir).find((f) => LICENSE_FILES.test(f));
  const repository = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  return {
    name,
    version: pkg.version,
    license: typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? 'UNKNOWN'),
    repository: repository?.replace(/^git\+/, '').replace(/\.git$/, ''),
    text: file ? readFileSync(join(dir, file), 'utf8').trim() : undefined,
  };
}

const arg = process.argv.indexOf('--map');
const exported = arg > 0 ? { map: process.argv[arg + 1], cleanup: () => undefined } : exportBundle();
try {
  const names = [...bundledPackages(exported.map)].filter((n) => n !== own).sort();
  const packages = names.map(packageInfo).filter(Boolean);
  const native = JSON.parse(readFileSync(join(root, 'scripts', 'native-licenses.json'), 'utf8'));
  // Identical licence texts are stored once.
  const texts = [];
  const entries = [...packages, ...native.map((n) => ({ ...n, native: true }))].map((p) => {
    const { text, ...rest } = p;
    if (!text) return rest;
    let index = texts.indexOf(text);
    if (index < 0) index = texts.push(text) - 1;
    return { ...rest, text: index };
  });
  const missing = entries.filter((e) => e.license === 'UNKNOWN').map((e) => e.name);
  writeFileSync(
    join(root, 'src', 'legal', 'licenses.json'),
    `${JSON.stringify({ generated: new Date().toISOString().slice(0, 10), entries, texts }, null, 1)}\n`,
  );
  console.log(`Wrote ${entries.length} entries (${texts.length} distinct texts).`);
  if (missing.length) console.warn(`No licence field: ${missing.join(', ')}`);
} finally {
  exported.cleanup();
}
