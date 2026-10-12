import { CircleCheck, CircleHelp, LoaderCircle, TriangleAlert } from 'lucide-react';
import type { Thread, ThreadRecovery } from '../lib/models';

const recoveryReasons: Record<string, string> = {
  conversation_conflict: 'More than one live pane reports this provider session. Webr will not choose one automatically.',
  owner_conflict: 'More than one pane claims this thread. Webr will not choose one automatically.',
  conversation_missing: 'The saved provider session is not present in the current Herdr snapshot. The thread remains saved.',
  conversation_changed: 'The live pane reports a different provider session. Webr will not replace the saved identity.',
  agent_changed: 'The live pane reports a different agent. Webr will not treat it as the saved conversation.',
  worktree_changed: 'The repository or checkout no longer matches this saved thread.',
  session_report_missing: 'The pane has not reported its provider session identity. Its conversation is not verified.',
  identity_unverified: 'Herdr has not reported a durable provider session identity. An agent process or terminal alone does not verify recovery.',
  cwd_missing: 'Herdr has not reported the foreground working directory, so Webr cannot verify the expected checkout.',
  target_changed: 'The machine target or Herdr session changed. Webr will not attach this thread across targets.',
  worktree_unverified: 'Herdr has not exposed the saved linked-worktree identity, so Webr cannot verify this checkout.',
  binding_conflict: 'The matching pane is already associated with another saved thread. Webr will not move it automatically.',
};

export function threadRecoveryPresentation(thread: Thread) {
  if (!thread.agent && !thread.providerSession) return undefined;
  const state: ThreadRecovery['state'] = !thread.providerSession && thread.recovery?.state !== 'needs_attention'
    ? 'unbound' : thread.recovery?.state ?? 'known';
  const labels = {
    unbound: 'Session unverified', known: 'Session identity saved', restoring: 'Restoring session',
    active: 'Session verified', needs_attention: 'Recovery needs attention',
  };
  const details = {
    unbound: 'Herdr has not reported a durable provider session identity. An agent process or terminal alone does not verify recovery.',
    known: 'The provider session identity is saved, but has not been verified against this Herdr session and checkout.',
    restoring: 'Waiting for Herdr to restore and verify the saved provider session in the expected checkout.',
    active: 'Herdr reports the saved provider session in the expected checkout.',
    needs_attention: 'The saved thread could not be safely matched to a live provider session. Check the session and checkout in Herdr.',
  };
  const reasonKey = thread.recovery?.reason ?? '';
  const reason = Object.hasOwn(recoveryReasons, reasonKey) ? recoveryReasons[reasonKey] : details[state];
  return { state, label: labels[state], reason, attention: state === 'needs_attention' || state === 'unbound' };
}
export function ThreadRecoveryNotice({ thread }: { thread: Thread }) {
  const recovery = threadRecoveryPresentation(thread);
  if (!recovery) return null;
  const Icon = recovery.state === 'active' ? CircleCheck : recovery.state === 'restoring' ? LoaderCircle : recovery.attention ? TriangleAlert : CircleHelp;
  return <section className={`thread-recovery-notice is-${recovery.state}`} aria-label="Thread recovery" role="status">
    <Icon size={16} aria-hidden="true" />
    <div><strong>{recovery.label}</strong><p>{recovery.reason}</p></div>
  </section>;
}
