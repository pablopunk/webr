import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react';
import { terminalKeyBytes } from './TerminalInput';

const keys = [
  { label: 'Tab', key: 'Tab' },
  { label: <ArrowLeft size={16} />, key: 'ArrowLeft', name: 'Left' },
  { label: <ArrowDown size={16} />, key: 'ArrowDown', name: 'Down' },
  { label: <ArrowUp size={16} />, key: 'ArrowUp', name: 'Up' },
  { label: <ArrowRight size={16} />, key: 'ArrowRight', name: 'Right' },
];

const keepKeyboardOpen = (event: React.SyntheticEvent) => event.preventDefault();
const pressOnTouchDown = (action: () => void) => ({
  onPointerDown: (event: React.PointerEvent) => { keepKeyboardOpen(event); action(); },
  onMouseDown: keepKeyboardOpen,
  onTouchStart: keepKeyboardOpen,
  onClick: (event: React.MouseEvent) => { if (event.detail === 0) action(); },
});

export function TerminalKeyBar({ ctrl, onToggleCtrl, onBytes }: { ctrl: boolean; onToggleCtrl: () => void; onBytes: (bytes: string) => void }) {
  return <div className="terminal-key-bar" role="toolbar" aria-label="Terminal keys">
    <button type="button" tabIndex={-1} aria-pressed={ctrl} className={ctrl ? 'is-armed' : ''} {...pressOnTouchDown(onToggleCtrl)}>Ctrl</button>
    {keys.map(({ label, key, name }) => <button key={key} type="button" tabIndex={-1} aria-label={name ?? key} {...pressOnTouchDown(() => { const bytes = terminalKeyBytes({ key, ctrlKey: false, altKey: false }); if (bytes) onBytes(bytes); })}>{label}</button>)}
  </div>;
}
