import { useState } from 'react';
import type { Projection } from '../shared/runtime';
import type { Thread } from '../lib/models';
export function AdoptTab({ thread, tabs }: { thread: Thread; tabs: NonNullable<Projection['availableTabs']> }) {
  const [tabId, setTabId] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const selected = tabs.find((tab) => tab.tabId === tabId && !tab.bound);
  return <form className="adoption-picker" onSubmit={async (event) => {
    event.preventDefault(); if (!selected || busy || !confirm(`Bind this thread to ${selected.label} (${selected.tabId}) and its ${selected.panes.length} current terminals without sending the old prompt?`)) return;
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/threads/${encodeURIComponent(thread.id)}/adopt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ machineId: thread.machineId, terminalIds: selected.panes.map((pane) => pane.terminalId) }) });
      if (!response.ok) throw new Error('The tab changed or is already bound; select it again after refresh.');
    } catch (error) { setError(error instanceof Error ? error.message : 'Adoption failed.'); }
    finally { setBusy(false); }
  }}>
    <label>Select the current native tab to adopt <select aria-label="Native tab to adopt" value={tabId} onChange={(event) => setTabId(event.target.value)}><option value="">Select a tab…</option>{tabs.map((tab) => <option key={tab.tabId} value={tab.tabId} disabled={tab.bound || !tab.panes.length}>{tab.label} · {tab.tabId}{tab.bound ? ' · Already bound' : ''}</option>)}</select></label>
    {selected && <p>{selected.panes.map((pane) => `${pane.title} (${pane.terminalId})`).join(', ')}</p>}
    <button disabled={!selected || busy}>Adopt without restarting</button>{error && <p role="alert">{error}</p>}
  </form>;
}
