export type Status = 'working' | 'blocked' | 'idle' | 'done';
export type Block =
  | { kind: 'user'; text: string }
  | { kind: 'say'; text: string }
  | { kind: 'tool'; name: string; args: string; result?: string[] }
  | { kind: 'diff'; lines: string[] }
  | { kind: 'note'; text: string };
export type DemoProject = { id: string; name: string; branch: string; glyph: 'sun' | 'waves' | 'grid'; colors: [string, string] };
export type DemoThread = { id: string; project: string; title: string; agent: string; status: Status; minutesAgo: number; linkedWorktree: boolean; model: string; context: number; transcript: Block[]; ask?: { question: string; options: string[] } };

export const demoProjects: DemoProject[] = [
  { id: 'lumen', name: 'lumen', branch: 'main', glyph: 'sun', colors: ['#fbbf24', '#f43f5e'] },
  { id: 'harbor', name: 'harbor', branch: 'main', glyph: 'waves', colors: ['#22d3ee', '#4f46e5'] },
  { id: 'pixelforge', name: 'pixelforge', branch: 'main', glyph: 'grid', colors: ['#a3e635', '#0d9488'] },
];

const darkMode: Block[] = [
  { kind: 'user', text: 'add a dark mode toggle to the settings page. remember the choice and follow the system setting by default' },
  { kind: 'say', text: "I'll start by checking how theming works today." },
  { kind: 'tool', name: 'Read', args: 'src/styles/tokens.css', result: ['Read 84 lines'] },
  { kind: 'tool', name: 'Search', args: 'pattern: "prefers-color-scheme", path: "src"', result: ['Found 3 files'] },
  { kind: 'say', text: 'The colors are already CSS variables, so this is mostly wiring. I will add a `ThemeControl` component and a small hook that stores the choice.' },
  { kind: 'tool', name: 'Write', args: 'src/components/ThemeControl.tsx', result: ['Wrote 42 lines to src/components/ThemeControl.tsx'] },
  { kind: 'tool', name: 'Update', args: 'src/pages/settings.tsx', result: ['Updated src/pages/settings.tsx with 9 additions and 1 removal'] },
  { kind: 'diff', lines: [' export function Settings() {', '-  return <Appearance />;', '+  return <Appearance>', '+    <ThemeControl />', '+  </Appearance>;', ' }'] },
  { kind: 'tool', name: 'Bash', args: 'pnpm test theme', result: ['✓ 6 passed (1.2s)'] },
  { kind: 'say', text: 'Done. The toggle sits under Settings → Appearance with System, Light and Dark. It follows your system theme until you pick one, then `localStorage` remembers it.' },
  { kind: 'note', text: 'Worked for 38s · done 12:53 PM' },
];

const tooltip: Block[] = [
  { kind: 'user', text: 'the chart tooltip jumps to the wrong spot on Safari when the page is scrolled' },
  { kind: 'say', text: 'That smells like a `getBoundingClientRect` mismatch. Checking the tooltip positioning.' },
  { kind: 'tool', name: 'Read', args: 'src/charts/Tooltip.tsx', result: ['Read 118 lines'] },
  { kind: 'say', text: 'The tooltip mixes page and viewport coordinates. I want to fix it with `position: fixed` and run the chart tests.' },
  { kind: 'note', text: 'Waiting for permission' },
];

const slowLoad: Block[] = [
  { kind: 'user', text: 'why is the dashboard slow on first load?' },
  { kind: 'tool', name: 'Bash', args: 'pnpm build --analyze', result: ['dashboard chunk: 1.4 MB (412 kB gzip)'] },
  { kind: 'say', text: 'Two things: `moment` is bundled in full, and the map library loads before anything is visible. Lazy-loading the map and swapping to `date-fns` saves about 640 kB.' },
  { kind: 'note', text: 'Worked for 21s · done 12:49 PM' },
];

const cursorPagination: Block[] = [
  { kind: 'user', text: 'move the invoices endpoint to cursor pagination' },
  { kind: 'tool', name: 'Update', args: 'src/routes/invoices.ts', result: ['Updated src/routes/invoices.ts with 24 additions and 11 removals'] },
  { kind: 'say', text: 'Cursors are opaque base64 of `(createdAt, id)`. Running the integration tests next.' },
];

const rateLimit: Block[] = [
  { kind: 'user', text: 'rate limit the webhook sender, 50 per minute per endpoint' },
  { kind: 'tool', name: 'Write', args: 'src/webhooks/limiter.ts', result: ['Wrote 36 lines to src/webhooks/limiter.ts'] },
  { kind: 'say', text: 'A token bucket per endpoint, refilled every second. Failed deliveries back off exponentially.' },
  { kind: 'note', text: 'Worked for 54s · done 11:32 AM' },
];

const onboarding: Block[] = [
  { kind: 'user', text: 'redesign the onboarding carousel with the new illustrations' },
  { kind: 'tool', name: 'Update', args: 'Sources/Onboarding/CarouselView.swift', result: ['Updated with 61 additions and 28 removals'] },
  { kind: 'say', text: 'Pages now use a paged `TabView` with a parallax offset on the artwork.' },
  { kind: 'note', text: 'Worked for 1m 12s · done 10:05 AM' },
];

const rotation: Block[] = [
  { kind: 'user', text: 'the app crashes when I rotate an iPad in the gallery' },
  { kind: 'say', text: 'The layout cache keeps a stale `UICollectionViewLayout` across rotations. Invalidating it in `viewWillTransition` fixes the crash.' },
  { kind: 'note', text: 'Worked for 33s · done 7:41 AM' },
];

export const demoThreads: DemoThread[] = [
  { id: 'dark-mode', project: 'lumen', title: 'Add dark mode to the settings page', agent: 'claude', status: 'done', minutesAgo: 0, linkedWorktree: false, model: 'Sonnet 5.5', context: 14, transcript: darkMode },
  { id: 'tooltip', project: 'lumen', title: 'Fix the chart tooltip jumping on Safari', agent: 'claude', status: 'blocked', minutesAgo: 3, linkedWorktree: false, model: 'Sonnet 5.5', context: 31, transcript: tooltip, ask: { question: 'Do you want to proceed?', options: ['Yes', 'Yes, and don’t ask again this session', 'No, and tell Claude what to do differently'] } },
  { id: 'slow-load', project: 'lumen', title: 'Why is the dashboard slow on first load?', agent: 'codex', status: 'idle', minutesAgo: 4, linkedWorktree: false, model: 'gpt-5.5', context: 9, transcript: slowLoad },
  { id: 'cursor', project: 'harbor', title: 'cursor-pagination-for-invoices', agent: 'claude', status: 'working', minutesAgo: 60, linkedWorktree: true, model: 'Sonnet 5.5', context: 42, transcript: cursorPagination },
  { id: 'rate-limit', project: 'harbor', title: 'rate-limit-webhook-sender', agent: 'opencode', status: 'idle', minutesAgo: 62, linkedWorktree: true, model: 'Sonnet 5.5', context: 18, transcript: rateLimit },
  { id: 'onboarding', project: 'pixelforge', title: 'Redesign the onboarding carousel', agent: 'claude', status: 'idle', minutesAgo: 120, linkedWorktree: false, model: 'Opus 5.5', context: 27, transcript: onboarding },
  { id: 'rotation', project: 'pixelforge', title: 'Crash when rotating on iPad', agent: 'pi', status: 'idle', minutesAgo: 300, linkedWorktree: false, model: 'Sonnet 5.5', context: 12, transcript: rotation },
];

export const featuredThread = demoThreads[0];
export const terminalIdOf = (thread: DemoThread) => `term_${thread.id}`;
export const threadOfTerminal = (terminalId: string) => demoThreads.find((thread) => terminalIdOf(thread) === terminalId);
