import { useEffect, useRef, useState } from 'react';
import { useRuntime } from '../client/provider';
import { parseRoute, buildPendingThreadUrl } from '../client/navigation';
import { useRouteNavigation } from '../client/app-navigation';
import { launchFailureMessage } from '../lib/launch';
import { LaunchStepList } from './LaunchProgress';
import type { ThreadTicket } from '../client/create-tickets';
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
