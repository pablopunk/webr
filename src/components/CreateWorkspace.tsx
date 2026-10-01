import { useRef, useState } from 'react';

export function CreateWorkspace({ machineId, onCreated }: { machineId: string; onCreated: () => void }) {
  const [path, setPath] = useState(''); const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
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
    <label>Project folder<input value={path} onChange={(event) => setPath(event.target.value)} placeholder="/absolute/path/to/project" required pattern="/.*" /></label>
    <label>Workspace name<input value={label} onChange={(event) => setLabel(event.target.value)} required maxLength={80} /></label>
    <button type="submit" disabled={busy || !path.startsWith('/') || !label.trim()}>{busy ? 'Creating…' : 'Create workspace'}</button>
    {error && <p className="form-error" role="alert">{error}</p>}
  </form>;
}
