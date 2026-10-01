import { useEffect, useState } from 'react';
import { ThemeControl } from './ThemeControl';
import { defaultShortcuts, getShortcuts, isReservedShortcut, keyCombo, shortcutKeys, shortcutLabels, type ShortcutAction } from './shortcuts';
import type { SidebarMode } from './Sidebar';

export function SettingsView({ onOpenSidebar, mode, onModeChange }: {
  onOpenSidebar: () => void; mode: SidebarMode; onModeChange: (mode: SidebarMode) => void;
}) {
  const [worktree, setWorktree] = useState(true);
  const [shortcuts, setShortcuts] = useState(defaultShortcuts);
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setWorktree(localStorage.getItem('herdr-new-worktree') !== 'false');
    setShortcuts(getShortcuts());
  }, []);

  const recordKey = (event: React.KeyboardEvent, action: ShortcutAction) => {
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Escape') { setRecording(null); setError(''); return; }
    const combo = keyCombo(event);
    if (!combo) return;
    if (isReservedShortcut(combo) || combo === 'meta+k') { setError('Choose a shortcut with a modifier that does not conflict with the browser or ⌘K.'); return; }
    if (Object.entries(shortcuts).some(([name, key]) => name !== action && key === combo)) { setError('That shortcut is already in use.'); return; }
    const next = { ...shortcuts, [action]: combo };
    setShortcuts(next);
    localStorage.setItem('herdr-shortcuts', JSON.stringify(next));
    setRecording(null); setError('');
  };

  return <main className="form-page settings-page">
    <button className="mobile-menu" onClick={onOpenSidebar}>Threads</button>
    <h1>Settings</h1>
    <button onClick={async () => { await fetch('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); window.location.href = '/login'; }}>Sign out</button>
    <section><h2>Sidebar</h2><div className="settings-row"><span>Thread layout</span><div className="segmented" role="group" aria-label="Sidebar layout"><button aria-pressed={mode === 'threads'} onClick={() => onModeChange('threads')}>Threads</button><button aria-pressed={mode === 'projects'} onClick={() => onModeChange('projects')}>Projects</button></div></div></section>
    <section><h2>Appearance</h2><div className="settings-row"><span>Theme</span><ThemeControl expanded /></div></section>
    <section><h2>New threads</h2><label className="settings-row"><span>Create a new worktree by default</span><input type="checkbox" checked={worktree} onChange={(event) => { setWorktree(event.target.checked); localStorage.setItem('herdr-new-worktree', String(event.target.checked)); }} /></label></section>
    <section id="shortcuts"><div className="settings-section-title"><h2>Keyboard shortcuts</h2><button onClick={() => { setShortcuts(defaultShortcuts); localStorage.removeItem('herdr-shortcuts'); setRecording(null); setError(''); }}>Reset</button></div>
      <p className="settings-note">Press ⌘K for all actions and threads.</p>
      {(Object.keys(shortcutLabels) as ShortcutAction[]).map((action) => <div className="settings-row" key={action}><span>{shortcutLabels[action]}</span><button className="shortcut-key" data-recording={recording === action} onClick={() => { setRecording(action); setError(''); }} onKeyDown={(event) => recording === action && recordKey(event, action)} aria-label={`Change ${shortcutLabels[action]} shortcut`}>{recording === action ? 'Press keys…' : shortcutKeys(shortcuts[action]).map((key, index) => <kbd key={index}>{key}</kbd>)}</button></div>)}
      {error && <p role="alert" className="form-error">{error}</p>}
    </section>
  </main>;
}
