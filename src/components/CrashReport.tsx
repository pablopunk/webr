import { Component, useEffect, useState, type ReactNode } from 'react';

const describe = (error: unknown) => error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error);

function Report({ text }: { text: string }) {
  return <pre role="alert" className="crash-report">{text}</pre>;
}

class Boundary extends Component<{ children: ReactNode }, { error?: unknown }> {
  state: { error?: unknown } = {};
  static getDerivedStateFromError(error: unknown) { return { error }; }
  render() { return this.state.error ? <Report text={describe(this.state.error)} /> : this.props.children; }
}

function DevCrashReport({ children }: { children: ReactNode }) {
  const [uncaught, setUncaught] = useState('');
  useEffect(() => {
    const onError = (event: ErrorEvent) => setUncaught(describe(event.error ?? event.message));
    const onRejection = (event: PromiseRejectionEvent) => setUncaught(describe(event.reason));
    window.addEventListener('error', onError); window.addEventListener('unhandledrejection', onRejection);
    return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection); };
  }, []);
  return <><Boundary>{children}</Boundary>{uncaught && <Report text={uncaught} />}</>;
}

export const CrashReport = ({ children }: { children: ReactNode }) => import.meta.env.DEV ? <DevCrashReport>{children}</DevCrashReport> : <>{children}</>;
