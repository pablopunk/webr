import { useState } from 'react';
import { BotAvatar } from 'bot-avatars';
import { CircleCheck, CircleHelp, LoaderCircle, MessageCircleQuestion, PanelLeftClose, PanelLeftOpen, Plus, Settings2, X } from 'lucide-react';
import { type Project, type Thread, harnessName, relativeTime } from '../lib/models';
import { avatarForThread } from '../lib/avatars';
import { ProjectIcon } from './ProjectIcon';

export type SidebarMode = 'projects' | 'threads';

type Props = {
  projects: Project[];
  threads: Thread[];
  currentId?: string;
  mode: SidebarMode;
  collapsed: boolean;
  mobileOpen: boolean;
  onCollapse: () => void;
  onCloseMobile: () => void;
};

const statusLabel: Record<Thread['status'], string> = {
  working: 'Working', blocked: 'Needs input', done: 'Done', idle: 'Idle', unknown: 'Unknown',
};
const statusIcons: Record<Exclude<Thread['status'], 'idle'>, typeof CircleHelp> = {
  working: LoaderCircle, blocked: MessageCircleQuestion, done: CircleCheck, unknown: CircleHelp,
};

export function Sidebar({ projects, threads, currentId, mode, collapsed, mobileOpen, onCollapse, onCloseMobile }: Props) {
  const [closedProjects, setClosedProjects] = useState<string[]>([]);
  const currentProjectId = threads.find((thread) => thread.id === currentId)?.projectId;
  const threadLink = (thread: Thread, showProject: boolean) => {
    const project = projects.find((item) => item.id === thread.projectId);
    const StatusIcon = thread.status === 'idle' ? null : statusIcons[thread.status];
    return <a key={thread.id} className={`thread-row ${currentId === thread.id ? 'is-current' : ''}`} href={`/threads/${encodeURIComponent(thread.id)}`} aria-current={currentId === thread.id ? 'page' : undefined} aria-label={`${thread.title} · ${project?.name ?? ''} · ${statusLabel[thread.status]}`} title={`${thread.title} · ${project?.name ?? ''} · ${harnessName(thread.agent)} · ${thread.model} · ${statusLabel[thread.status]}`}>
      <span className="thread-avatar" aria-hidden="true"><BotAvatar {...avatarForThread(thread)} state={thread.status === 'working' ? 'working' : 'default'} size={24} paused={thread.status !== 'working'} /></span>
      <span className="thread-copy"><span className="thread-context">{showProject && project && <ProjectIcon project={project} />}{showProject ? project?.name : harnessName(thread.agent)}</span><span className="thread-name">{thread.title}</span></span>
      <span className="thread-time">{relativeTime(thread.updatedAt)}</span>
      {StatusIcon && <StatusIcon className={`thread-status status-${thread.status}`} size={15} strokeWidth={1.8} aria-hidden="true" />}
    </a>;
  };

  return <>
    {mobileOpen && <button className="sidebar-scrim" aria-label="Close sidebar" onClick={onCloseMobile} />}
    <aside className={`sidebar ${collapsed ? 'is-collapsed' : ''} ${mobileOpen ? 'is-mobile-open' : ''}`} aria-label="Threads">
      <div className="sidebar-header">
        {!collapsed && <span className="brand">herdr</span>}
        <button className="icon-button sidebar-collapse" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={onCollapse}>{collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</button>
        <button className="icon-button mobile-close" aria-label="Close sidebar" onClick={onCloseMobile}><X size={16} /></button>
      </div>
      <a className="sidebar-new-thread" href={`/new${currentProjectId ? `?project=${encodeURIComponent(currentProjectId)}` : ''}`} aria-label="New thread" title="New thread">
        <Plus size={16} aria-hidden="true" />{!collapsed && <span>New thread</span>}
      </a>
      {!collapsed && <>
        <nav className="thread-navigation" aria-label="Agent threads">
          {mode === 'projects' ? projects.filter((project) => threads.some((thread) => thread.projectId === project.id)).sort((a, b) => (threads.find((thread) => thread.projectId === b.id)?.updatedAt ?? '').localeCompare(threads.find((thread) => thread.projectId === a.id)?.updatedAt ?? '')).map((project) => <section key={project.id} className="thread-group">
            <button className="group-title" onClick={() => setClosedProjects((value) => value.includes(project.id) ? value.filter((id) => id !== project.id) : [...value, project.id])} aria-expanded={!closedProjects.includes(project.id)}>
              <span className="group-chevron">{closedProjects.includes(project.id) ? '›' : '⌄'}</span><ProjectIcon project={project} />{project.name}
            </button>
            {!closedProjects.includes(project.id) && threads.filter((thread) => thread.projectId === project.id).map((thread) => threadLink(thread, false))}
          </section>) : threads.map((thread) => threadLink(thread, true))}
          {!threads.length && <p className="sidebar-empty">No threads yet. Press ⌘K to start one.</p>}
        </nav>
        <a className="sidebar-settings" href="/settings"><Settings2 size={15} /> Settings</a>
      </>}
    </aside>
  </>;
}
