import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRuntime } from '../client/provider';
import { parseRoute, buildPendingThreadUrl } from '../client/navigation';
import { useRouteNavigation } from '../client/app-navigation';
import { launchFailureMessage } from '../lib/launch';
import { LaunchStepList } from './LaunchProgress';
import type { ResourceTicket, ThreadTicket } from '../client/create-tickets';
import { terminalStartupStorageKey } from '../client/terminal-presets';
import type { NewThreadDraft } from '../client/new-thread-draft';

function editDraftUrl(key: string) {
  const url = new URL(window.location.href);
  url.pathname = '/new';
  url.searchParams.delete('pending');
  url.searchParams.set('recover', key);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function PendingOperation({ ticketKey }: { ticketKey: string }) {
  const { tickets } = useRuntime();
  const { navigate } = useRouteNavigation();
  const [ticket, setTicket] = useState<ThreadTicket | undefined>(() => tickets.get(ticketKey));
  const [accessLost, setAccessLost] = useState(() => tickets.isAccessLost(ticketKey));
  const hasTicket = ticket !== undefined;
  const draft: NewThreadDraft | undefined = ticket ? tickets.getDraft(ticketKey) : undefined;
  const previousState = useRef(ticket?.state);

  useEffect(() => {
    const refresh = () => {
      const next = tickets.get(ticketKey);
      setTicket(next);
      setAccessLost(!next && tickets.isAccessLost(ticketKey));
    };
    refresh();
    return tickets.subscribe(ticketKey, refresh);
  }, [ticketKey, tickets]);

  useEffect(() => {
    if (hasTicket) void tickets.start(ticketKey);
  }, [ticketKey, tickets, hasTicket]);

  useEffect(() => {
    const before = previousState.current;
    previousState.current = ticket?.state;
    if (ticket?.state !== 'ready' || before === 'ready' || !ticket.result?.threadId) return;
    const current = parseRoute(window.location.href);
    if (current.type === 'composer' && current.pendingKey === ticketKey) {
      navigate(`/threads/${encodeURIComponent(ticket.result.threadId)}`);
    }
  }, [ticket?.state, ticket?.result?.threadId, ticketKey, navigate]);

  if (!ticket) return <main className="pending-operation" aria-label="Pending thread">
    <h1>{accessLost ? 'Access changed' : 'Pending launch unavailable'}</h1>
    <p role="status">{accessLost ? 'Pending recovery data was cleared after access changed.' : 'This pending request is not available in this tab. It was not resubmitted.'}</p>
    <a href="/new">Open the composer</a>
  </main>;

  const ready = ticket.state === 'ready';
  const failed = ticket.state === 'failed';
  const unknown = ticket.state === 'unknown';
  const step = ticket.step ?? 'validate';
  const worktree = ticket.normalizedPayload.worktree;
  const retry = () => {
    const next = tickets.retry(ticketKey);
    if (!next) return;
    navigate(buildPendingThreadUrl(next.key, window.location.href));
    void tickets.start(next.key);
  };
  const leaveUrl = `/new${ticket.normalizedPayload.projectId ? `?project=${encodeURIComponent(ticket.normalizedPayload.projectId)}` : ''}`;

  return <main className="pending-operation" aria-label="Pending thread">
    <h1>{ready ? 'Your thread is ready' : unknown ? 'Launch outcome uncertain' : failed ? 'The launch stopped' : ticket.transport === 'checking' ? 'Checking launch acceptance' : 'Starting your thread'}</h1>
    {draft && <>
      <blockquote className="launch-prompt">{draft.prompt}</blockquote>
      {!!draft.images.length && <ul className="pending-attachments" aria-label="Attached files">{draft.images.map((image) => <li key={image.id}>{image.name}</li>)}</ul>}
    </>}
    {!ready && <LaunchStepList step={step} worktree={worktree} outcome={unknown ? 'unknown' : failed ? 'failed' : 'active'} />}
    {unknown && <p className="pending-warning" role="alert">The launch may have reached the machine. Webr will not replay this prompt or offer a new attempt. Check the Herdr session before starting another prompt.</p>}
    {failed && <div className="launch-failure" role="alert">
      <p>{ticket.operationId ? `Launch stopped while ${step.replaceAll('_', ' ')}. ${launchFailureMessage(step, worktree)}` : ticket.error ?? launchFailureMessage(step, worktree)}</p>
      {draft && <div className="pending-actions">
        <button type="button" className="launch-retry" onClick={retry}>Try again with a new attempt</button>
        <a className="launch-retry" href={editDraftUrl(ticketKey)}>Edit draft</a>
      </div>}
    </div>}
    {ticket.transport === 'checking' && ticket.notice && <p className="pending-warning" role="status">{ticket.notice}</p>}
    {ticket.reloadRecoveryUnavailable && <p className="pending-warning" role="alert">Browser storage is unavailable. This ticket and its draft are held in memory only; reloading will lose recovery.</p>}
    {draft && <button className="pending-dismiss" type="button" onClick={() => tickets.dismissDraft(ticketKey)}>Dismiss saved draft</button>}
    {ready && ticket.result?.threadId && <a className="launch-retry" href={`/threads/${encodeURIComponent(ticket.result.threadId)}`}>Open thread</a>}
    <a className="pending-leave" href={leaveUrl}>{ready ? 'Back to new thread' : 'Leave this pending view'}</a>
  </main>;
}

function terminalUrl(ticket: ResourceTicket, startupPreset = ticket.startupPreset) {
  if (ticket.kind !== 'terminal' || !ticket.result || !ticket.session) return undefined;
  const query = new URLSearchParams({ machine: ticket.normalizedPayload.machineId });
  if (startupPreset) query.set('startup', startupPreset);
  return `/sessions/${encodeURIComponent(ticket.session)}/tabs/${encodeURIComponent(ticket.result.tabId)}?${query}`;
}

export function PendingResourceOperation({ ticketKey }: { ticketKey: string }) {
  const { tickets, cacheScope } = useRuntime();
  const { navigate } = useRouteNavigation();
  const queryClient = useQueryClient();
  const [ticket, setTicket] = useState<ResourceTicket | undefined>(() => tickets.getResource(ticketKey));
  const [accessLost, setAccessLost] = useState(() => tickets.isResourceAccessLost(ticketKey));
  const previousState = useRef(ticket?.state);

  useEffect(() => {
    const refresh = () => {
      const next = tickets.getResource(ticketKey);
      setTicket(next);
      setAccessLost(!next && tickets.isResourceAccessLost(ticketKey));
    };
    refresh();
    return tickets.subscribeResource(ticketKey, refresh);
  }, [ticketKey, tickets]);

  useEffect(() => { if (ticket) void tickets.startResource(ticketKey); }, [ticket, ticketKey, tickets]);

  const openTerminal = (resource: ResourceTicket, auto = false) => {
    if (resource.kind !== 'terminal') return;
    const current = parseRoute(window.location.href);
    if (auto && (current.type !== 'composer' || current.resourcePendingKey !== ticketKey)) return;
    const startup = resource.startupPreset;
    const destination = terminalUrl(resource, startup);
    if (!destination) return;
    if (startup && resource.result) {
      try { sessionStorage.setItem(terminalStartupStorageKey(resource.normalizedPayload.machineId, resource.result.tabId), startup); } catch { /* The whitelisted startup query remains a fallback. */ }
      tickets.consumeResourceStartup(resource.key);
    }
    navigate(destination);
  };

  useEffect(() => {
    if (ticket?.kind !== 'worktree' || ticket.state !== 'ready') return;
    void queryClient.invalidateQueries({ queryKey: ['worktrees', cacheScope, ticket.normalizedPayload.machineId, ticket.normalizedPayload.projectId] });
  }, [ticket?.kind, ticket?.state, ticket?.key, cacheScope, queryClient]);

  useEffect(() => {
    const before = previousState.current;
    previousState.current = ticket?.state;
    if (ticket?.kind === 'worktree' && ticket.state === 'ready' && ticket.result) {
      const current = parseRoute(window.location.href);
      if (current.type === 'composer' && current.resourcePendingKey === ticketKey) navigate(`/threads/${encodeURIComponent(ticket.result.threadId)}`);
      return;
    }
    if (ticket?.kind !== 'terminal' || ticket.state !== 'ready' || before === 'ready') return;
    openTerminal(ticket, true);
  }, [ticket?.state, ticket?.kind, ticket?.result, ticketKey, navigate]);

  if (!ticket) return <main className="pending-operation" aria-label="Pending create">
    <h1>{accessLost ? 'Access changed' : 'Pending create unavailable'}</h1>
    <p role="status">{accessLost ? 'Pending recovery data was cleared after access changed.' : 'This pending create is not available in this tab. It was not resubmitted.'}</p>
    <a href="/new">Open the composer</a>
  </main>;

  const ready = ticket.state === 'ready';
  const failed = ticket.state === 'failed';
  const unknown = ticket.state === 'unknown';
  const title = ticket.kind === 'workspace' ? 'workspace' : ticket.kind === 'terminal' ? 'terminal' : 'worktree';
  const retry = () => {
    const next = tickets.retryResource(ticketKey);
    if (!next) return;
    navigate(buildPendingThreadUrl(next.key, window.location.href, 'resource'));
    void tickets.startResource(next.key);
  };
  return <main className="pending-operation" aria-label={`Pending ${title}`}>
    <h1>{ready ? (ticket.kind === 'workspace' ? 'Project created' : ticket.kind === 'terminal' ? 'Terminal ready' : 'Worktree opened') : unknown ? (ticket.kind === 'worktree' ? 'Worktree outcome uncertain' : 'Create outcome uncertain') : failed ? (ticket.kind === 'worktree' ? 'Could not open worktree' : `Could not create ${title}`) : ticket.transport === 'checking' ? `Checking ${title} acceptance` : ticket.kind === 'worktree' ? 'Opening worktree' : `Creating ${title}`}</h1>
    {ticket.kind === 'workspace' && <p>{ticket.normalizedPayload.label}</p>}
    {ticket.kind === 'worktree' && <p>{ticket.normalizedPayload.path}</p>}
    {unknown && <p className="pending-warning" role="alert">{ticket.kind === 'worktree' ? 'The worktree may have been opened in Herdr. Webr will not replay it. Check the Herdr session before trying again.' : 'The native create may have reached Herdr. Webr will not replay it. Check the Herdr session before creating another resource.'}</p>}
    {failed && <div className="launch-failure" role="alert"><p>{ticket.error ?? (ticket.kind === 'worktree' ? 'Could not open worktree.' : `Could not create ${title}.`)}</p><button type="button" className="launch-retry" onClick={retry}>Try again with a new request</button></div>}
    {ticket.transport === 'checking' && ticket.notice && <p className="pending-warning" role="status">{ticket.notice}</p>}
    {ready && ticket.kind === 'terminal' && !ticket.result && <p className="pending-warning" role="status">The terminal create completed, but its full identity was not recorded. Check the Herdr session; Webr will not create it again.</p>}
    {ready && ticket.kind === 'terminal' && ticket.result && <button type="button" className="launch-retry" onClick={() => openTerminal(ticket)}>Open terminal</button>}
    {ready && ticket.kind === 'worktree' && ticket.result && <a className="launch-retry" href={`/threads/${encodeURIComponent(ticket.result.threadId)}`}>Open thread</a>}
    {ticket.reloadRecoveryUnavailable && <p className="pending-warning" role="alert">Browser storage is unavailable. This ticket is held in memory only; reloading will lose recovery.</p>}
    <a className="pending-leave" href="/new">Leave this pending view</a>
  </main>;
}
