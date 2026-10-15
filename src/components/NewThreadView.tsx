import { useEffect, useRef, useState } from 'react';
import { ArrowUp, FileText, GitBranch } from 'lucide-react';
import type { Project } from '../lib/models';
import { promptWithImages, usePromptImages } from './usePromptImages';
import { X } from 'lucide-react';
import type { Machine } from '../lib/machines';
import { LaunchSelectors } from './LaunchSelectors';
import { useMachineCatalog } from '../client/catalog';
import { navigate } from 'astro:transitions/client';
import { CreateWorkspace } from './CreateWorkspace';
import { initialWorktreeChoice, recordWorktreeChoice } from '../client/new-session-behavior';
import { clearLaunchDraft, clearNewThreadDraft, readLaunchDraft, readNewThreadDraft, writeLaunchDraft, writeNewThreadDraft, type NewThreadDraft } from '../client/new-thread-draft';
import { Tooltip } from './Tooltip';
import { uuid } from '../lib/uuid';

const harnessPreference = (machineId: string, projectId: string) => `webr-last-harness:${machineId}:${projectId}`;
const removeRecoveryQuery = (id: string) => {
  const url = new URL(window.location.href);
  if (url.searchParams.get('recover') !== id) return;
  url.searchParams.delete('recover');
  window.history.replaceState(window.history.state, '', url);
};

export function NewThreadView({ projects, machines, selectedProjectId, onOpenSidebar }: {
  projects: Project[]; machines: Machine[]; selectedProjectId?: string; onOpenSidebar: () => void;
}) {
  const [projectId, setProjectId] = useState(projects.find((project) => project.id === selectedProjectId)?.id ?? projects[0]?.id ?? '');
  const [machineId, setMachineId] = useState(machines.find((machine) => selectedProjectId && Object.hasOwn(machine.projectPaths, selectedProjectId))?.id ?? machines[0]?.id ?? '');
  const [harness, setHarness] = useState('');
  const [worktree, setWorktree] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const projectIdsBeforeCreate = useRef<Set<string> | null>(null);
  const operation = useRef<{ payload: string; key: string } | null>(null);
  const pendingRecoveryId = useRef<string | undefined>(undefined);
  const recoveredWorktree = useRef<{ key: string; value: boolean } | null>(null);
  const recoveredHarness = useRef<{ key: string; value: string } | null>(null);
  const images = usePromptImages({ machineId });
  const baseMachine = machines.find((machine) => machine.id === machineId) ?? { id: '', name: 'No target', connected: false, session: '', projectPaths: {}, harnesses: [] };
  const catalog = useMachineCatalog(machineId, baseMachine.connected, baseMachine.configVersion, baseMachine.session, projectId);
  const machine = { ...baseMachine, harnesses: baseMachine.connected ? catalog.data?.harnesses ?? [] : [] };
  const machineProjects = projects.filter((project) => Object.hasOwn(machine.projectPaths, project.id)).map((project) => ({
    ...project, path: machine.projectPaths[project.id],
  }));
  const canUseWorktree = catalog.data?.isGitRepo === true;
  const selectedHarness = machine.harnesses.find((choice) => choice.id === harness);
  const canSubmit = !!(prompt.trim() && !images.uploading && machine.connected && machineProjects.some((project) => project.id === projectId) && selectedHarness?.launchEnabled) && !busy;
  const harnessIds = catalog.data?.harnesses.map((choice) => choice.id).join(',');
  useEffect(() => {
    const recoveryId = new URLSearchParams(window.location.search).get('recover') ?? '';
    const recoveryDraft = recoveryId ? readLaunchDraft(recoveryId) : undefined;
    const draft = recoveryDraft ?? readNewThreadDraft();
    setPrompt(draft.prompt); images.setAttachments(draft.images);
    if (recoveryId) {
      const restoredProjectId = selectedProjectId ?? draft.projectId ?? projectId;
      if (!selectedProjectId && draft.projectId && projects.some((project) => project.id === draft.projectId)) setProjectId(draft.projectId);
      const restoredMachine = machines.find((machine) => machine.id === draft.machineId && Object.hasOwn(machine.projectPaths, restoredProjectId));
      if (restoredMachine) setMachineId(restoredMachine.id);
      const key = `${draft.machineId ?? ''}:${restoredProjectId}`;
      if (draft.worktree !== undefined) recoveredWorktree.current = { key, value: draft.worktree };
      if (draft.harness) recoveredHarness.current = { key, value: draft.harness };
      pendingRecoveryId.current = recoveryId;
      if (writeNewThreadDraft({ ...draft, launchId: undefined })) {
        clearLaunchDraft(recoveryId);
        pendingRecoveryId.current = undefined;
        removeRecoveryQuery(recoveryId);
      }
    }
    setDraftHydrated(true);
  }, []);
  useEffect(() => {
    if (!draftHydrated) return;
    const saved = writeNewThreadDraft({ prompt, images: images.attachments, projectId, machineId, harness, worktree });
    const recoveryId = pendingRecoveryId.current;
    if (saved && recoveryId) {
      clearLaunchDraft(recoveryId);
      pendingRecoveryId.current = undefined;
      removeRecoveryQuery(recoveryId);
    }
  }, [draftHydrated, prompt, images.attachments, projectId, machineId, harness, worktree]);
  useEffect(() => {
    const key = `${machineId}:${projectId}`;
    if (recoveredWorktree.current?.key === key) {
      setWorktree(recoveredWorktree.current.value);
      recoveredWorktree.current = null;
    } else setWorktree(initialWorktreeChoice(machineId, projectId));
  }, [machineId, projectId]);
  useEffect(() => {
    if (!projectId || !catalog.data) return;
    const choices = catalog.data.harnesses;
    const key = `${machineId}:${projectId}`;
    const restored = recoveredHarness.current?.key === key ? recoveredHarness.current.value : undefined;
    const previous = localStorage.getItem(harnessPreference(machineId, projectId));
    setHarness(choices.find((choice) => choice.id === restored)?.id ?? choices.find((choice) => choice.id === previous)?.id ?? choices.find((choice) => choice.launchEnabled)?.id ?? choices[0]?.id ?? '');
    if (restored) recoveredHarness.current = null;
  }, [machineId, projectId, harnessIds]);
  useEffect(() => {
    const known = projectIdsBeforeCreate.current;
    const added = known && machineProjects.find((project) => !known.has(project.id));
    if (added) { projectIdsBeforeCreate.current = null; changeProject(added.id); }
  }, [machineProjects]);
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
    setError('');
  };
  const changeProject = (id: string) => { setProjectId(id); setHarness(''); setError(''); };
  const changeHarness = (id: string) => {
    setHarness(id);
    if (projectId) localStorage.setItem(harnessPreference(machineId, projectId), id);
  };

  const submit = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy(true); setError('');
    const launchWorktree = worktree && canUseWorktree;
    const draft: NewThreadDraft = { prompt, images: images.attachments, projectId, machineId, harness, worktree: launchWorktree };
    writeNewThreadDraft(draft);
    const payload = JSON.stringify({ prompt: promptWithImages(prompt, images.attachments), projectId, machineId, agent: harness, model: 'Default', worktree: launchWorktree });
    if (operation.current?.payload !== payload) operation.current = { payload, key: uuid() };
    try {
      const result = await fetch('/api/threads', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': operation.current.key },
        body: payload,
      });
      const response = await result.json();
      if (!result.ok) throw new Error(response.error || 'Could not create thread');
      recordWorktreeChoice(machineId, projectId, worktree);
      if (writeLaunchDraft(response.id, draft)) clearNewThreadDraft();
      else writeNewThreadDraft({ ...draft, launchId: response.id });
      await navigate(`/threads/${encodeURIComponent(response.id)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create thread');
      setBusy(false);
    }
  };

  return <main className="new-thread-page" aria-label="New thread">
    <button className="mobile-menu" onClick={onOpenSidebar}>Threads</button>
    <h1>What do you want to build today?</h1>
    {machine.connected && machine.writable && (!machineProjects.length || creatingWorkspace) ? <>
      <p>{!machineProjects.length ? 'This Herdr session has no projects yet.' : 'Add a project to this Herdr session.'}</p>
      <CreateWorkspace machineId={machine.id} onCreated={() => { projectIdsBeforeCreate.current = new Set(machineProjects.map((project) => project.id)); setCreatingWorkspace(false); }} />
      {!!machineProjects.length && <button className="workspace-cancel" onClick={() => setCreatingWorkspace(false)}>Cancel</button>}
    </> : <>
    <form className={`thread-composer ${images.dragging ? 'is-dropping' : ''}`} onSubmit={submit} aria-busy={busy} {...images.handlers}>
      {(images.attachments.length > 0 || images.uploading > 0) && <ul className="composer-images" aria-label="Attached files">
        {images.attachments.map((image) => <li key={image.id} className={image.preview ? undefined : 'is-file'}>{image.preview ? <img src={image.preview} alt={image.name} /> : <><FileText size={18} strokeWidth={1.8} /><span>{image.name}</span></>}<Tooltip label="Remove file"><button type="button" aria-label={`Remove ${image.name}`} onClick={() => images.remove(image.id)}><X size={12} strokeWidth={2.4} /></button></Tooltip></li>)}
        {Array.from({ length: images.uploading }, (_, index) => <li key={'uploading-' + index} className="is-uploading" aria-label="Uploading file" />)}
      </ul>}
      <textarea autoFocus required maxLength={8000} value={prompt} onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}
        aria-label="Thread prompt" placeholder="Write a prompt, or drop an image…" />
      <div className="composer-toolbar">
        <LaunchSelectors machine={machine} machines={machines} projects={machineProjects} projectId={projectId} harness={harness}
          onMachineChange={changeMachine} onProjectChange={changeProject} onHarnessChange={changeHarness}
          onAddProject={machine.connected && machine.writable ? () => setCreatingWorkspace(true) : undefined} />
        {canUseWorktree && <Tooltip label={worktree ? 'new worktree' : 'current checkout'}><label className="worktree-option"><input type="checkbox" checked={worktree} onChange={(event) => setWorktree(event.target.checked)} aria-label="Create a new worktree" /><GitBranch size={15} aria-hidden="true" /></label></Tooltip>}
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
