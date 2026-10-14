import { shortcutSequence } from './shortcuts';

export function ShortcutChips({ combo }: { combo: string }) {
  return <span className="kbd-chips" aria-hidden="true">
    {shortcutSequence(combo).map((chord, index) => <span key={index} style={{ display: 'contents' }}>
      {index > 0 && <span className="composer-select-keys-sep">›</span>}
      {chord.map((key, keyIndex) => <kbd key={keyIndex}>{key}</kbd>)}
    </span>)}
  </span>;
}
