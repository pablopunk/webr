import { createInterface } from 'node:readline';
import { schemaFixture } from '../../tests/fixtures/schema';
import { threadOfTerminal } from './demo';
import { renderScreen } from './screen';

const [group, action, mode, terminalId, ...flags] = process.argv.slice(2);
const flag = (name: string, fallback: number) => { const at = flags.indexOf(name); return at >= 0 ? Number(flags[at + 1]) : fallback; };
const print = (value: unknown) => console.log(typeof value === 'string' ? value : JSON.stringify(value));

function streamTerminal(id: string) {
  const thread = threadOfTerminal(id);
  if (!thread) { console.error('unknown terminal'); process.exit(1); }
  let cols = flag('--cols', 80), rows = flag('--rows', 24), seq = 0, draft = '';
  const emit = () => print({ type: 'terminal.frame', encoding: 'ansi', seq: seq++, width: cols, height: rows, full: true, bytes: Buffer.from(renderScreen(thread, cols, rows, draft)).toString('base64') });
  const typed = (text: string) => { for (const character of text) draft = character === '\x7f' ? draft.slice(0, -1) : character === '\r' ? '' : /[\x20-￿]/.test(character) ? draft + character : draft; };
  emit();
  createInterface({ input: process.stdin }).on('line', (line) => {
    const command = JSON.parse(line) as { type: string; text?: string; cols?: number; rows?: number };
    if (command.type === 'terminal.release') process.exit(0);
    if (command.type === 'terminal.resize') { cols = command.cols!; rows = command.rows!; emit(); }
    if (command.type === 'terminal.input') { typed(command.text ?? ''); emit(); }
  }).on('close', () => process.exit(0));
}

const argv = process.argv.slice(2);
if (argv[0] === '--version') print('herdr 0.9.3');
else if (argv[0] === 'api' && argv[1] === 'schema') print(schemaFixture());
else if (argv[0] === 'machine' && argv[1] === 'list') print([]);
else if (group === 'terminal' && action === 'session') streamTerminal(terminalId);
else process.exit(1);
