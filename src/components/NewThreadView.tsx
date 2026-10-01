import { useEffect, useState } from 'react';
import { ArrowUp, GitBranch } from 'lucide-react';
import type { Project } from '../lib/models';
import type { Machine } from '../lib/machines';
import { LaunchSelectors } from './LaunchSelectors';
import { useMachineCatalog } from '../client/catalog';
import { navigate } from 'astro:transitions/client';

export function NewThreadView({ projects, machines, selectedProjectId, onOpenSidebar }: {
  projects: Project[]; machines: Machine[]; selectedProjectId?: string; onOpenSidebar: () => void;
}) {
  const [projectId, setProjectId] = useState(projects.find((project) => project.id === selectedProjectId)?.id ?? projects[0]?.id ?? '');
  const [machineId, setMachineId] = useState(machines[0]?.id ?? '');
  const [harness, setHarness] = useState('');
  const [model, setModel] = useState('Default');
  const [worktree, setWorktree] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const baseMachine = machines.find((machine) => machine.id === machineId) ?? { id: '', name: 'No target', connected: false, session: '', projectPaths: {}, harnesses: [] };
  const catalog = useMachineCatalog(machineId, baseMachine.connected);
  const machine = { ...baseMachine, harnesses: baseMachine.connected ? catalog.data?.harnesses ?? [] : [] };
  const machineProjects = projects.filter((project) => Object.hasOwn(machine.projectPaths, project.id)).map((project) => ({
    ...project, path: machine.projectPaths[project.id], iconUrl: machineId === 'local' ? project.iconUrl : undefined,
  }));
  const selectedHarness = machine.harnesses.find((choice) => choice.id === harness);
  const canSubmit = !!(prompt.trim() && model.trim() && machine.connected && machineProjects.some((project) => project.id === projectId) && selectedHarness?.launchEnabled) && !busy;
  useEffect(() => { setWorktree(localStorage.getItem('herdr-new-worktree') !== 'false'); }, []);

  const changeMachine = (id: string) => {
    const next = machines.find((machine) => machine.id === id);
    if (!next?.connected) return;
    setMachineId(id);
    if (!Object.hasOwn(next.projectPaths, projectId)) setProjectId(projects.find((project) => Object.hasOwn(next.projectPaths, project.id))?.id ?? '');
    setHarness('');
    setModel('Default');
    setError('');
  };

  const submit = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true); setError('');
    try {
      const result = await fetch('/api/threads', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ prompt, projectId, machineId, agent: harness, model: model.trim(), worktree }),
      });
      const payload = await result.json();
      if (!result.ok) throw new Error(payload.error || 'Could not create thread');
      await navigate(`/threads/${encodeURIComponent(payload.id)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create thread');
      setBusy(false);
    }
  };

  return <main className="new-thread-page" aria-label="New thread">
    <button className="mobile-menu" onClick={onOpenSidebar}>Threads</button>
    <h1>What do you want to build today?</h1>
    <form className="thread-composer" onSubmit={submit} aria-busy={busy}>
      <textarea autoFocus required maxLength={8000} value={prompt} onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}
        aria-label="Thread prompt" placeholder="Write a prompt…" />
      <div className="composer-toolbar">
        <LaunchSelectors machine={machine} machines={machines} projects={machineProjects} projectId={projectId} harness={harness} model={model}
          onMachineChange={changeMachine} onProjectChange={setProjectId} onHarnessChange={(id) => { setHarness(id); setModel('Default'); }} onModelChange={setModel} />
        <div className="composer-actions">
          <label className="worktree-option" title={worktree ? 'Start in a new worktree' : 'Use the current workspace'}><input type="checkbox" checked={worktree} onChange={(event) => setWorktree(event.target.checked)} aria-label="Create a new worktree" /><GitBranch size={15} aria-hidden="true" /></label>
          <button className="composer-send" type="submit" disabled={!canSubmit} aria-label="Create thread" title="Create thread">{busy ? '…' : <ArrowUp size={18} strokeWidth={2.2} />}</button>
        </div>
      </div>
    </form>
    <p className="composer-preview-note">{selectedHarness?.reason ?? (!machines.length ? 'No target is configured.' : catalog.isError ? 'The machine catalog is not available.' : 'Select a verified launch adapter.')}</p>
    {error && <p className="form-error" role="alert">{error}</p>}
  </main>;
}
