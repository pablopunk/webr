import { closeSync, existsSync, openSync, readFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { devTsx } from './plan.mjs';

export function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return undefined; }
}

export function rememberedPort(env = process.env) {
  const port = Number(readPid(join(env.WEBR_HOME ?? join(homedir(), '.webr'), 'port')));
  return Number.isInteger(port) && port > 0 ? port : undefined;
}

export function isPidAlive(pid) {
  if (!Number.isInteger(pid)) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

export function readPid(path) {
  try { return Number(readFileSync(path, 'utf8').trim()); } catch { return undefined; }
}

export const isPortOpen = ({ host, port }) => new Promise((done) => {
  const socket = createConnection({ host, port });
  socket.once('connect', () => { socket.destroy(); done(true); });
  socket.once('error', () => done(false));
  socket.setTimeout(1000, () => { socket.destroy(); done(false); });
});

export function findOnPath(name, pathValue = process.env.PATH ?? '') {
  return pathValue.split(delimiter).filter(Boolean).map((dir) => join(dir, name)).find((candidate) => existsSync(candidate));
}

export const usableLauncher = (saved) => saved?.node && saved?.entry && existsSync(saved.node) && existsSync(saved.entry) ? saved : undefined;

export const usableCheckout = (dev) => dev?.checkout && existsSync(devTsx(dev.checkout)) && (dev.pid === undefined || isPidAlive(dev.pid)) ? dev.checkout : undefined;

export const openAppendLog = (path) => openSync(path, 'a');
export const closeLog = closeSync;
