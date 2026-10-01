import { useEffect, useState } from 'react';
import { ArrowUp, Cpu, GitBranch, TerminalSquare } from 'lucide-react';
import { harnessNames, type Project } from '../lib/models';
import { ProjectPicker } from './ProjectPicker';

const harnessChoices = Object.entries(harnessNames);
const modelChoices = ['Default'];

export function NewThreadView({ projects, selectedProjectId, onOpenSidebar }: {
  projects: Project[]; selectedProjectId?: string; onOpenSidebar: () => void;
}) {
  const [projectId, setProjectId] = useState(projects.find((project) => project.id === selectedProjectId)?.id ?? projects[0]?.id ?? '');
  const [harness, setHarness] = useState('Claude Code');
  const [model, setModel] = useState('Default');
  const [worktree, setWorktree] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setWorktree(localStorage.getItem('herdr-new-worktree') !== 'false'); }, []);

  const submit = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!prompt.trim() || !harness.trim() || !model.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const agent = harnessChoices.find(([, name]) => name.toLowerCase() === harness.trim().toLowerCase())?.[0] ?? harness.trim();
      const result = await fetch('/api/threads', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, projectId, agent, model: model.trim(), worktree }),
      });
      const payload = await result.json();
      if (!result.ok) throw new Error(payload.error || 'Could not create thread');
      window.location.assign(`/threads/${encodeURIComponent(payload.id)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create thread');
      setBusy(false);
    }
  };

  return <main className="new-thread-page" aria-label="New thread">
    <button className="mobile-menu" onClick={onOpenSidebar}>Threads</button>
    <h1>What should we build in <ProjectPicker projects={projects} projectId={projectId} onChange={setProjectId} />?</h1>
    <form className="thread-composer" onSubmit={submit} aria-busy={busy}>
      <textarea autoFocus required maxLength={8000} value={prompt} onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}
        aria-label="Thread prompt" placeholder="Ask for changes, send follow-ups, or describe a task…" />
      <div className="composer-toolbar">
        <label className="composer-choice harness-choice"><TerminalSquare size={15} aria-hidden="true" /><input list="harness-choices" aria-label="Harness" value={harness} onChange={(event) => setHarness(event.target.value)} maxLength={80} required /></label>
        <datalist id="harness-choices">{harnessChoices.map(([id, name]) => <option key={id} value={name} />)}</datalist>
        <span className="composer-divider" aria-hidden="true" />
        <label className="composer-choice model-choice"><Cpu size={15} aria-hidden="true" /><input list="model-choices" aria-label="Model" value={model} onChange={(event) => setModel(event.target.value)} maxLength={120} required /></label>
        <datalist id="model-choices">{modelChoices.map((name) => <option key={name} value={name} />)}</datalist>
        <label className="worktree-option" title={worktree ? 'Start in a new worktree' : 'Use the current workspace'}><input type="checkbox" checked={worktree} onChange={(event) => setWorktree(event.target.checked)} aria-label="Create a new worktree" /><GitBranch size={15} aria-hidden="true" /><span>{worktree ? 'New worktree' : 'Current workspace'}</span></label>
        <button className="composer-send" type="submit" disabled={!prompt.trim() || !harness.trim() || !model.trim() || !projectId || busy} aria-label="Create thread" title="Create thread">{busy ? '…' : <ArrowUp size={18} strokeWidth={2.2} />}</button>
      </div>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
  </main>;
}
