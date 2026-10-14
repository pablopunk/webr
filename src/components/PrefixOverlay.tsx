import { ShortcutChips } from './ShortcutChips';
import { isSequence, sequenceParts, shortcutLabels, type ShortcutAction } from './shortcuts';

// Which-key panel: while the leader prefix is armed, list every action that
// continues from it. Purely informational; any keypress resolves the pending
// prefix in the app key handler.
export function PrefixOverlay({ prefix, shortcuts }: { prefix: string; shortcuts: Record<ShortcutAction, string> }) {
  const rows = (Object.keys(shortcutLabels) as ShortcutAction[])
    .filter((action) => isSequence(shortcuts[action]) && sequenceParts(shortcuts[action])[0] === prefix)
    .map((action) => ({ action, second: sequenceParts(shortcuts[action])[1] }));
  if (!rows.length) return null;
  return <div className="prefix-overlay">
    <div className="prefix-panel" role="status" aria-label="Prefix armed">
      <div className="prefix-title"><ShortcutChips combo={prefix} /><span>then…</span></div>
      <div className="prefix-rows">
        {rows.map(({ action, second }) => <div className="prefix-row" key={action}>
          <ShortcutChips combo={second} />
          <span>{shortcutLabels[action]}</span>
        </div>)}
      </div>
      <div className="prefix-hint">prefix again sends it literally</div>
    </div>
  </div>;
}
