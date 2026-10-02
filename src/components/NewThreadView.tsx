import { useEffect, useRef, useState } from 'react';
import { ArrowUp, GitBranch } from 'lucide-react';
import type { Project } from '../lib/models';
import { promptWithImages, usePromptImages } from './usePromptImages';
import { X } from 'lucide-react';
import type { Machine } from '../lib/machines';
import { LaunchSelectors } from './LaunchSelectors';
import { useMachineCatalog } from '../client/catalog';
import { navigate } from 'astro:transitions/client';
import { CreateWorkspace } from './CreateWorkspace';
import { initialWorktreeChoice, recordWorktreeChoice } from '../client/new-session-behavior';
import { clearNewThreadDraft, readNewThreadDraft, writeNewThreadDraft } from '../client/new-thread-draft';
import { Tooltip } from './Tooltip';
import { uuid } from '../lib/uuid';

const harnessPreference = (machineId: string, projectId: string) => `webr-last-harness:${machineId}:${projectId}`;

export function NewThreadView({ projects, machines, selectedProjectId, onOpenSidebar }: {
  projects: Project[]; machines: Machine[]; selectedProjectId?: string; onOpenSidebar: () => void;
}) {
  const [projectId, setProjectId] = useState(projects.find((project) => project.id === selectedProjectId)?.id ?? projects[0]?.id ?? '');
  const [machineId, setMachineId] = useState(machines.find((machine) => selectedProjectId && Object.hasOwn(machine.projectPaths, selectedProjectId))?.id ?? machines[0]?.id ?? '');
  const [harness, setHarness] = useState('');
  const [model, setModel] = useState('Default');
  const [worktree, setWorktree] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const operation = useRef<{ payload: string; key: string } | null>(null);
  const images = usePromptImages({ machineId });
  const baseMachine = machines.find((machine) => machine.id === machineId) ?? { id: '', name: 'No target', connected: false, session: '', projectPaths: {}, harnesses: [] };
  const catalog = useMachineCatalog(machineId, baseMachine.connected, baseMachine.configVersion, baseMachine.session, projectId);
  const machine = { ...baseMachine, harnesses: baseMachine.connected ? catalog.data?.harnesses ?? [] : [] };
  const machineProjects = projects.filter((project) => Object.hasOwn(machine.projectPaths, project.id)).map((project) => ({
    ...project, path: machine.projectPaths[project.id], iconUrl: machineId === 'local' ? project.iconUrl : undefined,
  }));
  const selectedHarness = machine.harnesses.find((choice) => choice.id === harness);
  const canSubmit = !!(prompt.trim() && !images.uploading && model.trim() && machine.connected && machineProjects.some((project) => project.id === projectId) && selectedHarness?.launchEnabled) && !busy;
  const draftRestored = useRef(false);
  useEffect(() => {
    const draft = readNewThreadDraft();
    setPrompt(draft.prompt); images.setAttachments(draft.images);
    draftRestored.current = true;
  }, []);
  useEffect(() => {
    if (draftRestored.current) writeNewThreadDraft({ prompt, images: images.attachments });
  }, [prompt, images.attachments]);
  useEffect(() => { setWorktree(initialWorktreeChoice(machineId, projectId)); }, [machineId, projectId]);
  useEffect(() => {
    if (!projectId || !catalog.data) return;
    const choices = catalog.data.harnesses;
    const previous = localStorage.getItem(harnessPreference(machineId, projectId));
    setHarness(choices.find((choice) => choice.id === previous)?.id ?? choices.find((choice) => choice.launchEnabled)?.id ?? choices[0]?.id ?? '');
    setModel('Default');
  }, [machineId, projectId, catalog.data]);
  useEffect(() => {
    if (!machineId && machines.length) setMachineId(machines.find((machine) => machine.id === 'local')?.id ?? machines[0].id);
    if (!projectId && machineProjects.length) setProjectId(machineProjects[0].id);
  }, [machines, machineId, machineProjects, projectId]);

  const changeMachine = (id: string) => {
    const next = machines.find((machine) => machine.id === id);
    if (!next?.connected) return;
    setMachineId(id);
    if (!Object.hasOwn(next.projectPaths, projectId)) setProjectId(projects.find((project) => Object.hasOwn(next.projectPaths, project.id))?.id ?? '');
    setHarness('');
    setModel('Default');
    setError('');
  };
  const changeProject = (id: string) => { setProjectId(id); setHarness(''); setModel('Default'); setError(''); };
  const changeHarness = (id: string) => {
    setHarness(id); setModel('Default');
    if (projectId) localStorage.setItem(harnessPreference(machineId, projectId), id);
  };

  const submit = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true); setError('');
    const payload = JSON.stringify({ prompt: promptWithImages(prompt, images.attachments), projectId, machineId, agent: harness, model: model.trim(), worktree });
    if (operation.current?.payload !== payload) operation.current = { payload, key: uuid() };
    try {
      const result = await fetch('/api/threads', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operation.current.key },
        body: payload,
      });
      const response = await result.json();
      if (!result.ok) throw new Error(response.error || 'Could not create thread');
      recordWorktreeChoice(machineId, projectId, worktree);
      clearNewThreadDraft();
      await navigate(`/threads/${encodeURIComponent(response.id)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create thread');
      setBusy(false);
    }
  };

  return <main className="new-thread-page" aria-label="New thread">
    <button className="mobile-menu" onClick={onOpenSidebar}>Threads</button>
    <h1>What do you want to build today?</h1>
    {machine.connected && machine.id === 'local' && (!machineProjects.length || creatingWorkspace) ? <>
      <p>{!machineProjects.length ? 'This Herdr session has no projects yet.' : 'Add a project to this Herdr session.'}</p>
      <CreateWorkspace machineId={machine.id} onCreated={() => setCreatingWorkspace(false)} />
      {!!machineProjects.length && <button className="workspace-cancel" onClick={() => setCreatingWorkspace(false)}>Cancel</button>}
    </> : <>
    <form className={`thread-composer ${images.dragging ? 'is-dropping' : ''}`} onSubmit={submit} aria-busy={busy} {...images.handlers}>
      {(images.attachments.length > 0 || images.uploading > 0) && <ul className="composer-images" aria-label="Attached images">
        {images.attachments.map((image) => <li key={image.id}><img src={image.preview} alt={image.name} /><Tooltip label="Remove image"><button type="button" aria-label={`Remove ${image.name}`} onClick={() => images.remove(image.id)}><X size={12} strokeWidth={2.4} /></button></Tooltip></li>)}
        {Array.from({ length: images.uploading }, (_, index) => <li key={'uploading-' + index} className="is-uploading" aria-label="Uploading image" />)}
      </ul>}
      <textarea autoFocus required maxLength={8000} value={prompt} onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}
        aria-label="Thread prompt" placeholder="Write a prompt, or drop an image…" />
      <div className="composer-toolbar">
        <LaunchSelectors machine={machine} machines={machines} projects={machineProjects} projectId={projectId} harness={harness} model={model}
          onMachineChange={changeMachine} onProjectChange={changeProject} onHarnessChange={changeHarness} onModelChange={setModel}
          onAddProject={machine.connected && machine.id === 'local' ? () => setCreatingWorkspace(true) : undefined} />
        <Tooltip label={worktree ? 'new worktree' : 'current checkout'}><label className="worktree-option"><input type="checkbox" checked={worktree} onChange={(event) => setWorktree(event.target.checked)} aria-label="Create a new worktree" /><GitBranch size={15} aria-hidden="true" /></label></Tooltip>
        <div className="composer-actions">
          <Tooltip label="Create thread"><button className="composer-send" type="submit" disabled={!canSubmit} aria-label="Create thread">{busy ? '…' : <ArrowUp size={18} strokeWidth={2.2} />}</button></Tooltip>
        </div>
      </div>
    </form>
    {(selectedHarness?.reason || !machines.length || machine.error || catalog.isError) && <p className="composer-preview-note">{selectedHarness?.reason ?? (!machines.length ? 'No target is configured.' : machine.error ? `Machine is not connected: ${machine.error.replaceAll('_', ' ')}.` : 'The machine catalog is not available.')}</p>}
    {images.error && <p className="form-error" role="alert">{images.error}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    </>}
  </main>;
}
