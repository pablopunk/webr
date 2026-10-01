import { useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

export type ThemePreference = 'system' | 'light' | 'dark';

function applyTheme(preference: ThemePreference) {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = preference === 'system'
    ? (dark ? 'dark' : 'light') : preference;
}

export function ThemeControl({ expanded = false }: { expanded?: boolean }) {
  const [preference, setPreference] = useState<ThemePreference>('system');

  useEffect(() => {
    const saved = localStorage.getItem('herdr-theme');
    const initial = saved === 'light' || saved === 'dark' ? saved : 'system';
    setPreference(initial);
    applyTheme(initial);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme((localStorage.getItem('herdr-theme') as ThemePreference) || 'system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const select = (value: ThemePreference) => {
    setPreference(value);
    localStorage.setItem('herdr-theme', value);
    applyTheme(value);
  };

  return (
    <div className={expanded ? 'theme-control theme-control--expanded' : 'theme-control'} role="group" aria-label="Color theme">
      {([['system', Monitor], ['light', Sun], ['dark', Moon]] as const).map(([value, Icon]) => (
        <button key={value} type="button" aria-label={`${value} theme`} aria-pressed={preference === value}
          className={preference === value ? 'theme-option is-selected' : 'theme-option'}
          onClick={() => select(value)} title={`${value[0].toUpperCase()}${value.slice(1)} theme`}>
          <Icon size={15} strokeWidth={1.8} />{expanded && <span>{value}</span>}
        </button>
      ))}
    </div>
  );
}
