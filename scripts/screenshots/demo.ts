export type Status = 'working' | 'blocked' | 'idle' | 'done';
export type Block =
  | { kind: 'user'; text: string }
  | { kind: 'say'; text: string }
  | { kind: 'tool'; name: string; args: string; result?: string[] }
  | { kind: 'diff'; lines: string[] }
  | { kind: 'note'; text: string };
export type DemoProject = { id: string; name: string; branch: string; glyph: 'sun' | 'waves' | 'grid'; colors: [string, string] };
export type ShellOutput = { command: string; lines: string[] };
export type DemoThread = { shell?: ShellOutput; id: string; project: string; title: string; agent: string; status: Status; minutesAgo: number; linkedWorktree: boolean; model: string; context: number; transcript: Block[]; ask?: { question: string; options: string[] } };

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
  { kind: 'say', text: 'Let me look at how invoices are listed and who calls the endpoint.' },
  { kind: 'tool', name: 'Search', args: 'pattern: "listInvoices", path: "src"', result: ['Found 6 files'] },
  { kind: 'tool', name: 'Read', args: 'src/routes/invoices.ts', result: ['Read 142 lines'] },
  { kind: 'tool', name: 'Read', args: 'src/db/queries.ts', result: ['Read 311 lines'] },
  { kind: 'say', text: 'Offset pagination scans and skips rows, which gets slow on large accounts. I will add a keyset cursor on `(createdAt, id)` and keep the response shape backward compatible.' },
  { kind: 'tool', name: 'Write', args: 'src/lib/cursor.ts', result: ['Wrote 38 lines to src/lib/cursor.ts'] },
  { kind: 'diff', lines: [
    '+export type Cursor = { createdAt: string; id: string };', '+',
    '+export const encodeCursor = ({ createdAt, id }: Cursor) =>', '+  Buffer.from(`${createdAt}|${id}`).toString(\'base64url\');', '+',
    '+export function decodeCursor(value: string): Cursor {', '+  const [createdAt, id] = Buffer.from(value, \'base64url\').toString().split(\'|\');',
    "+  if (!createdAt || !id) throw new BadRequest('invalid cursor');", '+  return { createdAt, id };', '+}'] },
  { kind: 'tool', name: 'Update', args: 'src/db/queries.ts', result: ['Updated src/db/queries.ts with 14 additions and 6 removals'] },
  { kind: 'diff', lines: [
    ' export async function listInvoices(db: Db, accountId: string, page: Page) {',
    '-  return db.select().from(invoices).where(eq(invoices.accountId, accountId))',
    '-    .orderBy(desc(invoices.createdAt)).limit(page.size).offset(page.offset);',
    '+  const after = page.cursor ? decodeCursor(page.cursor) : undefined;',
    '+  return db.select().from(invoices)',
    '+    .where(and(eq(invoices.accountId, accountId), after && keysetAfter(after)))',
    '+    .orderBy(desc(invoices.createdAt), desc(invoices.id)).limit(page.size + 1);', ' }'] },
  { kind: 'tool', name: 'Update', args: 'src/routes/invoices.ts', result: ['Updated src/routes/invoices.ts with 24 additions and 11 removals'] },
  { kind: 'diff', lines: [
    '-  const { page = 1, size = 50 } = request.query;', '+  const { cursor, size = 50 } = request.query;',
    '-  const rows = await listInvoices(db, account.id, { size, offset: (page - 1) * size });',
    '+  const rows = await listInvoices(db, account.id, { size, cursor });', '+  const hasMore = rows.length > size;',
    '-  return { invoices: rows };', '+  return { invoices: rows.slice(0, size), nextCursor: hasMore ? encodeCursor(rows[size - 1]) : null };'] },
  { kind: 'tool', name: 'Bash', args: 'pnpm test invoices', result: ['✓ 17 passed, × 1 failed (2.4s)', 'invoices.test.ts › lists the second page: expected 50 rows, received 0'] },
  { kind: 'say', text: 'One test still assumes `?page=2`. Updating it to follow `nextCursor` instead.' },
  { kind: 'tool', name: 'Update', args: 'tests/invoices.test.ts', result: ['Updated tests/invoices.test.ts with 6 additions and 3 removals'] },
  { kind: 'tool', name: 'Bash', args: 'pnpm test invoices', result: ['✓ 18 passed (2.1s)'] },
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

const gitStatus: ShellOutput = { command: 'git status', lines: [
  'On branch main', "Your branch is ahead of 'origin/main' by 3 commits.", '  (use "git push" to publish your local commits)', '',
  'Changes not staged for commit:', '  (use "git add <file>..." to update what will be committed)', '  (use "git restore <file>..." to discard changes in working directory)',
  '!\tmodified:   src/db/queries.ts', '!\tmodified:   src/lib/cursor.ts', '!\tmodified:   src/routes/invoices.ts', '!\tmodified:   src/routes/payments.ts', '!\tmodified:   src/routes/index.ts', '!\tmodified:   tests/invoices.test.ts', '',
  'Untracked files:', '  (use "git add <file>..." to include in what will be committed)', '?\tsrc/lib/cursor.test.ts', '?\tsrc/routes/pagination.ts', '',
  'no changes added to commit (use "git add" and/or "git commit -a")',
] };

export const demoThreads: DemoThread[] = [
  { id: 'dark-mode', project: 'lumen', title: 'Add dark mode to the settings page', agent: 'claude', status: 'done', minutesAgo: 0, linkedWorktree: false, model: 'Sonnet 5.5', context: 14, transcript: darkMode },
  { id: 'tooltip', project: 'lumen', title: 'Fix the chart tooltip jumping on Safari', agent: 'claude', status: 'blocked', minutesAgo: 3, linkedWorktree: false, model: 'Sonnet 5.5', context: 31, transcript: tooltip, ask: { question: 'Do you want to proceed?', options: ['Yes', 'Yes, and don’t ask again this session', 'No, and tell Claude what to do differently'] } },
  { id: 'slow-load', project: 'lumen', title: 'Why is the dashboard slow on first load?', agent: 'codex', status: 'idle', minutesAgo: 4, linkedWorktree: false, model: 'gpt-5.5', context: 9, transcript: slowLoad },
  { id: 'cursor', shell: gitStatus, project: 'harbor', title: 'cursor-pagination-for-invoices', agent: 'claude', status: 'working', minutesAgo: 60, linkedWorktree: true, model: 'Sonnet 5.5', context: 42, transcript: cursorPagination },
  { id: 'rate-limit', project: 'harbor', title: 'rate-limit-webhook-sender', agent: 'opencode', status: 'idle', minutesAgo: 62, linkedWorktree: true, model: 'Sonnet 5.5', context: 18, transcript: rateLimit },
  { id: 'onboarding', project: 'pixelforge', title: 'Redesign the onboarding carousel', agent: 'claude', status: 'idle', minutesAgo: 120, linkedWorktree: false, model: 'Opus 5.5', context: 27, transcript: onboarding },
  { id: 'rotation', project: 'pixelforge', title: 'Crash when rotating on iPad', agent: 'pi', status: 'idle', minutesAgo: 300, linkedWorktree: false, model: 'Sonnet 5.5', context: 12, transcript: rotation },
];

export const featuredThread = demoThreads[0];
export const terminalIdOf = (thread: DemoThread) => `term_${thread.id}`;
export const shellTerminalIdOf = (thread: DemoThread) => `${terminalIdOf(thread)}_shell`;
export const threadOfTerminal = (terminalId: string) => demoThreads.find((thread) => terminalIdOf(thread) === terminalId);
export const threadOfShellTerminal = (terminalId: string) => demoThreads.find((thread) => thread.shell && shellTerminalIdOf(thread) === terminalId);
