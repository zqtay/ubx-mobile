// Builds the signed release APK (M7.5, docs/release.md):
//   npm run release:apk              regenerate android/ (prebuild --clean) and build
//   npm run release:apk -- --no-prebuild   reuse the existing android/ folder
// The APK is copied to dist/ubx-mobile-<version>-<versionCode>.apk with its SHA-256.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const windows = process.platform === 'win32';
const { expo } = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8'));
const version = expo.version;
const versionCode = expo.android?.versionCode;

function run(cmd, args, cwd = root) {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: windows });
}

function signingConfigured() {
  if (process.env.ORG_GRADLE_PROJECT_UBX_RELEASE_STORE_FILE) return true;
  const props = join(process.env.GRADLE_USER_HOME ?? join(homedir(), '.gradle'), 'gradle.properties');
  return existsSync(props) && /^\s*UBX_RELEASE_STORE_FILE\s*=/m.test(readFileSync(props, 'utf8'));
}

if (!signingConfigured()) {
  console.error(
    'Release signing is not configured: add UBX_RELEASE_STORE_FILE, UBX_RELEASE_STORE_PASSWORD,\n' +
      'UBX_RELEASE_KEY_ALIAS and UBX_RELEASE_KEY_PASSWORD to ~/.gradle/gradle.properties (docs/release.md).',
  );
  process.exit(1);
}

console.log(`Building UBX Mobile ${version} (versionCode ${versionCode})`);
if (!process.argv.includes('--no-prebuild')) {
  run('npx', ['expo', 'prebuild', '--platform', 'android', '--clean']);
}
run(windows ? 'gradlew.bat' : './gradlew', [
  'assembleRelease',
  // 32- and 64-bit ARM phones; leaves out the emulator ABIs to keep the APK small.
  '-PreactNativeArchitectures=armeabi-v7a,arm64-v8a',
], join(root, 'android'));

const apk = join(root, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
const outDir = join(root, 'dist');
mkdirSync(outDir, { recursive: true });
const target = join(outDir, `ubx-mobile-${version}-${versionCode}.apk`);
copyFileSync(apk, target);
const sha = createHash('sha256').update(readFileSync(target)).digest('hex');
console.log(`\nAPK: ${target}`);
console.log(`Size: ${(statSync(target).size / 1024 / 1024).toFixed(1)} MB`);
console.log(`SHA-256: ${sha}`);
