import { useEffect, useState } from 'react';
import { ArrowRight, ArrowUpRight, ChevronDown, GitBranch, Layers2, Plus, TerminalSquare } from 'lucide-react';
import { BorderBeam } from 'border-beam';
import { type AgentKind, type Project } from '../lib/models';

const agentNames: Record<AgentKind, string> = {
  claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode', pi: 'Pi',
};

export function NewThreadView({ projects, selectedProjectId, onOpenSidebar }: {
  projects: Project[]; selectedProjectId?: string; onOpenSidebar: () => void;
}) {
  const [projectId, setProjectId] = useState(projects.find((project) => project.id === selectedProjectId)?.id ?? projects[0]?.id ?? '');
  const [agent, setAgent] = useState<AgentKind>('claude');
  const [worktree, setWorktree] = useState(true);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [beamTheme, setBeamTheme] = useState<'light' | 'dark'>('light');
  const project = projects.find((item) => item.id === projectId);

  useEffect(() => { setWorktree(localStorage.getItem('herdr-new-worktree') !== 'false'); }, []);
  useEffect(() => {
    const update = () => setBeamTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  const submit = async (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const result = await fetch('/api/threads', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, projectId, agent, worktree }),
      });
      const payload = await result.json();
      if (!result.ok) throw new Error(payload.error || 'Could not create thread');
      window.location.assign(`/threads/${encodeURIComponent(payload.id)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create thread');
      setBusy(false);
    }
  };

  return <>
    <header className="topbar"><div className="breadcrumbs"><button className="icon-button sidebar-mobile-trigger" onClick={onOpenSidebar} aria-label="Open sidebar"><Layers2 size={19} /></button><a href="/" className="crumb-project">Overview</a><span className="crumb-divider">/</span><span className="crumb-current">New thread</span></div><span className="topbar-environment"><span className="environment-dot" /> Local</span></header>
    <main className="new-page"><div className="new-page-inner"><div className="new-decoration"><span className="new-decoration-core"><Plus size={24} strokeWidth={1.5} /></span><span className="decoration-orbit orbit-one" /><span className="decoration-orbit orbit-two" /></div>
      <div className="eyebrow new-eyebrow">A FRESH START</div><h1>What are we working on<span className="heading-period">?</span></h1><p className="new-subtitle">Give the thread a name. Your agent gets its own space to work.</p>
      <form className="new-form" onSubmit={submit}>
        <BorderBeam size="line" colorVariant="ocean" active={busy} theme={beamTheme}>
          <div className="composer"><label htmlFor="thread-title" className="sr-only">Thread name</label><textarea id="thread-title" autoFocus rows={3} maxLength={90} placeholder="Describe what you want to build or fix…" value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} required /><div className="composer-bottom"><span>{title.length}/90</span><button className="composer-submit" type="submit" disabled={!title.trim() || busy} aria-label="Create thread">{busy ? 'Creating…' : <>Create thread <ArrowUpRight size={15} /></>}</button></div></div>
        </BorderBeam>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="new-options"><label className="option-field"><span className="option-label">PROJECT</span><span className="select-wrap"><span className="project-icon" style={{ '--project-color': project?.color } as React.CSSProperties}>{project?.initial}</span><select value={projectId} onChange={(event) => setProjectId(event.target.value)} aria-label="Project">{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={15} /></span></label>
          <label className="option-field"><span className="option-label">AGENT</span><span className="select-wrap"><TerminalSquare size={17} className="option-select-icon" /><select value={agent} onChange={(event) => setAgent(event.target.value as AgentKind)} aria-label="Agent">{(Object.keys(agentNames) as AgentKind[]).map((item) => <option key={item} value={item}>{agentNames[item]}</option>)}</select><ChevronDown size={15} /></span></label></div>
        <label className="worktree-choice"><span className="worktree-choice-icon"><GitBranch size={18} /></span><span><strong>New worktree</strong><small>Make a separate branch and work directory for this thread.</small></span><input type="checkbox" checked={worktree} onChange={(event) => setWorktree(event.target.checked)} /><span className="switch-track" aria-hidden="true"><span /></span></label>
      </form><p className="new-hint">Press <kbd>⌘</kbd> + <kbd>Enter</kbd> to create <span>·</span> Change the default in <a href="/settings">Settings <ArrowRight size={12} /></a></p>
    </div></main>
  </>;
}
