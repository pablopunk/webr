import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { nativePane, nativeSnapshot, nativeTab, nativeWorkspace } from '../protocol/native';
import { SocketApi } from '../protocol/socket';
import { localSocket, type TargetProfile } from '../transport/registry';
import { quoteShell } from '../transport/ssh';
import { controlGranted, launchGranted, verifyEvidence } from './evidence';
import type { MetadataDatabase } from '../storage/database';
import { nativeLocations } from '../transport/native-locations';
import type { LaunchInput } from '../../shared/runtime';

const methods = new Set(['session.snapshot', 'workspace.create', 'workspace.close', 'pane.send_input', 'pane.read', 'pane.process_info']);
const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

type Selection = Pick<LaunchInput, 'projectId' | 'agent' | 'model'>;
const approved = (database: MetadataDatabase, profile: TargetProfile, key: string, fingerprint: string) => verifyEvidence(database.getSetting('validation:' + profile.id), key, fingerprint);

export async function validateLocalControl(profile: TargetProfile, database: MetadataDatabase, key: string, fingerprint: string, api = new SocketApi(localSocket(profile), 5000, methods)) {
  if (controlGranted(approved(database, profile, key, fingerprint))) { api.close(); return true; }
  return validateInOwnedShell(profile, api, '', () => controlGranted(approved(database, profile, key, fingerprint)));
}

export async function validateLocalLaunch(profile: TargetProfile, database: MetadataDatabase, key: string, fingerprint: string, selection: Selection, api = new SocketApi(localSocket(profile), 5000, methods)) {
  if (profile.transport !== 'local' || !profile.automatic) { api.close(); throw new Error('launch_validation_unavailable'); }
  try {
    const snapshot = nativeSnapshot.parse((await api.request('session.snapshot')).snapshot);
    const location = nativeLocations(profile.id, snapshot).find((item) => item.projectId === selection.projectId);
    if (!location) throw new Error('unknown_project_location');
    const check = () => launchGranted(approved(database, profile, key, fingerprint), selection, location.path);
    if (check()) return true;
    const args = ` --launch-only --harness ${quoteShell(selection.agent)} --model ${quoteShell(selection.model)} --project ${quoteShell(selection.projectId)}`;
    return await validateInOwnedShell(profile, api, args, check, snapshot, 'launch');
  } finally { api.close(); }
}

async function validateInOwnedShell(profile: TargetProfile, api: SocketApi, args: string, check: () => boolean, snapshot?: ReturnType<typeof nativeSnapshot.parse>, kind = 'control') {
  try {
    if (!profile.automatic || profile.transport !== 'local') return false;
    const initial = snapshot ?? nativeSnapshot.parse((await api.request('session.snapshot')).snapshot);
    const nonce = randomUUID();
    const label = `herdr-web-${kind}-check-${nonce}`;
    const cwd = resolve('.');
    const created = await api.request('workspace.create', { cwd, label, focus: false }, { requestId: nonce, timeoutMs: 30_000 });
    const workspace = nativeWorkspace.parse(created.workspace);
    const tab = nativeTab.parse(created.tab);
    const pane = nativePane.parse(created.root_pane);
    if (workspace.label !== label || tab.workspace_id !== workspace.workspace_id || pane.workspace_id !== workspace.workspace_id || pane.tab_id !== tab.tab_id || pane.cwd !== cwd || initial.workspaces.some((item) => item.workspace_id === workspace.workspace_id) || initial.panes.some((item) => item.pane_id === pane.pane_id || item.terminal_id === pane.terminal_id)) throw new Error('Automatic validation created an unverified workspace; preserve it for inspection');
    const marker = `HERDR_WEB_CONTROL_CHECK_${nonce.replaceAll('-', '')}`;
    const databasePath = resolve(process.env.HERDR_WEB_DATABASE ?? '.data/gateway.sqlite');
    const env = `HERDR_WEB_DATABASE=${quoteShell(databasePath)}${process.env.HERDR_WEB_TARGETS ? ` HERDR_WEB_TARGETS=${quoteShell(resolve(process.env.HERDR_WEB_TARGETS))}` : ''}`;
    const command = `${env} mise exec -- pnpm run validate:live --target ${quoteShell(profile.id)} --consent --approve${args}; printf '\\n${marker}:%s\\n' "$?"`;
    let shellReady = false;
    for (let i = 0; i < 40; i++) {
      try {
        const info = (await api.request('pane.process_info', { pane_id: pane.pane_id })).process_info as { shell_pid: number; foreground_processes: { pid: number }[] };
        if (info?.shell_pid && info.foreground_processes?.length && info.foreground_processes.every((process) => process.pid === info.shell_pid)) { shellReady = true; break; }
      } catch {}
      await pause(250);
    }
    if (!shellReady) throw new Error('Automatic validation shell did not become ready; preserve its workspace');
    await api.request('pane.send_input', { pane_id: pane.pane_id, text: command, keys: ['enter'] }, { timeoutMs: 5000 });
    let exitCode: number | undefined;
    for (let i = 0; i < 600; i++) {
      const result = await api.request('pane.read', { pane_id: pane.pane_id, source: 'recent_unwrapped', format: 'text', strip_ansi: true });
      const output = (result.read as { text?: string } | undefined)?.text ?? '';
      const completion = output.match(new RegExp(`(?:^|\\n)${marker}:(\\d+)(?:\\n|$)`));
      if (completion) { exitCode = Number(completion[1]); break; }
      await pause(500);
    }
    if (exitCode === undefined) throw new Error('Automatic validation did not finish; preserve its workspace');
    const fresh = nativeSnapshot.parse((await api.request('session.snapshot')).snapshot);
    const members = fresh.panes.filter((item) => item.workspace_id === workspace.workspace_id);
    const tabs = fresh.tabs.filter((item) => item.workspace_id === workspace.workspace_id);
    if (fresh.workspaces.find((item) => item.workspace_id === workspace.workspace_id)?.label !== label || members.length !== 1 || members[0].pane_id !== pane.pane_id || members[0].terminal_id !== pane.terminal_id || members[0].agent || tabs.length !== 1 || tabs[0].tab_id !== tab.tab_id) throw new Error('Automatic validation workspace changed; preserve it');
    const processInfo = (await api.request('pane.process_info', { pane_id: pane.pane_id })).process_info as { shell_pid: number; foreground_processes: { pid: number }[] };
    if (!processInfo?.shell_pid || !processInfo.foreground_processes?.length || !processInfo.foreground_processes.every((process) => process.pid === processInfo.shell_pid)) throw new Error('Automatic validation process is still active; preserve its workspace');
    await api.request('workspace.close', { workspace_id: workspace.workspace_id, close_group: false });
    return exitCode === 0 && check();
  } finally { api.close(); }
}
