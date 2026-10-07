/**
 * Fetches harness marks and bakes them into `public/harness-icons/<id>.png`.
 *
 * Sources per harness: explicit first-party asset URLs when a brand file is published,
 * otherwise the product domain's own favicon (svg, apple-touch, ico, then public favicon
 * mirrors). Every result is normalized onto a 256px rounded tile so heterogeneous sources
 * render as one set, and the mark is only baked — never redrawn.
 *
 * Run `mise exec -- pnpm harness-icons` when adding a harness or refreshing marks.
 * Generated PNGs are committed; this script is not part of the build.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { herdrAgentKinds } from '../src/shared/agent-kinds';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'public', 'harness-icons');
const tile = '#f8f8f7';
const inverseTile = '#171716';
const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type HarnessSource = { domain: string; assets?: string[]; note?: string };

const sources: Record<string, HarnessSource> = {
  pi: { domain: 'pi.dev', assets: ['https://pi.dev/favicon.svg'], note: 'press-kit badge' },
  claude: { domain: 'claude.ai', note: 'Claude Code' },
  codex: { domain: 'openai.com', note: 'OpenAI Codex' },
  gemini: { domain: 'geminicli.com', assets: ['https://geminicli.com/brandassets/gemini-cli-icon_full-color.svg'], note: 'Gemini CLI brand kit' },
  cursor: { domain: 'cursor.com' },
  devin: { domain: 'devin.ai' },
  agy: { domain: 'antigravity.google', note: 'Google Antigravity CLI' },
  cline: { domain: 'cline.bot' },
  omp: { domain: 'omp.sh', assets: ['https://omp.sh/favicon.svg'] },
  mastracode: { domain: 'code.mastra.ai', note: 'Mastra Code' },
  opencode: { domain: 'opencode.ai' },
  copilot: { domain: 'github.com', assets: ['https://raw.githubusercontent.com/simple-icons/simple-icons/master/icons/githubcopilot.svg'], note: 'GitHub Copilot' },
  kimi: { domain: 'kimi.com', note: 'Kimi Code' },
  kiro: { domain: 'kiro.dev', assets: ['https://raw.githubusercontent.com/kirodotdev/Kiro/main/assets/kiro-icon.png'] },
  droid: { domain: 'factory.ai', note: 'Factory Droids' },
  amp: { domain: 'ampcode.com', assets: ['https://ampcode.com/app-icon.svg'] },
  grok: { domain: 'grok.com' },
  hermes: { domain: 'hermes-agent.nousresearch.com', assets: ['https://hermes-agent.nousresearch.com/icon.png'], note: 'Nous Research Hermes Agent' },
  kilo: { domain: 'kilo.ai', assets: ['https://raw.githubusercontent.com/Kilo-Org/kilocode/main/packages/kilo-docs/public/img/logo.svg'], note: 'Kilo Code' },
  qodercli: { domain: 'qoder.com', assets: ['https://img.alicdn.com/imgextra/i4/O1CN01QkSxiCocd3D0prc8_!!6000000008124-2-tps-412-412.png'], note: 'Qoder CLI' },
  qwen: { domain: 'qwen.ai', note: 'Qwen Code' },
  letta: { domain: 'www.letta.com', assets: ['https://www.letta.com/assets/images/webclip.png'] },
  maki: { domain: 'maki.sh' },
  muse: { domain: 'musecodes.io', note: 'Meta Muse Code' },
};

/** Largest PNG payload in an ICO container. BMP payloads are left to the next candidate. */
function pngFromIco(bytes: Buffer): Buffer | undefined {
  if (bytes.length < 6 || bytes.readUInt16LE(0) !== 0 || bytes.readUInt16LE(2) !== 1) return;
  let best: Buffer | undefined;
  let bestSize = 0;
  for (let index = 0; index < bytes.readUInt16LE(4); index++) {
    const entry = 6 + index * 16;
    if (entry + 16 > bytes.length) break;
    const size = bytes.readUInt32LE(entry + 8);
    const offset = bytes.readUInt32LE(entry + 12);
    if (size <= bestSize || offset + size > bytes.length) continue;
    const image = bytes.subarray(offset, offset + size);
    if (image.subarray(0, pngMagic.length).equals(pngMagic)) { best = image; bestSize = size; }
  }
  return best;
}

async function fetchImage(url: string): Promise<Buffer | undefined> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { accept: 'image/*,*/*' } });
    if (!response.ok) return;
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length > 200 ? bytes : undefined;
  } catch {
    return undefined;
  }
}

/** Renders a source into a transparent 200x200 layer, scaling vectors by their own size. */
async function layerFrom(bytes: Buffer): Promise<Buffer | undefined> {
  const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
  try {
    const meta = await sharp(bytes).metadata();
    const longSide = Math.max(meta.width ?? 0, meta.height ?? 0);
    const density = meta.format === 'svg' && longSide > 0 ? Math.min(2000, Math.max(32, Math.round((72 * 512) / longSide))) : undefined;
    return await sharp(bytes, density ? { density } : {}).resize(200, 200, { fit: 'contain', background: transparent }).png().toBuffer();
  } catch {
    const png = pngFromIco(bytes);
    if (!png) return undefined;
    try {
      return await sharp(png).resize(200, 200, { fit: 'contain', background: transparent }).png().toBuffer();
    } catch {
      return undefined;
    }
  }
}

/** Tiles the layer on the Webr surface, flipping to a dark tile when the mark is near-white. */
async function bake(layer: Buffer): Promise<Buffer> {
  const flat = await sharp(layer).flatten({ background: '#ffffff' }).toBuffer();
  const stats = await sharp(flat).stats();
  const mean = (stats.channels[0].mean + stats.channels[1].mean + stats.channels[2].mean) / 3;
  const plate = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" rx="58" fill="${mean > 242 ? inverseTile : tile}"/></svg>`);
  return sharp(plate).composite([{ input: layer, top: 28, left: 28 }]).png().toBuffer();
}

async function resolveHarness(id: string, source: HarnessSource) {
  for (const url of [
    ...(source.assets ?? []),
    `https://${source.domain}/favicon.svg`,
    `https://${source.domain}/apple-touch-icon.png`,
    `https://${source.domain}/favicon.ico`,
    `https://icons.duckduckgo.com/ip3/${source.domain}.ico`,
    `https://www.google.com/s2/favicons?domain=${source.domain}&sz=256`,
  ]) {
    const bytes = await fetchImage(url);
    if (!bytes) continue;
    const layer = await layerFrom(bytes);
    if (!layer) continue;
    return { url, baked: await bake(layer) };
  }
  return undefined;
}

const missing = herdrAgentKinds.filter((id) => !sources[id]);
const stale = Object.keys(sources).filter((id) => !herdrAgentKinds.includes(id));
if (missing.length || stale.length) {
  if (missing.length) console.error(`Missing manifest entries: ${missing.join(', ')}`);
  if (stale.length) console.error(`Stale manifest entries: ${stale.join(', ')}`);
  process.exit(1);
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const results = await Promise.all(herdrAgentKinds.map(async (id) => ({ id, ...(await resolveHarness(id, sources[id]) ?? {}) })));
for (const result of results) {
  if (!result.baked) {
    console.error(`${result.id.padEnd(11)} FAILED (${sources[result.id].domain})`);
    continue;
  }
  await writeFile(resolve(out, `${result.id}.png`), result.baked);
  console.log(`${result.id.padEnd(11)} ${result.url}`);
}

if (results.some((result) => !result.baked)) {
  console.error('\nNo usable icon found for some harnesses.');
  process.exit(1);
}
