import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PHONE_CSS_WIDTH, PHONE_SCALE } from './frames';

const TOUCH_SCRIPT = fileURLToPath(new URL('./touch-device.js', import.meta.url));
const SOFTWARE_RENDERING = '--disable-3d-apis';
const DESKTOP = { width: 1024, height: 709, scale: 2 };
const CLICK_ATTEMPTS = 20;
const CLICK_RETRY_MS = 500;
const WIDE_WINDOW = { width: 3152, height: 2140, scale: 0.5 };

export class Browser {
  constructor(private session: string, private touch: boolean) {}
  run(...args: string[]) {
    const env: NodeJS.ProcessEnv = { ...process.env, AGENT_BROWSER_ARGS: SOFTWARE_RENDERING };
    if (this.touch) env.AGENT_BROWSER_INIT_SCRIPTS = TOUCH_SCRIPT; else delete env.AGENT_BROWSER_INIT_SCRIPTS;
    const result = spawnSync('agent-browser', ['--session', this.session, ...args], { env, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`agent-browser ${args.join(' ')} failed: ${result.stdout}${result.stderr}`);
    return result.stdout.trim();
  }
  open(url: string, width: number, height: number, scale: number) { this.run('set', 'viewport', String(width), String(height), String(scale)); this.run('open', url); this.run('eval', 'localStorage.clear()'); this.run('reload'); this.wait(2500); }
  openPhone(url: string, cssHeight: number) { this.open(url, PHONE_CSS_WIDTH, cssHeight, PHONE_SCALE); }
  openDesktop(url: string) { this.open(url, DESKTOP.width, DESKTOP.height, DESKTOP.scale); }
  openWideWindow(url: string) { this.open(url, WIDE_WINDOW.width, WIDE_WINDOW.height, WIDE_WINDOW.scale); }
  startRecording(path: string) { this.run('record', 'start', path); }
  stopRecording() { this.run('record', 'stop'); }
  wait(milliseconds: number) { this.run('wait', String(milliseconds)); }
  private retrying(action: () => void) {
    for (let attempt = 1; ; attempt++) {
      try { action(); return; } catch (error) { if (attempt === CLICK_ATTEMPTS) throw error; this.wait(CLICK_RETRY_MS); }
    }
  }
  click(selector: string) { this.retrying(() => this.run('click', selector)); this.wait(700); }
  clickText(text: string) { this.retrying(() => this.run('find', 'text', text, 'click')); this.wait(1500); }
  screenshot(path: string) { this.run('screenshot', path); }
  close() { try { this.run('close'); } catch { /* the browser may already be gone */ } }
}
