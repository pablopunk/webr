import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { demoProjects, type DemoProject } from './demo';
import { projectPath } from './snapshot';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const TSX_LOADER = import.meta.resolve('tsx');
const HARNESS_BINARIES = ['claude', 'codex', 'gemini', 'opencode', 'cursor', 'amp'];
const TAILSCALE_STATUS = JSON.stringify({ Self: { DNSName: 'my-mac.tail1234.ts.net.' } });

const GLYPHS: Record<DemoProject['glyph'], string> = {
  sun: '<circle cx="128" cy="128" r="44" fill="white"/><g stroke="white" stroke-width="12" stroke-linecap="round"><path d="M128 36v24M128 196v24M36 128h24M196 128h24M63 63l17 17M176 176l17 17M193 63l-17 17M80 176l-17 17"/></g>',
  waves: '<g fill="none" stroke="white" stroke-width="14" stroke-linecap="round"><path d="M48 100q20-24 40 0t40 0 40 0 40 0"/><path d="M48 140q20-24 40 0t40 0 40 0 40 0"/><path d="M48 180q20-24 40 0t40 0 40 0 40 0"/></g>',
  grid: '<g fill="white"><rect x="62" y="62" width="52" height="52" rx="10"/><rect x="142" y="62" width="52" height="52" rx="10" opacity=".6"/><rect x="62" y="142" width="52" height="52" rx="10" opacity=".6"/><rect x="142" y="142" width="52" height="52" rx="10"/></g>',
};
const iconSvg = ({ colors: [from, to], glyph }: DemoProject) => `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs><rect width="256" height="256" rx="58" fill="url(#g)"/>${GLYPHS[glyph]}</svg>`;

const executable = async (path: string, script: string) => { await writeFile(path, script); await chmod(path, 0o755); };

export type DemoPaths = { root: string; bin: string; home: string; webrHome: string; socket: string };

export async function prepareDemoWorkspace(root: string): Promise<DemoPaths> {
  const paths = { root, bin: join(root, 'bin'), home: join(root, 'home'), webrHome: join(root, 'webr-home'), socket: join(root, 'herdr.sock') };
  await Promise.all([paths.bin, paths.home, paths.webrHome].map((directory) => mkdir(directory, { recursive: true })));
  const node = process.execPath;
  await executable(join(paths.bin, 'herdr'), `#!/bin/sh\nexec "${node}" --import "${TSX_LOADER}" "${join(HERE, 'herdr-cli.ts')}" "$@"\n`);
  await executable(join(paths.bin, 'tailscale'), `#!/bin/sh\n[ "$1" = status ] && echo '${TAILSCALE_STATUS}' && exit 0\nexit 1\n`);
  await Promise.all(HARNESS_BINARIES.map((name) => executable(join(paths.bin, name), '#!/bin/sh\nexit 0\n')));
  await Promise.all(demoProjects.map(async (project) => {
    const publicDirectory = join(projectPath(root, project.id), 'public');
    await mkdir(publicDirectory, { recursive: true });
    await sharp(Buffer.from(iconSvg(project))).png().toFile(join(publicDirectory, 'favicon.png'));
  }));
  return paths;
}
