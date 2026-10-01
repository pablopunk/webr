import { expect, it, vi } from 'vitest';
import { validateLocalControl } from '../src/server/validation/automatic';
import { controlChecks, signEvidence } from '../src/server/validation/evidence';
import { profileSchema } from '../src/server/transport/registry';
import type { MetadataDatabase } from '../src/server/storage/database';
import type { SocketApi } from '../src/server/protocol/socket';

const profile = profileSchema.parse({ id: 'local', name: 'Local', session: 'default', enabled: true, transport: 'local', automatic: true, locations: [], socket: '/fixture/herdr.sock' });
const key = 'k'.repeat(64);
const fingerprint = 'local-fixture';
const receipt = JSON.stringify(signEvidence({ issuer: 'herdr-web-live-v1', targetFingerprint: fingerprint, version: '0.9.3', protocol: 22, issuedAt: Date.now(), expiresAt: Date.now() + 60_000, grants: [{ kind: 'control', inputAdapter: 'literal-pilot-v1', scope: 'literal-transport', checks: [...controlChecks] }] }, key));

function fixture(approved = false, changed = false) {
  let setting = approved ? receipt : undefined;
  const database = { getSetting: () => setting } as unknown as MetadataDatabase;
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  let created = false;
  let command = '';
  const workspace = { workspace_id: 'wCHECK', label: '' };
  const tab = { workspace_id: workspace.workspace_id, tab_id: 'wCHECK:t1' };
  const pane = { workspace_id: workspace.workspace_id, tab_id: tab.tab_id, pane_id: 'wCHECK:p1', terminal_id: 'term_check', cwd: process.cwd(), focused: false, revision: 1, agent_status: 'idle' };
  const snapshot = () => ({ version: '0.9.3', protocol: 22, workspaces: created ? [workspace] : [], tabs: created ? [tab] : [], panes: created ? [pane] : [], layouts: [], agents: [] });
  const api = { close: vi.fn(), request: vi.fn(async (method: string, params: Record<string, unknown> = {}) => {
    calls.push({ method, params });
    if (method === 'session.snapshot') return { snapshot: snapshot() };
    if (method === 'workspace.create') { workspace.label = String(params.label); created = true; return { workspace, tab, root_pane: pane }; }
    if (method === 'pane.send_input') { command = String(params.text); return {}; }
    if (method === 'pane.read') { setting = receipt; if (changed) workspace.label = 'changed'; const marker = command.match(/HERDR_WEB_CONTROL_CHECK_[a-f0-9]+/)?.[0]; return { read: { text: `${marker}:0` } }; }
    if (method === 'pane.process_info') return { process_info: { shell_pid: 4, foreground_processes: [{ pid: 4 }] } };
    if (method === 'workspace.close') { created = false; return {}; }
    throw new Error('Unexpected method');
  }) } as unknown as SocketApi;
  return { api, database, calls };
}

it('validates in a new no-focus managed workspace and closes only that verified workspace', async () => {
  const { api, database, calls } = fixture();
  expect(await validateLocalControl(profile, database, key, fingerprint, api)).toBe(true);
  expect(calls.find((call) => call.method === 'workspace.create')?.params).toMatchObject({ focus: false });
  expect(calls.find((call) => call.method === 'pane.send_input')?.params).toMatchObject({ pane_id: 'wCHECK:p1', keys: ['enter'] });
  expect(String(calls.find((call) => call.method === 'pane.send_input')?.params.text)).not.toContain('\n');
  expect(calls.find((call) => call.method === 'workspace.close')?.params).toEqual({ workspace_id: 'wCHECK', close_group: false });
  expect(api.close).toHaveBeenCalledOnce();
});

it('does not create a second workspace after approval', async () => {
  const { api, database, calls } = fixture(true);
  expect(await validateLocalControl(profile, database, key, fingerprint, api)).toBe(true);
  expect(calls).toHaveLength(0);
});

it('preserves a workspace if ownership changes before cleanup', async () => {
  const { api, database, calls } = fixture(false, true);
  await expect(validateLocalControl(profile, database, key, fingerprint, api)).rejects.toThrow('workspace changed');
  expect(calls.some((call) => call.method === 'workspace.close')).toBe(false);
});

it('preserves an uncertain command outcome without touching the existing session', async () => {
  const { api, database, calls } = fixture();
  vi.mocked(api.request).mockImplementationOnce(async () => { throw new Error('rpc_timeout'); });
  await expect(validateLocalControl(profile, database, key, fingerprint, api)).rejects.toThrow('rpc_timeout');
  expect(calls.some((call) => call.method === 'workspace.create' || call.method === 'workspace.close')).toBe(false);
  expect(api.close).toHaveBeenCalledOnce();
});
