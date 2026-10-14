import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard } from 'lucide-react';
import { ThemeControl } from './ThemeControl';
import { RemoteAccess } from './RemoteAccess';
import { UpdateSetting } from './UpdateSetting';
import { ComposerCombobox, type ComposerOption } from './ComposerCombobox';
import { newSessionBehaviorLabels, readNewSessionBehavior, writeNewSessionBehavior, type NewSessionBehavior } from '../client/new-session-behavior';
import { defaultShortcuts, FALLBACK_PREFIX, formatShortcut, getEffectivePrefix, herdrActionLabel, isReservedShortcut, keyCombo, keymapWithPrefix, loadHerdrKeymap, loadShortcuts, pruneOfferedOverrides, resetShortcuts, saveShortcut, setPrefixOverride, shortcutLabels, shortcutSequence, type HerdrKeymap, type ShortcutAction } from './shortcuts';

function ShortcutChips({ combo }: { combo: string }) {
  return <span className="kbd-chips" aria-hidden="true">
    {shortcutSequence(combo).map((chord, index) => <span key={index} style={{ display: 'contents' }}>
      {index > 0 && <span className="composer-select-keys-sep">›</span>}
      {chord.map((key, keyIndex) => <kbd key={keyIndex}>{key}</kbd>)}
    </span>)}
  </span>;
}

export function SettingsView({ onOpenSidebar }: {
  onOpenSidebar: () => void;
}) {
  const [behavior, setBehavior] = useState<NewSessionBehavior>('worktree');
  const [shortcuts, setShortcuts] = useState(defaultShortcuts);
  const [keymap, setKeymap] = useState<HerdrKeymap | undefined>(undefined);
  const [prefix, setPrefix] = useState(getEffectivePrefix);
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  const [recordingArmed, setRecordingArmed] = useState(false);
  const [recordingPrefix, setRecordingPrefix] = useState(false);
  const [error, setError] = useState('');
  const recordingFirst = useRef<string | null>(null);

  useEffect(() => {
    setBehavior(readNewSessionBehavior());
    void loadShortcuts().then((next) => { setShortcuts(next); setPrefix(getEffectivePrefix()); });
    void loadHerdrKeymap().then((next) => { if (next) setKeymap(next); });
  }, []);

  const shownKeymap = useMemo(() => keymap ? keymapWithPrefix(keymap, prefix) : undefined, [keymap, prefix]);

  // Every known Herdr binding becomes a dropdown option, so each Webr action
  // can reuse an already-defined Herdr shortcut (prefix included).
  const herdrOptions = useMemo<ComposerOption[]>(() => {
    if (!shownKeymap) return [];
    const seen = new Set<string>();
    const options: ComposerOption[] = [];
    const push = (label: string, combo: string) => {
      if (!combo || seen.has(combo)) return;
      seen.add(combo);
      options.push({ value: combo, label: herdrActionLabel(label), shortLabel: formatShortcut(combo), detail: <ShortcutChips combo={combo} />, searchText: `${label} ${combo} ${formatShortcut(combo)}` });
    };
    for (const [action, combos] of Object.entries(shownKeymap.bindings)) for (const combo of combos) push(action, combo);
    for (const [action, combos] of Object.entries(shownKeymap.stock)) for (const combo of combos) push(`${action} (default)`, combo);
    return options.sort((a, b) => a.label.localeCompare(b.label));
  }, [shownKeymap]);

  const prefixOptions = useMemo<ComposerOption[]>(() => {
    const options: ComposerOption[] = [];
    const seen = new Set<string>();
    const push = (value: string, label: string) => {
      if (!value || seen.has(value)) return;
      seen.add(value);
      options.push({ value, label, shortLabel: formatShortcut(value), detail: <ShortcutChips combo={value} />, searchText: `${label} ${value}` });
    };
    for (const candidate of keymap?.prefixes ?? []) push(candidate, 'Herdr');
    push(FALLBACK_PREFIX, 'Stock default');
    return options;
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
    setPrefix(getEffectivePrefix());
    setRecording(null);
    setRecordingPrefix(false);
    recordingFirst.current = null;
    setRecordingArmed(false);
    setError('');
  };

  const changePrefix = (next: string) => {
    const offered = shownKeymap
      ? [...Object.values(shownKeymap.bindings).flatMap((combos) => combos), ...Object.values(shownKeymap.stock).flatMap((combos) => combos)]
      : [];
    pruneOfferedOverrides(offered);
    setPrefixOverride(next === keymap?.prefix ? undefined : next);
    setPrefix(next);
    setError('');
    void loadShortcuts().then((loaded) => setShortcuts(loaded));
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
    // The leader prefix arms a two-step sequence instead of completing the shortcut.
    if (!recordingFirst.current && combo === prefix) {
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

  const recordPrefixKey = (event: React.KeyboardEvent) => {
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Escape') { setRecordingPrefix(false); setError(''); return; }
    const combo = keyCombo(event);
    if (!combo) return;
    if (!/(ctrl|alt|meta)\+/.test(combo) || isReservedShortcut(combo)) { setError('Pick a modified key like Ctrl+Space that does not conflict with the browser.'); return; }
    setRecordingPrefix(false);
    changePrefix(combo);
  };

  const withCustom = (options: ComposerOption[], current: string): ComposerOption[] =>
    options.some((option) => option.value === current)
      ? options
      : [...options, { value: current, label: 'Custom', shortLabel: formatShortcut(current), detail: <ShortcutChips combo={current} /> }];

  return <main className="form-page settings-page">
    <button className="mobile-menu" onClick={onOpenSidebar}>Threads</button>
    <h1>Settings</h1>
    <UpdateSetting />
    <section><h2>Appearance</h2><div className="settings-row"><span>Theme</span><ThemeControl expanded /></div></section>
    <section><h2>New threads</h2><div className="settings-row"><span>New session behavior</span><div className="theme-control theme-control--labels" role="group" aria-label="New session behavior">{(Object.keys(newSessionBehaviorLabels) as NewSessionBehavior[]).map((choice) => <button key={choice} type="button" aria-pressed={behavior === choice} className={behavior === choice ? 'theme-option is-selected' : 'theme-option'} onClick={() => { setBehavior(choice); writeNewSessionBehavior(choice); }}>{newSessionBehaviorLabels[choice]}</button>)}</div></div></section>
    <RemoteAccess />
    <section id="shortcuts"><div className="settings-section-title"><h2>Keyboard shortcuts</h2><button onClick={reset}>Reset</button></div>
      <p className="settings-note">Defaults mirror your Herdr keybindings ({formatShortcut(prefix)} prefix). Pick a Herdr binding or record a custom override. Press ⌘K for all actions and threads.</p>
      <div className="settings-row" key="prefix"><span>Prefix</span>
        {recordingPrefix
          ? <button className="shortcut-key" data-recording="true" autoFocus onClick={() => { setRecordingPrefix(false); setError(''); }} onKeyDown={recordPrefixKey} aria-label="Record leader prefix">Press keys…</button>
          : <ComposerCombobox label="Leader prefix" value={prefix} options={withCustom(prefixOptions, prefix)} onChange={changePrefix}
            action={{ label: 'Record custom prefix…', icon: <Keyboard size={14} aria-hidden="true" />, onClick: () => { setRecordingPrefix(true); setError(''); } }} />}
      </div>
      {(Object.keys(shortcutLabels) as ShortcutAction[]).map((action) => <div className="settings-row" key={action}><span>{shortcutLabels[action]}</span>
        {recording === action
          ? <button className="shortcut-key" data-recording="true" autoFocus onClick={() => { recordingFirst.current = null; setRecordingArmed(false); setRecording(null); setError(''); }} onKeyDown={(event) => recordKey(event, action)} aria-label={`Record ${shortcutLabels[action]} shortcut`}>{recordingArmed ? 'Press second key…' : 'Press keys…'}</button>
          : <ComposerCombobox label={`${shortcutLabels[action]} shortcut`} value={shortcuts[action]} options={withCustom(herdrOptions, shortcuts[action])} onChange={(value) => choose(action, value)}
            action={{ label: 'Record custom shortcut…', icon: <Keyboard size={14} aria-hidden="true" />, onClick: () => startRecording(action) }} />}
      </div>)}
      {error && <p role="alert" className="form-error">{error}</p>}
    </section>
  </main>;
}
