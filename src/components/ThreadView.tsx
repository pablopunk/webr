import { useState } from 'react';
import { ArrowUpRight, Check, ChevronRight, Copy, GitBranch, LayoutGrid, Menu, PanelLeft, Share2 } from 'lucide-react';
import { type Project, type Thread, timeAgo } from '../lib/models';
import { TerminalPane } from './TerminalPane';

export function ThreadView({ thread, project, onOpenSidebar, onFocusPane, focusedPane }: {
  thread: Thread; project: Project; onOpenSidebar: () => void;
  onFocusPane: (index: number) => void; focusedPane: number;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  const status = thread.status === 'blocked' ? 'Needs your input' : thread.status === 'working'
    ? 'Agent is working' : thread.status === 'done' ? 'Ready for review' : 'Ready for input';

  return <>
    <header className="topbar">
      <div className="breadcrumbs"><button className="icon-button sidebar-mobile-trigger" onClick={onOpenSidebar} aria-label="Open sidebar"><Menu size={19} /></button><button className="icon-button sidebar-desktop-trigger" onClick={onOpenSidebar} aria-label="Toggle sidebar"><PanelLeft size={17} /></button><span className="crumb-project">{project.name}</span><ChevronRight size={14} className="crumb-divider" /><span className="crumb-current">{thread.title}</span></div>
      <div className="topbar-actions"><span className="topbar-environment"><span className="environment-dot" /> Local</span><button className="icon-button share-button" onClick={copy} aria-label={copied ? 'Link copied' : 'Copy thread link'} title={copied ? 'Link copied' : 'Copy thread link'}>{copied ? <Check size={17} /> : <Share2 size={17} />}</button></div>
    </header>
    <div className="thread-content">
      <div className="thread-heading">
        <div className="eyebrow"><span className="eyebrow-line" /> WORKSPACE <span className="eyebrow-slash">/</span> {project.name.toUpperCase()}</div>
        <div className="heading-row"><div><h1>{thread.title}</h1><div className="thread-meta"><span className={`status-dot status-${thread.status}`} /><span>{status}</span><span className="meta-bullet">·</span><span>Updated {timeAgo(thread.updatedAt)}</span></div></div><a href={`/new?project=${encodeURIComponent(project.id)}`} className="subtle-button">New thread <ArrowUpRight size={15} /></a></div>
        <div className="thread-tags"><span className="tag"><GitBranch size={14} /> {thread.branch}</span><span className="tag"><LayoutGrid size={14} /> {thread.panes.length} {thread.panes.length === 1 ? 'pane' : 'panes'}</span><span className="tag tag-muted">{thread.worktree ? 'Isolated worktree' : 'Main checkout'}</span><a className="tag tag-link" href={`/sessions/${encodeURIComponent(thread.session)}/tabs/${encodeURIComponent(thread.tabId)}`} title="Open direct tab URL"><Copy size={13} /> Tab link</a></div>
      </div>
      <div className={`pane-layout ${thread.panes.length === 1 ? 'single-pane' : ''}`}>
        {thread.panes.map((pane, index) => <TerminalPane key={pane.id} pane={pane} active={focusedPane === index} onFocus={() => onFocusPane(index)} />)}
      </div>
      <div className="thread-footnote"><span>PREVIEW MODE</span><span>Terminals respond locally for layout testing. No Herdr command is sent.</span><a href="/settings#shortcuts">Keyboard shortcuts <ChevronRight size={13} /></a></div>
    </div>
  </>;
}
