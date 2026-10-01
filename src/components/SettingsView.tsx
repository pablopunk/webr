import { useEffect, useState } from 'react';
import { ArrowLeft, Check, GitBranch, Keyboard, Layers2, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { ThemeControl } from './ThemeControl';
import { defaultShortcuts, getShortcuts, isReservedShortcut, keyCombo, shortcutLabels, type ShortcutAction } from './shortcuts';

export function SettingsView({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  const [worktree, setWorktree] = useState(true);
  const [shortcuts, setShortcuts] = useState(defaultShortcuts);
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setWorktree(localStorage.getItem('herdr-new-worktree') !== 'false');
    setShortcuts(getShortcuts());
  }, []);

  const changeWorktree = (value: boolean) => {
    setWorktree(value);
    localStorage.setItem('herdr-new-worktree', String(value));
  };

  const recordKey = (event: React.KeyboardEvent, action: ShortcutAction) => {
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Escape') { setRecording(null); setError(''); return; }
    const combo = keyCombo(event);
    if (!combo) return;
    if (isReservedShortcut(combo)) { setError('Use a modifier and avoid browser shortcuts.'); return; }
    if (Object.entries(shortcuts).some(([name, key]) => name !== action && key === combo)) {
      setError('That shortcut is already in use.'); return;
    }
    const next = { ...shortcuts, [action]: combo };
    setShortcuts(next);
    localStorage.setItem('herdr-shortcuts', JSON.stringify(next));
    setRecording(null); setError('');
  };

  const reset = () => {
    setShortcuts(defaultShortcuts);
    localStorage.removeItem('herdr-shortcuts');
    setRecording(null); setError('');
  };

  return <>
    <header className="topbar"><div className="breadcrumbs"><button className="icon-button sidebar-mobile-trigger" onClick={onOpenSidebar} aria-label="Open sidebar"><Layers2 size={19} /></button><a href="/" className="crumb-project">Overview</a><span className="crumb-divider">/</span><span className="crumb-current">Settings</span></div></header>
    <main className="settings-page"><a href="/" className="back-link"><ArrowLeft size={15} /> Back to threads</a><div className="eyebrow"><span className="eyebrow-line" /> MAKE IT YOURS</div><h1>Settings<span className="heading-period">.</span></h1><p className="settings-subtitle">A few choices to make this space feel like yours.</p>
      <section className="settings-section"><div className="settings-section-heading"><span className="settings-heading-icon"><SlidersHorizontal size={18} /></span><div><h2>Appearance</h2><p>Choose how the interface looks on this device.</p></div></div><div className="settings-row"><span><strong>Color theme</strong><small>System follows your device preference.</small></span><ThemeControl expanded /></div></section>
      <section className="settings-section"><div className="settings-section-heading"><span className="settings-heading-icon"><GitBranch size={18} /></span><div><h2>New threads</h2><p>Set the starting point for work in a project.</p></div></div><label className="settings-row settings-toggle"><span><strong>Create a new worktree by default</strong><small>Each new thread starts on a separate branch and directory.</small></span><input type="checkbox" checked={worktree} onChange={(event) => changeWorktree(event.target.checked)} /><span className="switch-track" aria-hidden="true"><span /></span></label></section>
      <section className="settings-section" id="shortcuts"><div className="settings-section-heading"><span className="settings-heading-icon"><Keyboard size={18} /></span><div><h2>Keyboard shortcuts</h2><p>Click a shortcut, then press the keys you want to use.</p></div><button className="text-button" onClick={reset}><RotateCcw size={14} /> Reset</button></div><div className="shortcut-list">{(Object.keys(shortcutLabels) as ShortcutAction[]).map((action) => <div className="shortcut-row" key={action}><span>{shortcutLabels[action]}</span><button className={`shortcut-key ${recording === action ? 'is-recording' : ''}`} onClick={() => { setRecording(action); setError(''); }} onKeyDown={(event) => recording === action && recordKey(event, action)} aria-label={`Change ${shortcutLabels[action]} shortcut`}>{recording === action ? 'Press keys…' : shortcuts[action].replaceAll('+', ' + ')}</button></div>)}</div>{error && <p className="form-error" role="alert">{error}</p>}<p className="shortcut-note"><Check size={14} /> Shortcuts do not run while you type in a field. Browser shortcuts stay with the browser.</p></section>
      <div className="settings-endnote">Changes save automatically on this device.</div>
    </main>
  </>;
}
