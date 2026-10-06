import { useEffect, useState } from 'react';
import { ThemeControl } from './ThemeControl';
import { RemoteAccess } from './RemoteAccess';
import { UpdateSetting } from './UpdateSetting';
import { newSessionBehaviorLabels, readNewSessionBehavior, writeNewSessionBehavior, type NewSessionBehavior } from '../client/new-session-behavior';
import { defaultShortcuts, getShortcuts, isReservedShortcut, keyCombo, shortcutKeys, shortcutLabels, type ShortcutAction } from './shortcuts';

export function SettingsView({ onOpenSidebar }: {
  onOpenSidebar: () => void;
}) {
  const [behavior, setBehavior] = useState<NewSessionBehavior>('worktree');
  const [shortcuts, setShortcuts] = useState(defaultShortcuts);
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setBehavior(readNewSessionBehavior());
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
    localStorage.setItem('webr-shortcuts', JSON.stringify(next));
    setRecording(null); setError('');
  };

  return <main className="form-page settings-page">
    <button className="mobile-menu" onClick={onOpenSidebar}>Threads</button>
    <h1>Settings</h1>
    <UpdateSetting />
    <section><h2>Appearance</h2><div className="settings-row"><span>Theme</span><ThemeControl expanded /></div></section>
    <section><h2>New threads</h2><div className="settings-row"><span>New session behavior</span><div className="theme-control theme-control--labels" role="group" aria-label="New session behavior">{(Object.keys(newSessionBehaviorLabels) as NewSessionBehavior[]).map((choice) => <button key={choice} type="button" aria-pressed={behavior === choice} className={behavior === choice ? 'theme-option is-selected' : 'theme-option'} onClick={() => { setBehavior(choice); writeNewSessionBehavior(choice); }}>{newSessionBehaviorLabels[choice]}</button>)}</div></div></section>
    <RemoteAccess />
    <section id="shortcuts"><div className="settings-section-title"><h2>Keyboard shortcuts</h2><button onClick={() => { setShortcuts(defaultShortcuts); localStorage.removeItem('webr-shortcuts'); setRecording(null); setError(''); }}>Reset</button></div>
      <p className="settings-note">Press ⌘K for all actions and threads.</p>
      {(Object.keys(shortcutLabels) as ShortcutAction[]).map((action) => <div className="settings-row" key={action}><span>{shortcutLabels[action]}</span><button className="shortcut-key" data-recording={recording === action} onClick={() => { setRecording(action); setError(''); }} onKeyDown={(event) => recording === action && recordKey(event, action)} aria-label={`Change ${shortcutLabels[action]} shortcut`}>{recording === action ? 'Press keys…' : shortcutKeys(shortcuts[action]).map((key, index) => <kbd key={index}>{key}</kbd>)}</button></div>)}
      {error && <p role="alert" className="form-error">{error}</p>}
    </section>
  </main>;
}
