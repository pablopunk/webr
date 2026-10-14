import { Component, useEffect, useState, type ReactNode } from 'react';

const describe = (error: unknown) => error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error);

function Report({ text }: { text: string }) {
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => { setDismissed(false); }, [text]);
  if (dismissed) return null;
  return <div role="alert" className="crash-report"><pre>{text}</pre><button type="button" aria-label="Reload page" onClick={() => window.location.reload()}>Reload</button><button type="button" aria-label="Dismiss error" onClick={() => setDismissed(true)}>×</button></div>;
}

class Boundary extends Component<{ children: ReactNode }, { error?: unknown; stack?: string }> {
  state: { error?: unknown; stack?: string } = {};
  static getDerivedStateFromError(error: unknown) { return { error }; }
  componentDidCatch(_error: unknown, info: { componentStack?: string }) { this.setState({ stack: info.componentStack }); }
  render() { return this.state.error ? <Report text={`${describe(this.state.error)}${this.state.stack ?? ''}`} /> : this.props.children; }
}

function DevCrashReport({ children }: { children: ReactNode }) {
  const [uncaught, setUncaught] = useState('');
  useEffect(() => {
    const onError = (event: ErrorEvent) => setUncaught(describe(event.error ?? event.message));
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      if (reason instanceof DOMException && reason.name === 'AbortError' && reason.message.includes('Transition was skipped')) { event.preventDefault(); return; }
      setUncaught(describe(reason));
    };
    window.addEventListener('error', onError); window.addEventListener('unhandledrejection', onRejection);
    return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection); };
  }, []);
  return <><Boundary>{children}</Boundary>{uncaught && <Report text={uncaught} />}</>;
}

export const CrashReport = ({ children }: { children: ReactNode }) => import.meta.env.DEV ? <DevCrashReport>{children}</DevCrashReport> : <Boundary>{children}</Boundary>;
