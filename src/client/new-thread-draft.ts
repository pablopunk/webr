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

const storagePrefix = (scope: string) => `webr:recovery:v1:${encodeURIComponent(scope)}:`;
const draftKey = (scope: string) => `${storagePrefix(scope)}composer`;
const launchDraftKey = (scope: string, id: string) => `${storagePrefix(scope)}launch:${encodeURIComponent(id)}`;
const isImage = (value: unknown): value is PromptImage => !!value && typeof value === 'object'
  && ['id', 'name', 'preview', 'path'].every((field) => typeof (value as Record<string, unknown>)[field] === 'string');

function withoutPreviews(draft: NewThreadDraft): NewThreadDraft {
  return { ...draft, images: draft.images.map(({ id, name, path }) => ({ id, name, path, preview: '' })) };
}

function parseDraft(value: unknown): NewThreadDraft | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const stored = value as Record<string, unknown>;
  const images = Array.isArray(stored.images) ? stored.images.filter(isImage) : [];
  return withoutPreviews({
    prompt: typeof stored.prompt === 'string' ? stored.prompt : '',
    images,
    ...(typeof stored.projectId === 'string' ? { projectId: stored.projectId } : {}),
    ...(typeof stored.machineId === 'string' ? { machineId: stored.machineId } : {}),
    ...(typeof stored.harness === 'string' ? { harness: stored.harness } : {}),
    ...(typeof stored.worktree === 'boolean' ? { worktree: stored.worktree } : {}),
    ...(typeof stored.launchId === 'string' ? { launchId: stored.launchId } : {}),
  });
}

function readDraft(scope: string, key: string): NewThreadDraft | undefined {
  try {
    const stored = sessionStorage.getItem(key);
    return stored === null ? undefined : parseDraft(JSON.parse(stored));
  } catch { return undefined; }
}

export function readNewThreadDraft(scope: string): NewThreadDraft {
  return readDraft(scope, draftKey(scope)) ?? { prompt: '', images: [] };
}

export function writeNewThreadDraft(scope: string, draft: NewThreadDraft): boolean {
  try {
    if (!draft.prompt && !draft.images.length) sessionStorage.removeItem(draftKey(scope));
    else sessionStorage.setItem(draftKey(scope), JSON.stringify(withoutPreviews(draft)));
    return true;
  } catch { return false; }
}

export function writeLaunchDraft(scope: string, id: string, draft: NewThreadDraft): boolean {
  try {
    sessionStorage.setItem(launchDraftKey(scope, id), JSON.stringify(withoutPreviews(draft)));
    return true;
  } catch { return false; }
}

export const readLaunchDraft = (scope: string, id: string) => readDraft(scope, launchDraftKey(scope, id));

export function clearLaunchDraft(scope: string, id: string) {
  try { sessionStorage.removeItem(launchDraftKey(scope, id)); } catch { /* Storage may be unavailable. */ }
  try { localStorage.removeItem(`webr-launch-draft:${id}`); } catch { /* Remove legacy unscoped data when possible. */ }
}

export function clearLaunchDrafts(scope: string) {
  const scopedPrefix = `${storagePrefix(scope)}launch:`;
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index--) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(scopedPrefix)) sessionStorage.removeItem(key);
    }
  } catch { /* Storage may be unavailable. */ }
  const legacyPrefix = 'webr-launch-draft:';
  try {
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const key = localStorage.key(index);
      if (key?.startsWith(legacyPrefix)) localStorage.removeItem(key);
    }
  } catch { /* Remove legacy unscoped data when possible. */ }
}

export function clearNewThreadDraftForLaunch(scope: string, id: string) {
  if (readNewThreadDraft(scope).launchId === id) writeNewThreadDraft(scope, { prompt: '', images: [] });
}

export const clearNewThreadDraft = (scope: string) => writeNewThreadDraft(scope, { prompt: '', images: [] });

export function recoveryStoragePrefix(scope: string) {
  return storagePrefix(scope);
}
