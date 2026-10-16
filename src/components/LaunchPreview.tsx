import { useEffect, useState } from 'react';
import { LaunchLoadingOrb } from './LaunchProgress';

const steps = ['validate', 'checkout', 'start', 'prompt'] as const;

export function LaunchPreview() {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setIndex((value) => (value + 1) % steps.length), 1400);
    return () => clearInterval(timer);
  }, []);
  return <main className="pending-operation is-loading" aria-label="Launch preview">
    <LaunchLoadingOrb step={steps[index]!} worktree />
  </main>;
}
