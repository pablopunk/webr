import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeValidator } from './fixtures/validator';
import { runValidation } from '../src/server/validation/runner';
import { assertValidationConsent } from '../src/server/validation/guard';
import { isLiveTransport, createLiveTransport } from '../src/server/validation/transport';
import { launchGranted, signEvidence, verifyEvidence } from '../src/server/validation/evidence';

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function setup(failure?: string) { const directory = await mkdtemp(join(tmpdir(), 'hv-')); directories.push(directory); const transport = new FakeValidator(); transport.failure = failure; const existing = structuredClone({ workspace: transport.state.workspaces[0], pane: transport.state.panes[0], process: transport.processes.get(transport.callerPaneId) }); return { directory, transport, existing }; }
const options = (directory: string) => ({ consent: true, control: true, outputDirectory: directory, signingKey: 'fixture-only-signing-key-not-live-evidence', launch: { harness: 'claude' as const, model: 'provider/exact-model', projectId: 'repo' } });
it('automates complete same-session validation on only new resources while injected proof never becomes live evidence', async () => {
  const { directory, transport, existing } = await setup(); const report = await runValidation(transport, options(directory));
  expect(report.errors).toEqual([]); expect(report.success).toBe(true); expect(report.missing).toEqual([]); expect(report.provenance).toBe('fixture'); expect(report.receipt).toBeUndefined(); expect(isLiveTransport(transport)).toBe(false);
  expect({ workspace: transport.state.workspaces[0], pane: transport.state.panes[0], process: transport.processes.get(transport.callerPaneId) }).toEqual(existing); expect(transport.state.workspaces).toHaveLength(1);
  expect(transport.calls.filter((call) => ['workspace.create', 'worktree.create'].includes(call.method)).every((call) => call.params.focus === false)).toBe(true);
  expect(transport.calls.filter((call) => call.method !== 'workspace.create' && call.params.pane_id).every((call) => call.params.pane_id !== transport.callerPaneId)).toBe(true);
  expect(transport.calls.some((call) => call.method === 'server.stop' || call.params.close_group === true || call.params.force === true)).toBe(false);
  expect(transport.calls.filter((call) => call.method === 'agent.prompt')).toHaveLength(1); expect(transport.calls.filter((call) => call.method === 'worktree.create')).toHaveLength(1);
  const journal = await readFile(report.journal, 'utf8'); expect(journal).toContain('control-proved'); expect(journal).toContain('launch-proved'); expect((await stat(report.journal)).mode & 0o777).toBe(0o600);
  expect((await readdir(directory)).some((name) => name.endsWith('.evidence.json'))).toBe(false);
  const proof = { issuer: 'herdr-web-live-v1' as const, targetFingerprint: transport.fingerprint, version: '0.9.3' as const, protocol: 22 as const, issuedAt: transport.now(), expiresAt: transport.now() + 1000, grants: report.grants };
  expect(launchGranted(proof, { agent: 'claude', projectId: 'local:repo', model: 'provider/exact-model' }, '/repo')).toBe(true); expect(launchGranted(proof, { agent: 'claude', projectId: 'local:repo', model: 'provider/other' }, '/repo')).toBe(false); expect(launchGranted(proof, { agent: 'claude', projectId: 'local:repo', model: 'Default' }, '/repo')).toBe(false);
  const signed = JSON.stringify(signEvidence(proof, options(directory).signingKey)); expect(verifyEvidence(signed, options(directory).signingKey, 'wrong-target')).toBeUndefined(); expect(verifyEvidence(signed, options(directory).signingKey, transport.fingerprint, proof.expiresAt)).toBeUndefined();
});
it.each(['workspace.create:before', 'workspace.create:after', 'recorder.boot:before', 'recorder.boot:after', 'baseline', 'keys', 'unicode', 'paste', 'queue', 'resize', 'mouse', 'scroll', 'conflict', 'takeover', 'query', 'device-replies', 'sequence', 'release', 'disconnect', 'budget', 'worktree.create:before', 'worktree.create:after', 'agent.start:before', 'agent.start:after', 'agent.prompt:before', 'agent.prompt:after', 'argv', 'launch-output', 'returned-caller', 'scratch'])('fails closed for %s without replay or preexisting-agent effects', async (failure) => {
  const { directory, transport, existing } = await setup(failure); const report = await runValidation(transport, options(directory));
  expect(report.success).toBe(false); expect(report.receipt).toBeUndefined(); expect(report.errors.length).toBeGreaterThan(0); expect(report.missing.length).toBeGreaterThan(0);
  expect({ workspace: transport.state.workspaces[0], pane: transport.state.panes[0], process: transport.processes.get(transport.callerPaneId) }).toEqual(existing);
  for (const method of ['worktree.create', 'agent.start', 'agent.prompt']) expect(transport.calls.filter((call) => call.method === method).length).toBeLessThanOrEqual(1);
  expect(transport.calls.filter((call) => call.method === 'workspace.close').some((call) => call.params.workspace_id === 'wUSER')).toBe(false);
  expect((await readdir(directory)).some((name) => name.endsWith('.evidence.json'))).toBe(false);
});
it('requires context and consent and refuses wrong local session before creating any workspace', async () => {
  const { directory, transport } = await setup();
  expect(() => assertValidationConsent({}, true, transport.profile)).toThrow('genuine managed');
  expect(() => assertValidationConsent({ HERDR_ENV: '1', HERDR_PANE_ID: 'caller', HERDR_SOCKET_PATH: '/fixture' }, false, transport.profile)).toThrow('consent');
  await expect(runValidation(transport, { ...options(directory), consent: false })).rejects.toThrow('consent');
  transport.callerPaneId = 'another-session:p1'; await expect(runValidation(transport, options(directory))).rejects.toThrow('does not match'); expect(transport.calls).toEqual([]);
  if (process.env.HERDR_ENV !== '1') await expect(createLiveTransport(transport.profile, true)).rejects.toThrow('genuine managed');
});
it('does not start paid/tool-bearing harnesses without a selected launch opt-in', async () => {
  const { directory, transport } = await setup(); const report = await runValidation(transport, { consent: true, control: true, outputDirectory: directory });
  expect(report.success).toBe(true); expect(transport.calls.some((call) => call.method === 'agent.start' || call.method === 'agent.prompt' || call.method === 'worktree.create')).toBe(false);
});
it('preserves changed cleanup ownership and never closes the newly occupied workspace', async () => {
  const { directory, transport, existing } = await setup(); const originalOpen = transport.open.bind(transport);
  transport.open = (...args) => { const peer = originalOpen(...args); const close = peer.close.bind(peer); peer.close = () => { close(); if (transport.peers.length >= 7 && transport.peers.every((peer) => peer.closed)) transport.state.workspaces.find((workspace) => workspace.workspace_id === args[0].workspaceId)!.label = 'A user changed this workspace'; }; return peer; };
  const report = await runValidation(transport, { consent: true, control: true, outputDirectory: directory });
  expect(report.success).toBe(true); expect(report.recovery.some((item) => item.reason.includes('binding changed'))).toBe(true); expect(transport.calls.some((call) => call.method === 'workspace.close')).toBe(false); expect(transport.calls.some((call) => call.method === 'scratch.remove')).toBe(false);
  expect({ workspace: transport.state.workspaces[0], pane: transport.state.panes[0], process: transport.processes.get(transport.callerPaneId) }).toEqual(existing);
});
it('reports a dirty or uncertain owned checkout cleanup without force, branch deletion or cleanup replay', async () => {
  const { directory, transport, existing } = await setup('worktree.remove:before'); const report = await runValidation(transport, options(directory));
  expect(report.success).toBe(true); expect(report.recovery.some((item) => item.resource?.kind === 'checkout')).toBe(true); expect(transport.calls.filter((call) => call.method === 'worktree.remove')).toHaveLength(1); expect(transport.calls.find((call) => call.method === 'worktree.remove')?.params.force).toBe(false);
  expect(transport.calls.some((call) => call.method === 'scratch.remove')).toBe(false); expect({ workspace: transport.state.workspaces[0], pane: transport.state.panes[0], process: transport.processes.get(transport.callerPaneId) }).toEqual(existing);
});
it('rejects incomplete or legacy blanket-custom signed scopes and does not issue any artifact for unsupported schema', async () => {
  const { directory, transport } = await setup('inspect'); await expect(runValidation(transport, options(directory))).rejects.toThrow('Unsupported'); expect(await readdir(directory)).toEqual([]);
  const legacy = { issuer: 'herdr-web-live-v1', targetFingerprint: transport.fingerprint, version: '0.9.3', protocol: 22, issuedAt: transport.now(), expiresAt: transport.now() + 1000, grants: [{ kind: 'launch', harness: 'claude', adapter: 'model-argv-v1', projectId: 'local:repo', locationPath: '/repo', modelMode: 'custom', checks: [] }] };
  expect(verifyEvidence(JSON.stringify({ evidence: legacy, signature: '0'.repeat(64) }), options(directory).signingKey, transport.fingerprint)).toBeUndefined();
});
