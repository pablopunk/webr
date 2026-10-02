import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { modelArguments } from '../runtime/herdr-actions';
import { scopedProjectId } from '../../shared/projects';
import { waitFor } from './wait';
import { Ownership } from './ownership';
import { launchChecks } from './evidence';
import type { ValidatorOptions, Scratch } from './contracts';

export async function validateLaunch(owner: Ownership, scratch: Scratch, selected: NonNullable<ValidatorOptions['launch']>) {
  const transport = owner.transport;
  const location = transport.profile.locations.find((location) => location.projectId === selected.projectId || scopedProjectId(transport.profile.id, location.projectId) === selected.projectId);
  if (!location) throw new Error('Launch project is not an approved location on this target');
  const args = modelArguments(selected.harness, selected.model);
  const snapshot = await transport.snapshot();
  const source = snapshot.workspaces.find((workspace) => workspace.workspace_id === location.workspaceId);
  if (!source || !owner.existingWorkspaces.has(source.workspace_id) || source.worktree?.is_linked_worktree) throw new Error('Approved source workspace is not an existing root checkout');
  const panes = snapshot.panes.filter((pane) => pane.workspace_id === source.workspace_id);
  if (!panes.length || !panes.some((pane) => pane.cwd === location.path) && source.worktree?.repo_root !== location.path) throw new Error('Approved source workspace no longer matches the project path');
  const checkout = await owner.create('checkout', scratch.path + '/checkout-' + randomUUID(), source.workspace_id);
  await waitFor(transport, () => owner.foreground(checkout), (foreground) => foreground.foreground_processes.every((process) => process.pid === foreground.shell_pid), 'new worktree shell readiness', 10_000);
  checkout.agentName = 'webv-' + randomUUID().replaceAll('-', '').slice(0, 26); checkout.harness = selected.harness;
  await owner.journal.record({ event: 'launch-identity', resource: checkout, harness: selected.harness, model: selected.model });
  const started = await owner.effect('agent.start', { name: checkout.agentName, kind: selected.harness, pane_id: checkout.paneId, args, timeout_ms: 30000 });
  const identity = { name: z.literal(checkout.agentName), terminal_id: z.literal(checkout.terminalId), pane_id: z.literal(checkout.paneId), agent_status: z.enum(['idle', 'done', 'working', 'blocked', 'unknown']), interactive_ready: z.boolean().optional() };
  const agentSchema = z.object({ ...identity, agent: z.literal(selected.harness) });
  const argv = z.array(z.string()).min(1).parse(started.argv);
  if (args.length && JSON.stringify(argv.slice(-args.length)) !== JSON.stringify(args)) throw new Error('Actual native model argv was not proved: ' + JSON.stringify({ expectedArgs: args, argv: argv.slice(-4) }));
  const readyAgent = async () => { const parsed = agentSchema.safeParse((await transport.request('agent.get', { target: checkout.agentName })).agent); return parsed.success ? parsed.data : undefined; };
  await waitFor(transport, readyAgent, (current) => !!current && ['idle', 'done'].includes(current.agent_status) && current.interactive_ready !== false, 'owned fresh agent startup readiness', 30_000);
  await owner.fresh(checkout);
  const token = 'HERDR-VALIDATED-' + randomUUID(); const encoded = Buffer.from(token).toString('base64');
  const prompt = 'Validation only: do not use tools, run commands, or change files. Decode this base64 token and reply with the decoded text only: ' + encoded;
  await owner.journal.record({ event: 'prompt-intent', terminalId: checkout.terminalId, hash: createHash('sha256').update(prompt).digest('hex') });
  await owner.effect('agent.prompt', { target: checkout.agentName, text: prompt });
  await waitFor(transport, async () => {
    await owner.fresh(checkout); const fresh = agentSchema.parse((await transport.request('agent.get', { target: checkout.agentName })).agent);
    const read = await transport.request('pane.read', { pane_id: checkout.paneId, source: 'recent_unwrapped', format: 'text', strip_ansi: true, lines: 120 });
    if (fresh.agent_status === 'blocked') throw new Error('The owned validation agent requested approval; no approval was sent');
    return { agent: fresh, text: z.object({ text: z.string() }).parse(read.read).text };
  }, (result) => ['idle', 'done'].includes(result.agent.agent_status) && result.text.includes(token), 'settled decoded-token response', 90_000);
  owner.journal.assertCompleted(['worktree.create', 'agent.start', 'agent.prompt']);
  await owner.journal.record({ event: 'launch-proved', harness: selected.harness, model: selected.model, tokenHash: createHash('sha256').update(token).digest('hex') });
  return { kind: 'launch' as const, harness: selected.harness, adapter: 'model-argv-v1' as const, projectId: scopedProjectId(transport.profile.id, location.projectId), locationPath: location.path, model: selected.model, checks: [...launchChecks] };
}
