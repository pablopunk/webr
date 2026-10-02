import type { PromptImage } from '../components/usePromptImages';

export type NewThreadDraft = { prompt: string; images: PromptImage[] };

const draftKey = 'webr-new-thread-draft';

const isImage = (value: unknown): value is PromptImage => !!value && typeof value === 'object'
  && ['id', 'name', 'preview', 'path'].every((field) => typeof (value as Record<string, unknown>)[field] === 'string');

export function readNewThreadDraft(): NewThreadDraft {
  try {
    const stored = JSON.parse(localStorage.getItem(draftKey) ?? '{}');
    return { prompt: typeof stored.prompt === 'string' ? stored.prompt : '', images: Array.isArray(stored.images) ? stored.images.filter(isImage) : [] };
  } catch { return { prompt: '', images: [] }; }
}

export function writeNewThreadDraft(draft: NewThreadDraft) {
  try {
    if (!draft.prompt && !draft.images.length) localStorage.removeItem(draftKey);
    else localStorage.setItem(draftKey, JSON.stringify(draft));
  } catch { /* storage full or unavailable: the draft stays in memory only */ }
}

export const clearNewThreadDraft = () => writeNewThreadDraft({ prompt: '', images: [] });
