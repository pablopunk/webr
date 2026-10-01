import { useEffect, useState } from 'react';
import type { AgentKind, Project } from '../lib/models';

const agentNames: Record<AgentKind, string> = {
  claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode', pi: 'Pi',
};

export function NewThreadView({ projects, selectedProjectId, onOpenSidebar }: {
  projects: Project[]; selectedProjectId?: string; onOpenSidebar: () => void;
}) {
  const [projectId, setProjectId] = useState(projects.find((project) => project.id === selectedProjectId)?.id ?? projects[0]?.id ?? '');
  const [agent, setAgent] = useState<AgentKind>('claude');
  const [worktree, setWorktree] = useState(true);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setWorktree(localStorage.getItem('herdr-new-worktree') !== 'false'); }, []);

  const submit = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const result = await fetch('/api/threads', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, projectId, agent, worktree }),
      });
      const payload = await result.json();
      if (!result.ok) throw new Error(payload.error || 'Could not create thread');
      window.location.assign(`/threads/${encodeURIComponent(payload.id)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create thread');
      setBusy(false);
    }
  };

  return <main className="form-page">
    <button className="mobile-menu" onClick={onOpenSidebar}>Threads</button>
    <h1>New thread</h1>
    <form onSubmit={submit}>
      <label>What are you working on?<input autoFocus required maxLength={90} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Thread name" /></label>
      <label>Project<select value={projectId} onChange={(event) => setProjectId(event.target.value)}>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      <label>Agent<select value={agent} onChange={(event) => setAgent(event.target.value as AgentKind)}>{(Object.keys(agentNames) as AgentKind[]).map((kind) => <option key={kind} value={kind}>{agentNames[kind]}</option>)}</select></label>
      <label className="checkbox-row"><input type="checkbox" checked={worktree} onChange={(event) => setWorktree(event.target.checked)} /> Create a new worktree</label>
      {error && <p role="alert" className="form-error">{error}</p>}
      <button className="form-submit" type="submit" disabled={!title.trim() || busy}>{busy ? 'Creating…' : 'Create thread'}</button>
    </form>
  </main>;
}
