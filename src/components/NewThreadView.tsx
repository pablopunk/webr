import { useEffect, useState } from 'react';
import { ArrowUp, Cpu, GitBranch, Monitor, TerminalSquare } from 'lucide-react';
import type { Project } from '../lib/models';
import { findMachine, machines } from '../lib/machines';
import { ProjectPicker } from './ProjectPicker';

export function NewThreadView({ projects, selectedProjectId, onOpenSidebar }: {
  projects: Project[]; selectedProjectId?: string; onOpenSidebar: () => void;
}) {
  const [projectId, setProjectId] = useState(projects.find((project) => project.id === selectedProjectId)?.id ?? projects[0]?.id ?? '');
  const [machineId, setMachineId] = useState('local');
  const [harness, setHarness] = useState('claude');
  const [model, setModel] = useState('Default');
  const [worktree, setWorktree] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const machine = findMachine(machineId)!;
  const machineProjects = projects.filter((project) => Object.hasOwn(machine.projectPaths, project.id)).map((project) => ({
    ...project, path: machine.projectPaths[project.id], iconUrl: machineId === 'local' ? project.iconUrl : undefined,
  }));
  const modelChoices = machine.harnesses.find((choice) => choice.id === harness)?.models ?? ['Default'];
  const canSubmit = !!(prompt.trim() && model.trim() && machine.connected && machineProjects.some((project) => project.id === projectId) && machine.harnesses.some((choice) => choice.id === harness)) && !busy;
  useEffect(() => { setWorktree(localStorage.getItem('herdr-new-worktree') !== 'false'); }, []);

  const changeMachine = (id: string) => {
    const next = findMachine(id);
    if (!next?.connected) return;
    setMachineId(id);
    if (!Object.hasOwn(next.projectPaths, projectId)) setProjectId(projects.find((project) => Object.hasOwn(next.projectPaths, project.id))?.id ?? '');
    setHarness(next.harnesses.some((choice) => choice.id === harness) ? harness : next.harnesses[0]?.id ?? '');
    setModel('Default');
    setError('');
  };

  const submit = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true); setError('');
    try {
      const result = await fetch('/api/threads', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, projectId, machineId, agent: harness, model: model.trim(), worktree }),
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
    <h1>Build it.</h1>
    <form className="thread-composer" onSubmit={submit} aria-busy={busy}>
      <textarea autoFocus required maxLength={8000} value={prompt} onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}
        aria-label="Thread prompt" placeholder="Write a prompt…" />
      <div className="composer-toolbar">
        <label className="composer-choice machine-choice"><Monitor size={15} aria-hidden="true" /><select aria-label="Machine" value={machineId} onChange={(event) => changeMachine(event.target.value)}>{machines.map((choice) => <option key={choice.id} value={choice.id} disabled={!choice.connected}>{choice.name}{!choice.connected ? ' · Not connected' : ''}</option>)}</select></label>
        <span className="composer-divider" aria-hidden="true" />
        <ProjectPicker key={machineId} projects={machineProjects} projectId={projectId} onChange={setProjectId} />
        <span className="composer-divider" aria-hidden="true" />
        <label className="composer-choice harness-choice"><TerminalSquare size={15} aria-hidden="true" /><select aria-label="Harness" value={harness} onChange={(event) => { setHarness(event.target.value); setModel('Default'); }} required>{machine.harnesses.map((choice) => <option key={choice.id} value={choice.id}>{choice.name}</option>)}</select></label>
        <span className="composer-divider" aria-hidden="true" />
        <label className="composer-choice model-choice"><Cpu size={15} aria-hidden="true" /><input list="model-choices" aria-label="Model" value={model} onChange={(event) => setModel(event.target.value)} maxLength={120} required /></label>
        <datalist id="model-choices">{modelChoices.map((name) => <option key={name} value={name} />)}</datalist>
        <label className="worktree-option" title={worktree ? 'Start in a new worktree' : 'Use the current workspace'}><input type="checkbox" checked={worktree} onChange={(event) => setWorktree(event.target.checked)} aria-label="Create a new worktree" /><GitBranch size={15} aria-hidden="true" /><span>{worktree ? 'New worktree' : 'Current workspace'}</span></label>
        <button className="composer-send" type="submit" disabled={!canSubmit} aria-label="Create thread" title="Create thread">{busy ? '…' : <ArrowUp size={18} strokeWidth={2.2} />}</button>
      </div>
    </form>
    <p className="composer-preview-note">Machine choices are previews; no agent will start.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
  </main>;
}
