import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { startDemoEnvironment } from './environment';
import { scenes } from './scenes';

const REPO = fileURLToPath(new URL('../..', import.meta.url));
const { values: options } = parseArgs({ options: { out: { type: 'string', default: join(REPO, 'assets') }, only: { type: 'string', multiple: true }, 'skip-build': { type: 'boolean', default: false } } });

if (!options['skip-build']) {
  const build = spawnSync('mise', ['exec', '--', 'pnpm', 'build'], { cwd: REPO, stdio: 'inherit' });
  if (build.status !== 0) throw new Error('build failed');
}
const selected = scenes.filter((scene) => !options.only?.length || options.only.includes(scene.name));
const assets = resolve(options.out!);
const brand = join(assets, 'brand');
await mkdir(brand, { recursive: true });
const scratch = await mkdtemp(join(tmpdir(), 'webr-shots-out-'));
const SCENE_ATTEMPTS = 3;
async function captureInFreshEnvironment(scene: (typeof scenes)[number]) {
  const environment = await startDemoEnvironment();
  try { await scene.capture({ url: environment.url, scratch, brand, assets }); } finally { await environment.stop(); }
}
async function captureWithRetries(scene: (typeof scenes)[number]) {
  for (let attempt = 1; ; attempt++) {
    try { return await captureInFreshEnvironment(scene); } catch (error) { if (attempt === SCENE_ATTEMPTS) throw error; console.log(`retrying ${scene.name}: ${String(error).split('\n')[0]}`); }
  }
}
try {
  for (const scene of selected) { await captureWithRetries(scene); console.log(`captured ${scene.name}`); }
} finally {
  await rm(scratch, { recursive: true, force: true });
}
process.exit(0);
