import { ArrowRight, ArrowUpRight, Layers2, Plus, Sparkles } from 'lucide-react';
import { type Project, type Thread, timeAgo } from '../lib/models';

export function HomeView({ projects, threads, onOpenSidebar }: { projects: Project[]; threads: Thread[]; onOpenSidebar: () => void }) {
  const active = threads.filter((thread) => thread.status === 'working').length;
  const attention = threads.filter((thread) => thread.needsAttention).length;
  return <>
    <header className="topbar"><div className="breadcrumbs"><button className="icon-button sidebar-mobile-trigger" onClick={onOpenSidebar} aria-label="Open sidebar"><Layers2 size={19} /></button><span className="crumb-current">Overview</span></div><div className="topbar-actions"><span className="topbar-environment"><span className="environment-dot" /> Local</span></div></header>
    <div className="home-content">
      <div className="home-intro"><div className="eyebrow"><span className="eyebrow-line" /> YOUR WORKSPACE</div><h1>Good to have you back<span className="heading-period">.</span></h1><p>All your agents, in one quiet place. Pick up where you left off.</p><a href="/new" className="primary-button"><Plus size={17} /> Start a thread <ArrowUpRight size={16} className="button-arrow" /></a></div>
      <div className="overview-stats"><div><span className="stat-number">{threads.length.toString().padStart(2, '0')}</span><span className="stat-label">Threads</span></div><div><span className="stat-number">{active.toString().padStart(2, '0')}</span><span className="stat-label"><span className="status-dot status-working" /> Working</span></div><div><span className="stat-number">{attention.toString().padStart(2, '0')}</span><span className="stat-label"><span className="status-dot status-blocked" /> Need attention</span></div></div>
      <div className="section-heading"><div><div className="eyebrow">BACK TO WORK</div><h2>Recent threads</h2></div><span className="section-caption">Your latest activity</span></div>
      <div className="recent-grid">{threads.slice(0, 4).map((thread) => {
        const project = projects.find((item) => item.id === thread.projectId);
        return <a className="recent-card" href={`/threads/${encodeURIComponent(thread.id)}`} key={thread.id}>
          <span className="recent-card-top"><span className="project-icon" style={{ '--project-color': project?.color } as React.CSSProperties}>{project?.initial}</span><span className="recent-project">{project?.name}</span><ArrowUpRight size={17} className="recent-arrow" /></span>
          <span className="recent-card-title">{thread.title}</span><span className="recent-card-bottom"><span className={`status-dot status-${thread.status}`} />{thread.status === 'blocked' ? 'Needs input' : thread.status === 'done' ? 'Done' : thread.status === 'working' ? 'Working' : 'Ready'}<span className="meta-bullet">·</span>{timeAgo(thread.updatedAt)}</span>
        </a>;
      })}</div>
      <div className="section-heading projects-heading"><div><div className="eyebrow">YOUR SPACES</div><h2>Projects</h2></div><span className="section-caption">{projects.length} connected</span></div>
      <div className="home-projects">{projects.map((project) => <div className="home-project" key={project.id}><span className="project-icon" style={{ '--project-color': project.color } as React.CSSProperties}>{project.initial}</span><div><strong>{project.name}</strong><span>{project.path}</span></div><span className="home-project-count">{threads.filter((thread) => thread.projectId === project.id).length} threads</span><a href={`/new?project=${encodeURIComponent(project.id)}`} aria-label={`New thread in ${project.name}`} title="New thread"><Plus size={17} /></a></div>)}</div>
      <div className="home-endnote"><Sparkles size={14} /> The best work starts with a small step. <a href="/new">Make one <ArrowRight size={13} /></a></div>
    </div>
  </>;
}
