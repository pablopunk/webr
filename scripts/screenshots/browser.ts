import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PHONE_CSS_WIDTH, PHONE_SCALE } from './frames';

const TOUCH_SCRIPT = fileURLToPath(new URL('./touch-device.js', import.meta.url));
const SOFTWARE_RENDERING = '--disable-3d-apis';
const DESKTOP = { width: 1024, height: 709, scale: 2 };

export class Browser {
  constructor(private session: string, private touch: boolean) {}
  run(...args: string[]) {
    const env: NodeJS.ProcessEnv = { ...process.env, AGENT_BROWSER_ARGS: SOFTWARE_RENDERING };
    if (this.touch) env.AGENT_BROWSER_INIT_SCRIPTS = TOUCH_SCRIPT; else delete env.AGENT_BROWSER_INIT_SCRIPTS;
    const result = spawnSync('agent-browser', ['--session', this.session, ...args], { env, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`agent-browser ${args.join(' ')} failed: ${result.stdout}${result.stderr}`);
    return result.stdout.trim();
  }
  open(url: string, width: number, height: number, scale: number) { this.run('set', 'viewport', String(width), String(height), String(scale)); this.run('open', url); this.run('wait', '2500'); }
  openPhone(url: string, cssHeight: number) { this.open(url, PHONE_CSS_WIDTH, cssHeight, PHONE_SCALE); }
  openDesktop(url: string) { this.open(url, DESKTOP.width, DESKTOP.height, DESKTOP.scale); }
  click(selector: string) { this.run('click', selector); this.run('wait', '700'); }
  clickText(text: string) { this.run('find', 'text', text, 'click'); this.run('wait', '1500'); }
  screenshot(path: string) { this.run('screenshot', path); }
  close() { try { this.run('close'); } catch { /* the browser may already be gone */ } }
}
