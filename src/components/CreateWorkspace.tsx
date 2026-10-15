import { useEffect, useRef, useState } from 'react';
import { useDirectorySuggestions } from '../client/directory-suggestions';
import { useThreadTickets } from '../client/provider';
import type { ResourceTicket } from '../client/create-tickets';
import { workspaceCreateInput } from '../shared/runtime';

const isAbsoluteOrHome = (path: string) => path.startsWith('/') || path.startsWith('~/');

export function CreateWorkspace({ machineId, session = '', configVersion = 1, pendingKey, onPending, onCreated }: {
  machineId: string; session?: string; configVersion?: number; pendingKey?: string; onPending?: (key?: string) => void; onCreated: () => void;
}) {
  const tickets = useThreadTickets();
  const [path, setPath] = useState(''); const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [ticket, setTicket] = useState<ResourceTicket | undefined>(() => pendingKey ? tickets.getResource(pendingKey) : undefined);
  const [pendingMissing, setPendingMissing] = useState(() => !!pendingKey && !tickets.getResource(pendingKey));
  const [highlighted, setHighlighted] = useState(0); const [open, setOpen] = useState(false);
  const completedKey = useRef<string>();
  const suggestionsQuery = useDirectorySuggestions(machineId, path, session, configVersion);
  const suggestions = suggestionsQuery.data ?? [];
  const hasSuggestionData = suggestionsQuery.data !== undefined;
  const exactSuggestion = suggestions.length === 1 && suggestions[0] === path;
  const showing = open && isAbsoluteOrHome(path) && !exactSuggestion && (suggestions.length > 0 || suggestionsQuery.isLoading || suggestionsQuery.isError || suggestionsQuery.isSuccess);
  const accept = (value: string) => { setPath(value); setHighlighted(0); setOpen(true); };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showing) return;
    if (event.key === 'Escape') { setOpen(false); return; }
    if (!suggestions.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setHighlighted((index) => (index + (event.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length); }
    else if (event.key === 'Tab') { event.preventDefault(); accept(suggestions[highlighted] ?? suggestions[0]); }
    else if (event.key === 'Enter') { event.preventDefault(); accept(suggestions[highlighted] ?? suggestions[0]); setOpen(false); }
  };

  useEffect(() => {
    const key = pendingKey ?? ticket?.key;
    if (!key) { setTicket(undefined); setPendingMissing(false); return; }
    const refresh = () => {
      const next = tickets.getResource(key);
      setTicket(next);
      if (pendingKey) setPendingMissing(!next);
    };
    refresh();
    const unsubscribe = tickets.subscribeResource(key, refresh);
    if (pendingKey && tickets.getResource(key)) void tickets.startResource(key);
    return unsubscribe;
  }, [pendingKey, ticket?.key, tickets]);

  useEffect(() => {
    if (ticket?.kind !== 'workspace' || ticket.state !== 'ready' || completedKey.current === ticket.key) return;
    completedKey.current = ticket.key;
    onCreated();
  }, [ticket?.key, ticket?.kind, ticket?.state, onCreated, onPending]);

  const start = (next: ResourceTicket) => {
    setTicket(next); setError(''); setPendingMissing(false); onPending?.(next.key);
    void tickets.startResource(next.key);
  };
  const submit = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || pendingKey || pendingMissing || !isAbsoluteOrHome(path) || !label.trim()) return;
    setBusy(true); setError('');
    try {
      const normalized = workspaceCreateInput.parse({ machineId, path, label });
      start(tickets.createResource('workspace', normalized, { session }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not prepare workspace creation.'); }
    finally { setBusy(false); }
  };
  const retry = () => {
    if (!ticket || ticket.state !== 'failed') return;
    const next = tickets.retryResource(ticket.key);
    if (next) start(next);
  };
  const pending = ticket?.state === 'pending' || ticket?.state === 'running';
  const locked = !!pendingKey || pendingMissing || pending || ticket?.state === 'unknown' || ticket?.state === 'ready';
  return <form className="thread-composer workspace-composer" onSubmit={submit} aria-label="Create workspace" aria-busy={busy || pending}>
    <label className="path-field">Project folder<input value={path} onChange={(event) => { setPath(event.target.value); setHighlighted(0); setOpen(true); }} onKeyDown={onKeyDown} onBlur={() => setOpen(false)} placeholder="/absolute/path/to/project" autoComplete="off" spellCheck={false} role="combobox" aria-expanded={showing} aria-autocomplete="list" required pattern="(/|~/).*" disabled={locked} />
      {showing && <ul className="path-suggestions" role="listbox" aria-busy={suggestionsQuery.isLoading || suggestionsQuery.isFetching}>
        {suggestions.map((suggestion, index) => <li key={suggestion} role="option" aria-selected={index === highlighted} data-highlighted={index === highlighted || undefined} onMouseDown={(event) => { event.preventDefault(); accept(suggestion); }}>{suggestion}</li>)}
        {suggestionsQuery.isLoading && <li className="path-suggestion-state" role="status"><span className="read-skeleton-row" /><span className="read-skeleton-row" /><span className="read-skeleton-row" /></li>}
        {suggestionsQuery.isError && <li className="path-suggestion-state" role={hasSuggestionData ? 'presentation' : 'status'}>{hasSuggestionData ? 'Could not refresh suggestions. Showing cached results.' : 'Could not load directory suggestions.'}</li>}
        {hasSuggestionData && !suggestions.length && <li className="path-suggestion-state" role="status">No matching directories</li>}
      </ul>}
    </label>
    <label>Workspace name<input value={label} onChange={(event) => setLabel(event.target.value)} required maxLength={80} disabled={locked} /></label>
    <button type="submit" disabled={busy || locked || !isAbsoluteOrHome(path) || !label.trim()}>{pending ? 'Creating…' : 'Create workspace'}</button>
    {ticket?.state === 'failed' && <><p className="form-error" role="alert">{ticket.error ?? 'Could not create workspace.'}</p><button type="button" className="launch-retry" onClick={retry}>Try again with a new request</button></>}
    {ticket?.state === 'unknown' && <p className="pending-warning" role="alert">The workspace may have been created. Webr will not replay the native request. Check Herdr before trying again.</p>}
    {pendingMissing && <p className="pending-warning" role="alert">This pending workspace ticket is unavailable in this tab and was not resubmitted.</p>}
    {ticket?.transport === 'checking' && ticket.notice && <p className="pending-warning" role="status">{ticket.notice}</p>}
    {ticket?.reloadRecoveryUnavailable && <p className="pending-warning" role="alert">Browser storage is unavailable. This create is held in memory only; reloading will lose recovery.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </form>;
}
