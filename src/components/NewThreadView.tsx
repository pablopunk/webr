import { useEffect, useRef, useState } from 'react';
import { ArrowUp, FileText, GitBranch } from 'lucide-react';
import type { Project } from '../lib/models';
import { promptWithImages, usePromptImages } from './usePromptImages';
import { X } from 'lucide-react';
import type { Machine } from '../lib/machines';
import { LaunchSelectors } from './LaunchSelectors';
import { useMachineCatalog } from '../client/catalog';
import type { AppNavigate } from '../client/app-navigation';
import { CreateWorkspace } from './CreateWorkspace';
import { initialWorktreeChoice, recordWorktreeChoice } from '../client/new-session-behavior';
import { clearLaunchDraft, readLaunchDraft, readNewThreadDraft, writeNewThreadDraft, type NewThreadDraft } from '../client/new-thread-draft';
import { Tooltip } from './Tooltip';
import { useThreadTickets } from '../client/provider';
import { buildPendingThreadUrl } from '../client/navigation';
import { withTildeHome } from '../client/home-path';

const harnessPreference = (machineId: string, projectId: string) => `webr-last-harness:${machineId}:${projectId}`;
const comparableWorkspacePath = (path: string) => {
  let normalized = withTildeHome(path);
  while (normalized.length > 1 && normalized.endsWith('/')) normalized = normalized.slice(0, -1);
  return normalized;
};
const removeRecoveryQuery = (id: string, onNavigate?: AppNavigate) => {
  const url = new URL(window.location.href);
  if (url.searchParams.get('recover') !== id) return;
  url.searchParams.delete('recover');
  if (onNavigate) onNavigate(url.href, { replace: true });
  else window.history.replaceState(window.history.state, '', url);
};

export function NewThreadView({ projects, machines, selectedProjectId, workspacePendingKey, onOpenSidebar, onNavigate }: {
  projects: Project[]; machines: Machine[]; selectedProjectId?: string; workspacePendingKey?: string; onOpenSidebar: () => void; onNavigate?: AppNavigate;
}) {
  const [projectId, setProjectId] = useState(projects.find((project) => project.id === selectedProjectId)?.id ?? projects[0]?.id ?? '');
  const [machineId, setMachineId] = useState(machines.find((machine) => selectedProjectId && Object.hasOwn(machine.projectPaths, selectedProjectId))?.id ?? machines[0]?.id ?? '');
  const [harness, setHarness] = useState('');
  const [worktree, setWorktree] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [creatingWorkspace, setCreatingWorkspace] = useState(!!workspacePendingKey);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [workspaceCompletion, setWorkspaceCompletion] = useState(0);
  const workspaceSelection = useRef<{ key: string; machineId: string; beforeProjectIds: Set<string>; selectionVersion: number } | null>(null);
  const projectSelectionVersion = useRef(0);
  const submitting = useRef(false);
  const tickets = useThreadTickets();
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
  const captureWorkspaceSelection = (key: string) => {
    const ticket = tickets.getResource(key);
    if (!ticket || ticket.kind !== 'workspace') return;
    const target = machines.find((item) => item.id === ticket.normalizedPayload.machineId);
    workspaceSelection.current = {
      key, machineId: ticket.normalizedPayload.machineId,
      beforeProjectIds: new Set(target ? projects.filter((project) => Object.hasOwn(target.projectPaths, project.id)).map((project) => project.id) : []),
      selectionVersion: projectSelectionVersion.current,
    };
  };
  const canUseWorktree = catalog.data?.isGitRepo === true;
  const selectedHarness = machine.harnesses.find((choice) => choice.id === harness);
  const canSubmit = !!(prompt.trim() && !images.uploading && machine.connected && machineProjects.some((project) => project.id === projectId) && selectedHarness?.launchEnabled) && !busy;
  const harnessIds = catalog.data?.harnesses.map((choice) => choice.id).join(',');
  useEffect(() => {
    const recoveryId = new URLSearchParams(window.location.search).get('recover') ?? '';
    const recoveryDraft = recoveryId ? readLaunchDraft(tickets.recoveryScope, recoveryId) ?? tickets.getDraft(recoveryId) : undefined;
    const draft = recoveryDraft ?? (recoveryId ? { prompt: '', images: [] } : readNewThreadDraft(tickets.recoveryScope));
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
      if (writeNewThreadDraft(tickets.recoveryScope, { ...draft, launchId: undefined })) {
        clearLaunchDraft(tickets.recoveryScope, recoveryId);
        pendingRecoveryId.current = undefined;
        removeRecoveryQuery(recoveryId, onNavigate);
      }
    }
    setDraftHydrated(true);
  }, []);
  useEffect(() => {
    if (!workspacePendingKey) return;
    setCreatingWorkspace(true);
    const ticket = tickets.getResource(workspacePendingKey);
    if (ticket?.kind === 'workspace') {
      if (workspaceSelection.current?.key !== workspacePendingKey) captureWorkspaceSelection(workspacePendingKey);
      const target = machines.find((machine) => machine.id === ticket.normalizedPayload.machineId);
      if (target) setMachineId(target.id);
    }
  }, [workspacePendingKey, machines, tickets]);
  useEffect(() => {
    if (!draftHydrated) return;
    const saved = writeNewThreadDraft(tickets.recoveryScope, { prompt, images: images.attachments, projectId, machineId, harness, worktree });
    const recoveryId = pendingRecoveryId.current;
    if (saved && recoveryId) {
      clearLaunchDraft(tickets.recoveryScope, recoveryId);
      pendingRecoveryId.current = undefined;
      removeRecoveryQuery(recoveryId, onNavigate);
    }
  }, [draftHydrated, prompt, images.attachments, projectId, machineId, harness, worktree, tickets.recoveryScope]);
  useEffect(() => {
    const key = `${machineId}:${projectId}`;
    if (recoveredWorktree.current?.key === key) {
      setWorktree(recoveredWorktree.current.value);
      recoveredWorktree.current = null;
    } else setWorktree(initialWorktreeChoice(machineId, projectId));
  }, [machineId, projectId]);
  useEffect(() => {
    if (!projectId || !catalog.data) return;
    const choices = catalog.data.harnesses.filter((choice) => choice.launchEnabled);
    const key = `${machineId}:${projectId}`;
    const restored = recoveredHarness.current?.key === key ? recoveredHarness.current.value : undefined;
    const previous = localStorage.getItem(harnessPreference(machineId, projectId));
    setHarness(choices.find((choice) => choice.id === restored)?.id ?? choices.find((choice) => choice.id === previous)?.id ?? choices.find((choice) => choice.launchEnabled)?.id ?? choices[0]?.id ?? '');
    if (restored) recoveredHarness.current = null;
  }, [machineId, projectId, harnessIds]);
  useEffect(() => {
    const intent = workspaceSelection.current;
    if (!intent) return;
    if (projectSelectionVersion.current !== intent.selectionVersion) { workspaceSelection.current = null; return; }
    const ticket = tickets.getResource(intent.key);
    if (ticket?.kind !== 'workspace' || ticket.state !== 'ready') return;
    const target = machines.find((item) => item.id === intent.machineId);
    if (!target) return;
    const targetProjects = projects.filter((project) => Object.hasOwn(target.projectPaths, project.id)).map((project) => ({
      ...project, path: target.projectPaths[project.id],
    }));
    const requestedPath = comparableWorkspacePath(ticket.normalizedPayload.path);
    const pathMatches = (project: typeof targetProjects[number]) => comparableWorkspacePath(project.path) === requestedPath;
    const addedMatch = targetProjects.find((project) => !intent.beforeProjectIds.has(project.id) && pathMatches(project));
    const createdProject = addedMatch ?? targetProjects.find(pathMatches);
    if (!createdProject) return;
    workspaceSelection.current = null;
    setMachineId(intent.machineId); setProjectId(createdProject.id);
  }, [projects, machines, tickets, workspacePendingKey, workspaceCompletion]);
  useEffect(() => {
    if (!machineId && machines.length) setMachineId(machines.find((machine) => machine.id === 'local')?.id ?? machines[0].id);
    if (!projectId && machineProjects.length) setProjectId(machineProjects[0].id);
  }, [machines, machineId, machineProjects, projectId]);

  const changeMachine = (id: string) => {
    const next = machines.find((machine) => machine.id === id);
    if (!next?.connected) return;
    projectSelectionVersion.current++;
    setMachineId(id);
    if (!Object.hasOwn(next.projectPaths, projectId)) setProjectId(projects.find((project) => Object.hasOwn(next.projectPaths, project.id))?.id ?? '');
    setHarness('');
    setError('');
  };
  const changeProject = (id: string) => { projectSelectionVersion.current++; setProjectId(id); setHarness(''); setError(''); };
  const changeHarness = (id: string) => {
    setHarness(id);
    if (projectId) localStorage.setItem(harnessPreference(machineId, projectId), id);
  };
  const setWorkspacePending = (key?: string) => {
    if (key) captureWorkspaceSelection(key);
    else workspaceSelection.current = null;
    const url = new URL(window.location.href);
    if (key) url.searchParams.set('workspacePending', key);
    else url.searchParams.delete('workspacePending');
    if (onNavigate) onNavigate(url.href, { replace: true });
    else window.history.replaceState(window.history.state, '', url);
  };
  const completeWorkspaceCreate = () => {
    if (!workspaceSelection.current && workspacePendingKey) captureWorkspaceSelection(workspacePendingKey);
    if (workspaceSelection.current) setWorkspaceCompletion((version) => version + 1);
    const url = new URL(window.location.href); url.searchParams.delete('workspacePending');
    if (onNavigate) onNavigate(url.href, { replace: true });
    else window.history.replaceState(window.history.state, '', url);
    setCreatingWorkspace(false);
  };

  const submit = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || submitting.current) return;
    submitting.current = true;
    setBusy(true); setError('');
    const launchWorktree = worktree && canUseWorktree;
    const draft: NewThreadDraft = { prompt, images: images.attachments, projectId, machineId, harness, worktree: launchWorktree };
    let ticket: ReturnType<typeof tickets.create>;
    try {
      ticket = tickets.create({
        prompt: promptWithImages(prompt, images.attachments), projectId, machineId, agent: harness, model: 'Default', worktree: launchWorktree,
      }, draft);
    } catch {
      submitting.current = false; setBusy(false); setError('The prompt could not be prepared for launch.'); return;
    }
    try { recordWorktreeChoice(machineId, projectId, worktree); } catch { /* This preference is not required to submit the ticket. */ }
    const destination = buildPendingThreadUrl(ticket.key, window.location.href);
    if (onNavigate) onNavigate(destination);
    else window.history.pushState(window.history.state, '', destination);
    void tickets.start(ticket.key);
  };

  return <main className="new-thread-page" aria-label="New thread">
    <button className="mobile-menu" onClick={onOpenSidebar}>Threads</button>
    <h1>What do you want to build today?</h1>
    {(!!workspacePendingKey || machine.connected && machine.writable && (!machineProjects.length || creatingWorkspace)) ? <>
      <p>{workspacePendingKey ? 'Recovering the accepted workspace create.' : !machineProjects.length ? 'This Herdr session has no projects yet.' : 'Add a project to this Herdr session.'}</p>
      <CreateWorkspace key={`${tickets.resourceRecoveryScope}:${workspacePendingKey ?? ''}`} machineId={machine.id} session={machine.session} configVersion={machine.configVersion} pendingKey={workspacePendingKey} onPending={setWorkspacePending} onCreated={completeWorkspaceCreate} />
      {(!!machineProjects.length || !!workspacePendingKey && !tickets.getResource(workspacePendingKey)) && <button className="workspace-cancel" onClick={() => { setWorkspacePending(); setCreatingWorkspace(false); }}>Cancel</button>}
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
        <LaunchSelectors machine={machine} machines={machines} projects={machineProjects} projectId={projectId} harness={harness} catalog={catalog}
          onMachineChange={changeMachine} onProjectChange={changeProject} onHarnessChange={changeHarness}
          onAddProject={machine.connected && machine.writable ? () => setCreatingWorkspace(true) : undefined} />
        {canUseWorktree && <Tooltip label={worktree ? 'new worktree' : 'current checkout'}><label className="worktree-option"><input type="checkbox" checked={worktree} onChange={(event) => setWorktree(event.target.checked)} aria-label="Create a new worktree" /><GitBranch size={15} aria-hidden="true" /></label></Tooltip>}
        <div className="composer-actions">
          <Tooltip label="Create thread"><button className="composer-send" type="submit" disabled={!canSubmit} aria-label="Create thread">{busy ? '…' : <ArrowUp size={18} strokeWidth={2.2} />}</button></Tooltip>
        </div>
      </div>
    </form>
    {(selectedHarness?.reason || !machines.length || machine.error || catalog.isError && !catalog.data) && <p className="composer-preview-note">{selectedHarness?.reason ?? (!machines.length ? 'No target is configured.' : machine.error ? `Machine is not connected: ${machine.error.replaceAll('_', ' ')}.` : 'The machine catalog is not available.')}</p>}
    {images.error && <p className="form-error" role="alert">{images.error}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    </>}
  </main>;
}
