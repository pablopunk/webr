import { useMemo, useState } from 'react';
import { BotAvatar, type BotAvatarType } from 'bot-avatars';
import { ChevronDown, ChevronsLeft, ChevronsRight, CircleHelp, Plus, Search, Settings2, X } from 'lucide-react';
import { type Project, type Thread, relativeTime } from '../lib/models';
import { ThemeControl } from './ThemeControl';

const shapes: Record<Thread['agent'], BotAvatarType> = {
  claude: 'clover', codex: 'star', opencode: 'hexagon', pi: 'circle',
};

const statusLabels: Record<Thread['status'], string> = {
  working: 'Working', blocked: 'Needs input', done: 'Done', idle: 'Ready', unknown: 'Unknown',
};

type Props = {
  projects: Project[];
  threads: Thread[];
  currentId?: string;
  collapsed: boolean;
  mobileOpen: boolean;
  onCollapse: () => void;
  onCloseMobile: () => void;
};

export function Sidebar({ projects, threads, currentId, collapsed, mobileOpen, onCollapse, onCloseMobile }: Props) {
  const [query, setQuery] = useState('');
  const [closedProjects, setClosedProjects] = useState<string[]>([]);
  const sortedProjects = useMemo(() => [...projects].sort((a, b) => {
    const newest = (id: string) => threads.find((thread) => thread.projectId === id)?.updatedAt ?? '';
    return newest(b.id).localeCompare(newest(a.id));
  }), [projects, threads]);
  const matching = threads.filter((thread) => {
    const project = projects.find((item) => item.id === thread.projectId);
    return `${thread.title} ${project?.name ?? ''} ${thread.branch}`.toLowerCase().includes(query.toLowerCase());
  });

  return <>
    {mobileOpen && <button className="sidebar-scrim" aria-label="Close sidebar" onClick={onCloseMobile} />}
    <aside className={`sidebar ${collapsed ? 'is-collapsed' : ''} ${mobileOpen ? 'is-mobile-open' : ''}`} aria-label="Threads">
      <div className="sidebar-header">
        <a href="/" className="brand" aria-label="Herdr Web home">
          <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
          {!collapsed && <span className="brand-name">herdr<span className="brand-muted"> / web</span></span>}
        </a>
        <button className="icon-button sidebar-collapse" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={onCollapse} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <ChevronsRight size={17} /> : <ChevronsLeft size={17} />}
        </button>
        <button className="icon-button mobile-close" aria-label="Close sidebar" onClick={onCloseMobile}><X size={18} /></button>
      </div>

      {collapsed ? (
        <div className="collapsed-actions">
          <a href="/new" className="icon-button" aria-label="New thread" title="New thread"><Plus size={19} /></a>
          <a href="/settings" className="icon-button" aria-label="Settings" title="Settings"><Settings2 size={18} /></a>
        </div>
      ) : <>
        <div className="sidebar-tools">
          <a href="/new" className="new-thread-button"><Plus size={17} strokeWidth={2} /> New thread <span className="new-thread-hint">⌃⌥N</span></a>
          <label className="sidebar-search"><Search size={15} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a thread" aria-label="Find a thread" /><kbd>⌘K</kbd></label>
        </div>

        <div className="sidebar-section-label"><span>YOUR PROJECTS</span><span className="project-count">{sortedProjects.length}</span></div>
        <nav className="project-list" aria-label="Projects and threads">
          {sortedProjects.map((project) => {
            const projectThreads = matching.filter((thread) => thread.projectId === project.id);
            const isClosed = closedProjects.includes(project.id) && !query;
            if (query && !projectThreads.length) return null;
            return <section className="project-group" key={project.id}>
              <div className="project-heading">
                <button className="project-toggle" aria-expanded={!isClosed} onClick={() => setClosedProjects((prev) => prev.includes(project.id) ? prev.filter((id) => id !== project.id) : [...prev, project.id])}>
                  <span className="project-icon" style={{ '--project-color': project.color } as React.CSSProperties}>{project.initial}</span>
                  <span className="project-title">{project.name}</span>
                  <ChevronDown size={14} className={`project-chevron ${isClosed ? 'is-closed' : ''}`} />
                </button>
                <a className="project-add" href={`/new?project=${encodeURIComponent(project.id)}`} aria-label={`New thread in ${project.name}`} title={`New thread in ${project.name}`}><Plus size={15} /></a>
              </div>
              {!isClosed && <div className="thread-list">
                {projectThreads.map((thread) => <a href={`/threads/${encodeURIComponent(thread.id)}`} key={thread.id} className={`thread-row ${currentId === thread.id ? 'is-current' : ''}`} aria-current={currentId === thread.id ? 'page' : undefined}>
                  <span className="thread-avatar"><BotAvatar type={shapes[thread.agent]} state={thread.status === 'working' ? 'working' : 'default'} size={32} paused={thread.status === 'idle' || thread.status === 'unknown'} aria-hidden="true" /></span>
                  <span className="thread-copy"><span className="thread-title">{thread.title}</span><span className="thread-details"><span className={`status-dot status-${thread.status}`} />{statusLabels[thread.status]}<span className="detail-separator">·</span>{relativeTime(thread.updatedAt)}</span></span>
                  {thread.needsAttention && <span className="unread-indicator" aria-label="Needs attention" />}
                </a>)}
                {!projectThreads.length && <p className="project-empty">No threads yet</p>}
              </div>}
            </section>;
          })}
          {query && !matching.length && <p className="search-empty">No threads match “{query}”</p>}
        </nav>

        <div className="sidebar-footer">
          <div className="footer-top"><span className="connection-indicator" /> <span>Local machine</span><span className="connection-label">Demo</span></div>
          <div className="footer-bottom"><ThemeControl /><a href="/settings" className="icon-button" aria-label="Settings" title="Settings"><Settings2 size={17} /></a><a href="/settings#shortcuts" className="icon-button" aria-label="Keyboard shortcuts" title="Keyboard shortcuts"><CircleHelp size={17} /></a></div>
        </div>
      </>}
    </aside>
  </>;
}
