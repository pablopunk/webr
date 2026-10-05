import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Browser } from './browser';
import { asJpeg, composePhone } from './compose';
import { firstFrameShowsThreads, recordingToGif } from './gif';
import { cssHeight, KEYBOARD_HEIGHT, PHONE_HEIGHT, STATUS_BAR_HEIGHT } from './frames';

export type SceneContext = { url: string; scratch: string; brand: string; assets: string };
export type Scene = { name: string; capture(context: SceneContext): Promise<void> };

const APP_HEIGHT = cssHeight(PHONE_HEIGHT - STATUS_BAR_HEIGHT);
const APP_HEIGHT_WITH_KEYBOARD = cssHeight(PHONE_HEIGHT - STATUS_BAR_HEIGHT - KEYBOARD_HEIGHT);
const DRAFT = 'add a tooltip explaining each theme option';
const OPEN_SIDEBAR = "button[aria-label='Open sidebar']";
const GROUP_BY_PROJECT = "button[aria-label='Group by project']";
const COMMAND_PALETTE = '.mobile-controls button:nth-child(2)';
const TERMINAL_INPUT = '.terminal-input-capture';
const SHOW_CODE = 'Show code';
const DEMO_THREAD = 'cursor-pagination-for-invoices';
const DEMO_MILLISECONDS = 3000;
const DEMO_LEAD_MILLISECONDS = 1500;
const DEMO_ATTEMPTS = 3;

async function phoneShot(context: SceneContext, name: string, cssHeightOfApp: number, steps: (browser: Browser) => void) {
  const browser = new Browser(`webr-shots-${name}`, true);
  try {
    browser.openPhone(context.url, cssHeightOfApp);
    steps(browser);
    const shot = join(context.scratch, `${name}.png`);
    browser.screenshot(shot);
    return shot;
  } finally { browser.close(); }
}

const save = (context: SceneContext, name: string, image: Buffer) => writeFile(join(context.brand, `${name}.jpg`), image);

export const scenes: Scene[] = [
  { name: 'sidebar', async capture(context) {
    const shot = await phoneShot(context, 'sidebar', APP_HEIGHT, (browser) => { browser.click(OPEN_SIDEBAR); browser.click(GROUP_BY_PROJECT); });
    await save(context, 'sidebar', await composePhone(shot, { statusBar: 'status-sidebar.png', keyboard: false }));
  } },
  { name: 'typing', async capture(context) {
    const shot = await phoneShot(context, 'typing', APP_HEIGHT_WITH_KEYBOARD, (browser) => { browser.run('focus', TERMINAL_INPUT); browser.run('keyboard', 'type', DRAFT); browser.run('wait', '800'); });
    await save(context, 'typing', await composePhone(shot, { statusBar: 'status-typing.png', keyboard: true }));
  } },
  { name: 'cmdk', async capture(context) {
    const shot = await phoneShot(context, 'cmdk', APP_HEIGHT, (browser) => browser.click(COMMAND_PALETTE));
    await save(context, 'cmdk', await composePhone(shot, { statusBar: 'status-cmdk.png', keyboard: false }));
  } },
  { name: 'tailscale', async capture(context) {
    const browser = new Browser('webr-shots-tailscale', false);
    try {
      browser.openDesktop(`${context.url}/settings`);
      browser.clickText(SHOW_CODE);
      const shot = join(context.scratch, 'tailscale.png');
      browser.screenshot(shot);
      await save(context, 'tailscale', await asJpeg(shot));
    } finally { browser.close(); }
  } },
  { name: 'demo', async capture(context) {
    for (let attempt = 1; attempt <= DEMO_ATTEMPTS; attempt++) {
      await recordDemo(context);
      if (await firstFrameShowsThreads(join(context.assets, 'demo.gif'))) return;
    }
    throw new Error('the demo GIF started with an empty window');
  } },
];

async function recordDemo(context: SceneContext) {
  const browser = new Browser('webr-shots-demo', false);
  try {
    browser.openWideWindow(context.url);
    browser.clickText(DEMO_THREAD);
    browser.wait(2500);
    const video = join(context.scratch, 'demo.webm');
    browser.startRecording(video);
    browser.wait(DEMO_LEAD_MILLISECONDS + DEMO_MILLISECONDS);
    browser.stopRecording();
    recordingToGif(video, join(context.assets, 'demo.gif'), DEMO_LEAD_MILLISECONDS / 1000);
  } finally { browser.close(); }
}
