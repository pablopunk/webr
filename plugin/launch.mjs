import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_FILE, DEV_FILE, LOG_FILE, PID_FILE, launchPlan, probeAddress } from './plan.mjs';
import { closeLog, findOnPath, isPidAlive, isPortOpen, openAppendLog, readJson, readPid, usableCheckout } from './system.mjs';

const requiredDir = (name) => {
  if (!process.env[name]) throw new Error(`${name} is not set. This launcher must run as a Herdr plugin.`);
  return process.env[name];
};

const configDir = requiredDir('HERDR_PLUGIN_CONFIG_DIR');
const stateDir = requiredDir('HERDR_PLUGIN_STATE_DIR');
mkdirSync(stateDir, { recursive: true });

const config = readJson(join(configDir, CONFIG_FILE)) ?? {};
const running = isPidAlive(readPid(join(stateDir, PID_FILE))) || await isPortOpen(probeAddress(config));
const plan = launchPlan({ config, devCheckout: usableCheckout(readJson(join(stateDir, DEV_FILE))), webrPath: findOnPath('webr'), running });

if (plan.action === 'skip') {
  console.log('Webr is already running.');
} else {
  const log = openAppendLog(join(stateDir, LOG_FILE));
  const child = spawn(plan.command, plan.args, { cwd: plan.cwd, env: { ...process.env, ...plan.env }, detached: true, stdio: ['ignore', log, log] });
  child.once('error', (error) => { console.error(`Could not start Webr: ${error.message}`); process.exitCode = 1; });
  child.unref();
  closeLog(log);
  if (child.pid) { writeFileSync(join(stateDir, PID_FILE), String(child.pid)); console.log(`Started Webr (${plan.source}).`); }
}
