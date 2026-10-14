import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard } from 'lucide-react';
import { ThemeControl } from './ThemeControl';
import { RemoteAccess } from './RemoteAccess';
import { UpdateSetting } from './UpdateSetting';
import { ComposerCombobox, type ComposerOption } from './ComposerCombobox';
import { newSessionBehaviorLabels, readNewSessionBehavior, writeNewSessionBehavior, type NewSessionBehavior } from '../client/new-session-behavior';
import { defaultShortcuts, formatShortcut, isReservedShortcut, keyCombo, loadHerdrKeymap, loadShortcuts, resetShortcuts, saveShortcut, shortcutLabels, type HerdrKeymap, type ShortcutAction } from './shortcuts';

export function SettingsView({ onOpenSidebar }: {
  onOpenSidebar: () => void;
}) {
  const [behavior, setBehavior] = useState<NewSessionBehavior>('worktree');
  const [shortcuts, setShortcuts] = useState(defaultShortcuts);
  const [keymap, setKeymap] = useState<HerdrKeymap | undefined>(undefined);
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [recordingArmed, setRecordingArmed] = useState(false);
  const [error, setError] = useState('');
  const recordingFirst = useRef<string | null>(null);

  useEffect(() => {
    setBehavior(readNewSessionBehavior());
    void loadShortcuts().then((next) => setShortcuts(next));
    void loadHerdrKeymap().then((next) => { if (next) setKeymap(next); });
  }, []);

  // Every known Herdr binding becomes a dropdown option, so each Webr action
  // can reuse an already-defined Herdr shortcut (prefix included).
  const herdrOptions = useMemo<ComposerOption[]>(() => {
    if (!keymap) return [];
    const seen = new Set<string>();
    const options: ComposerOption[] = [];
    const push = (label: string, combo: string) => {
      if (!combo || seen.has(combo)) return;
      seen.add(combo);
      options.push({ value: combo, label: `${label} · ${formatShortcut(combo)}`, shortLabel: formatShortcut(combo) });
    };
    for (const [action, combos] of Object.entries(keymap.bindings)) for (const combo of combos) push(action, combo);
    for (const [action, combos] of Object.entries(keymap.stock)) for (const combo of combos) push(`${action} (default)`, combo);
    return options.sort((a, b) => a.label.localeCompare(b.label));
  }, [keymap]);

  const persist = (next: Record<ShortcutAction, string>) => {
    setShortcuts(next);
    setError('');
  };

  const choose = (action: ShortcutAction, combo: string) => {
    saveShortcut(action, combo);
    persist({ ...shortcuts, [action]: combo });
  };

  const reset = () => {
    persist(resetShortcuts());
    setRecording(null);
    recordingFirst.current = null;
    setRecordingArmed(false);
    setError('');
  };

  const startRecording = (action: ShortcutAction) => {
    recordingFirst.current = null;
    setRecordingArmed(false);
    setRecording(action);
    setError('');
  };

  const recordKey = (event: React.KeyboardEvent, action: ShortcutAction) => {
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Escape') { recordingFirst.current = null; setRecordingArmed(false); setRecording(null); setError(''); return; }
    const combo = keyCombo(event);
    if (!combo) return;
    // A Herdr prefix arms a two-step sequence instead of completing the shortcut.
    const prefixes = keymap?.prefixes.length ? keymap.prefixes : ['ctrl+b'];
    if (!recordingFirst.current && prefixes.includes(combo)) {
      recordingFirst.current = combo;
      setRecordingArmed(true);
      setError(`Prefix ${formatShortcut(combo)} armed — press the second key.`);
      return;
    }
    const full = recordingFirst.current ? `${recordingFirst.current} ${combo}` : combo;
    recordingFirst.current = null;
    setRecordingArmed(false);
    if (isReservedShortcut(full) || full === 'meta+k') { setError('Choose a shortcut with a modifier that does not conflict with the browser or ⌘K.'); return; }
    if (Object.entries(shortcuts).some(([name, key]) => name !== action && key === full)) { setError('That shortcut is already in use.'); return; }
    choose(action, full);
    setRecording(null);
  };

  const optionsFor = (current: string): ComposerOption[] =>
    herdrOptions.some((option) => option.value === current)
      ? herdrOptions
      : [...herdrOptions, { value: current, label: `Custom · ${formatShortcut(current)}`, shortLabel: formatShortcut(current) }];

  return <main className="form-page settings-page">
    <button className="mobile-menu" onClick={onOpenSidebar}>Threads</button>
    <h1>Settings</h1>
    <UpdateSetting />
    <section><h2>Appearance</h2><div className="settings-row"><span>Theme</span><ThemeControl expanded /></div></section>
    <section><h2>New threads</h2><div className="settings-row"><span>New session behavior</span><div className="theme-control theme-control--labels" role="group" aria-label="New session behavior">{(Object.keys(newSessionBehaviorLabels) as NewSessionBehavior[]).map((choice) => <button key={choice} type="button" aria-pressed={behavior === choice} className={behavior === choice ? 'theme-option is-selected' : 'theme-option'} onClick={() => { setBehavior(choice); writeNewSessionBehavior(choice); }}>{newSessionBehaviorLabels[choice]}</button>)}</div></div></section>
    <RemoteAccess />
    <section id="shortcuts"><div className="settings-section-title"><h2>Keyboard shortcuts</h2><button onClick={reset}>Reset</button></div>
      <p className="settings-note">Defaults mirror your Herdr keybindings{keymap ? ` (${formatShortcut(keymap.prefix)} prefix)` : ''}. Pick a Herdr binding or record a custom override. Press ⌘K for all actions and threads.</p>
      {(Object.keys(shortcutLabels) as ShortcutAction[]).map((action) => <div className="settings-row" key={action}><span>{shortcutLabels[action]}</span>
        {recording === action
          ? <button className="shortcut-key" data-recording="true" autoFocus onClick={() => { recordingFirst.current = null; setRecordingArmed(false); setRecording(null); setError(''); }} onKeyDown={(event) => recordKey(event, action)} aria-label={`Record ${shortcutLabels[action]} shortcut`}>{recordingArmed ? 'Press second key…' : 'Press keys…'}</button>
          : <ComposerCombobox label={`${shortcutLabels[action]} shortcut`} value={shortcuts[action]} options={optionsFor(shortcuts[action])} onChange={(value) => choose(action, value)}
            action={{ label: 'Record custom shortcut…', icon: <Keyboard size={14} aria-hidden="true" />, onClick: () => startRecording(action) }} />}
      </div>)}
      {error && <p role="alert" className="form-error">{error}</p>}
    </section>
  </main>;
}
