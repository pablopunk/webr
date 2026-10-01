import { TerminalPane } from './TerminalPane';
import type { Thread } from '../lib/models';

export function ThreadView({ thread, onFocusPane, focusedPane }: {
  thread: Thread; onFocusPane: (index: number) => void; focusedPane: number;
}) {
  return <main className={`pane-layout ${thread.panes.length === 1 ? 'single-pane' : ''}`} aria-label={`${thread.title} tab`}>
    {thread.panes.map((pane, index) => <TerminalPane key={pane.id} pane={pane} active={focusedPane === index} onFocus={() => onFocusPane(index)} />)}
  </main>;
}
