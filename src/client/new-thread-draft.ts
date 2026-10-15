import type { PromptImage } from '../components/usePromptImages';

export type NewThreadDraft = {
  prompt: string;
  images: PromptImage[];
  projectId?: string;
  machineId?: string;
  harness?: string;
  worktree?: boolean;
  launchId?: string;
};

const draftKey = 'webr-new-thread-draft';
const launchDraftKey = (id: string) => `webr-launch-draft:${id}`;

const isImage = (value: unknown): value is PromptImage => !!value && typeof value === 'object'
  && ['id', 'name', 'preview', 'path'].every((field) => typeof (value as Record<string, unknown>)[field] === 'string');

function parseDraft(value: unknown): NewThreadDraft | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const stored = value as Record<string, unknown>;
  return {
    prompt: typeof stored.prompt === 'string' ? stored.prompt : '',
    images: Array.isArray(stored.images) ? stored.images.filter(isImage) : [],
    ...(typeof stored.projectId === 'string' ? { projectId: stored.projectId } : {}),
    ...(typeof stored.machineId === 'string' ? { machineId: stored.machineId } : {}),
    ...(typeof stored.harness === 'string' ? { harness: stored.harness } : {}),
    ...(typeof stored.worktree === 'boolean' ? { worktree: stored.worktree } : {}),
    ...(typeof stored.launchId === 'string' ? { launchId: stored.launchId } : {}),
  };
}

function readDraft(key: string): NewThreadDraft | undefined {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? undefined : parseDraft(JSON.parse(stored));
  } catch { return undefined; }
}

export function readNewThreadDraft(): NewThreadDraft {
  return readDraft(draftKey) ?? { prompt: '', images: [] };
}

export function writeNewThreadDraft(draft: NewThreadDraft): boolean {
  try {
    if (!draft.prompt && !draft.images.length) localStorage.removeItem(draftKey);
    else localStorage.setItem(draftKey, JSON.stringify(draft));
    return true;
  } catch { return false; }
}

export function writeLaunchDraft(id: string, draft: NewThreadDraft): boolean {
  try {
    localStorage.setItem(launchDraftKey(id), JSON.stringify(draft));
    return true;
  } catch { return false; }
}

export const readLaunchDraft = (id: string) => readDraft(launchDraftKey(id));

export function clearLaunchDraft(id: string) {
  try { localStorage.removeItem(launchDraftKey(id)); } catch { /* Keep the draft if storage is unavailable. */ }
}

export function clearNewThreadDraftForLaunch(id: string) {
  if (readNewThreadDraft().launchId === id) writeNewThreadDraft({ prompt: '', images: [] });
}

export const clearNewThreadDraft = () => writeNewThreadDraft({ prompt: '', images: [] });
