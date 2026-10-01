import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { SocketApi } from '../src/server/protocol/socket';
import { nativeSnapshot } from '../src/server/protocol/native';
import { boundedProcess } from '../src/server/transport/process';
import { openCliStream } from '../src/server/terminal/cli';
import { FrameSequence } from '../src/shared/frame';

if (process.env.HERDR_ENV !== '1') throw new Error('LIVE BLOCKED: run from a genuine Herdr-managed pane; do not set HERDR_ENV yourself');
if (process.env.HERDR_WEB_VALIDATE_OWN_DISPOSABLE !== '1') throw new Error('LIVE BLOCKED: explicit opt-in for an owned disposable validation session is required');
const manifestPath = process.argv[2];
if (!manifestPath) throw new Error('LIVE BLOCKED: supply the owned disposable session manifest');
const manifest = z.object({ socket: z.string().regex(/\/sessions\/herdr-web-validation-[a-f0-9-]{36}\/herdr\.sock$/), terminalId: z.string().regex(/^term_[a-zA-Z0-9_-]+$/), paneId: z.string().min(1), program: z.literal('cat') }).strict().parse(JSON.parse(await readFile(manifestPath, 'utf8')));
if (manifest.socket === process.env.HERDR_SOCKET_PATH) throw new Error('LIVE BLOCKED: the current session cannot be the validation session');
const api = new SocketApi(manifest.socket);
try {
  const snapshot = nativeSnapshot.parse((await api.request('session.snapshot')).snapshot);
  if (snapshot.version !== '0.9.3' || snapshot.panes.length !== 1 || snapshot.panes[0].terminal_id !== manifest.terminalId || snapshot.panes[0].pane_id !== manifest.paneId || snapshot.agents.length || snapshot.panes[0].agent) throw new Error('LIVE BLOCKED: disposable ownership or empty-agent check failed');
  const env = { ...process.env, HERDR_SOCKET_PATH: manifest.socket };
  const processInfo = JSON.parse(await boundedProcess('herdr', ['pane', 'process-info', '--pane', manifest.paneId], env));
  const foreground = z.array(z.object({ name: z.string() })).min(1).parse(processInfo.result?.process_info?.foreground_processes);
  if (!foreground.every((process) => process.name === 'cat')) throw new Error('LIVE BLOCKED: every foreground process must be the owned cat test program');
  const sequence = new FrameSequence();
  await new Promise<void>((resolve, reject) => {
    let tested = false;
    let inputSent = false;
    const timer = setTimeout(() => { stream.close(); reject(new Error('LIVE FAIL: no validated full frame and Unicode input result')); }, 5000);
    const stream = openCliStream('herdr', ['terminal', 'session', 'control', manifest.terminalId, '--cols', '80', '--rows', '24'], { env }, (frame) => {
      try {
        sequence.accept({ ...frame, streamId: 1, generation: 1 });
        if (!inputSent) { inputSent = true; stream.send({ type: 'terminal.input', text: 'herdr-web-pilot-é🙂\n' }); stream.send({ type: 'terminal.resize', cols: 80, rows: 24 }); }
        if (Buffer.from(frame.bytes).toString('utf8').includes('herdr-web-pilot-é🙂')) { tested = true; clearTimeout(timer); stream.close(); resolve(); }
      } catch (error) { clearTimeout(timer); stream.close(); reject(error); }
    }, () => { if (!tested) { clearTimeout(timer); reject(new Error('LIVE FAIL: stream closed before validation')); } });
  });
  console.log('PASS: owned local disposable cat stream, full baseline, ordered sequence, Unicode input, resize and release');
  console.log('NOT PROVED: paste, mouse, two native controllers, SSH and agent launch; real gateway write and launch capabilities remain disabled');
} finally { api.close(); }
