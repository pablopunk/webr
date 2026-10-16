import { trace } from './trace';

/** Herdr sends focus-in/out to the agent for the pane it has focused, so the agent's cursor only shows once Herdr's focus follows the pane shown here. */
export function followNativeFocus(machineId: string, threadId: string, paneId: string) {
  return fetch(`/api/threads/${encodeURIComponent(threadId)}/focus`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ machineId, paneId }) })
    .then((response) => { trace('native.focus', { threadId, paneId, ok: response.ok, status: response.status }); return response.ok; })
    .catch((error: unknown) => { trace('native.focus', { threadId, paneId, ok: false, error: error instanceof Error ? error.message : String(error) }); return false; });
}
