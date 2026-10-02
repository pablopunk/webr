import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from 'lucide-react';
import { terminalKeyBytes } from './TerminalInput';

const keys = [
  { label: 'Tab', key: 'Tab' },
  { label: <ArrowLeft size={16} />, key: 'ArrowLeft', name: 'Left' },
  { label: <ArrowDown size={16} />, key: 'ArrowDown', name: 'Down' },
  { label: <ArrowUp size={16} />, key: 'ArrowUp', name: 'Up' },
  { label: <ArrowRight size={16} />, key: 'ArrowRight', name: 'Right' },
];

const keepKeyboardOpen = (event: React.PointerEvent) => event.preventDefault();

export function TerminalKeyBar({ ctrl, onToggleCtrl, onBytes }: { ctrl: boolean; onToggleCtrl: () => void; onBytes: (bytes: string) => void }) {
  return <div className="terminal-key-bar" role="toolbar" aria-label="Terminal keys">
    <button type="button" tabIndex={-1} aria-pressed={ctrl} className={ctrl ? 'is-armed' : ''} onPointerDown={keepKeyboardOpen} onClick={onToggleCtrl}>Ctrl</button>
    {keys.map(({ label, key, name }) => <button key={key} type="button" tabIndex={-1} aria-label={name ?? key} onPointerDown={keepKeyboardOpen} onClick={() => { const bytes = terminalKeyBytes({ key, ctrlKey: false, altKey: false }); if (bytes) onBytes(bytes); }}>{label}</button>)}
  </div>;
}
