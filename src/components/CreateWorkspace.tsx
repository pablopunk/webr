import { useRef, useState } from 'react';
import { useDirectorySuggestions } from '../client/directory-suggestions';

const isAbsoluteOrHome = (path: string) => path.startsWith('/') || path.startsWith('~/');

export function CreateWorkspace({ machineId, onCreated }: { machineId: string; onCreated: () => void }) {
  const [path, setPath] = useState(''); const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [highlighted, setHighlighted] = useState(0); const [open, setOpen] = useState(false);
  const suggestions = useDirectorySuggestions(machineId, path);
  const showing = open && suggestions.length > 0 && !(suggestions.length === 1 && suggestions[0] === path);
  const accept = (value: string) => { setPath(value); setHighlighted(0); setOpen(true); };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setHighlighted((index) => (index + (event.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length); }
    else if (event.key === 'Tab') { event.preventDefault(); accept(suggestions[highlighted] ?? suggestions[0]); }
    else if (event.key === 'Enter') { event.preventDefault(); accept(suggestions[highlighted] ?? suggestions[0]); setOpen(false); }
    else if (event.key === 'Escape') setOpen(false);
  };
  const operation = useRef<{ payload: string; key: string } | null>(null);
  const submit = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError('');
    const payload = JSON.stringify({ machineId, path, label });
    if (operation.current?.payload !== payload) operation.current = { payload, key: crypto.randomUUID() };
    try {
      const response = await fetch('/api/workspaces', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operation.current.key }, body: payload });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not create workspace');
      if (result.state === 'unknown') throw new Error('The result is not known; check Herdr before you create another workspace.');
      onCreated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create workspace'); }
    finally { setBusy(false); }
  };
  return <form className="thread-composer workspace-composer" onSubmit={submit} aria-label="Create workspace" aria-busy={busy}>
    <label className="path-field">Project folder<input value={path} onChange={(event) => { setPath(event.target.value); setHighlighted(0); setOpen(true); }} onKeyDown={onKeyDown} onBlur={() => setOpen(false)} placeholder="/absolute/path/to/project" autoComplete="off" spellCheck={false} role="combobox" aria-expanded={showing} aria-autocomplete="list" required pattern="(/|~/).*" />
      {showing && <ul className="path-suggestions" role="listbox">{suggestions.map((suggestion, index) => <li key={suggestion} role="option" aria-selected={index === highlighted} data-highlighted={index === highlighted || undefined} onMouseDown={(event) => { event.preventDefault(); accept(suggestion); }}>{suggestion}</li>)}</ul>}
    </label>
    <label>Workspace name<input value={label} onChange={(event) => setLabel(event.target.value)} required maxLength={80} /></label>
    <button type="submit" disabled={busy || !isAbsoluteOrHome(path) || !label.trim()}>{busy ? 'Creating…' : 'Create workspace'}</button>
    {error && <p className="form-error" role="alert">{error}</p>}
  </form>;
}
