import { expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { boundedProcess } from '../src/server/transport/process';

it('runs the actual ephemeral recorder on an owned test PTY and measures bytes and physical size without Herdr', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hr-')); const path = join(directory, 'recorder.py');
  try {
    await writeFile(path, await readFile('scripts/validation-recorder.py'), { mode: 0o600 });
    const script = `import os,pty,subprocess,sys,json,time,base64,fcntl,termios,struct,signal
master,slave=pty.openpty()
process=subprocess.Popen(['python3',sys.argv[1],'fixture-recorder'],stdin=slave,stdout=slave,stderr=slave,start_new_session=True)
root=os.path.dirname(sys.argv[1])
def observe(predicate):
 end=time.monotonic()+3
 while time.monotonic()<end:
  try:
   state=json.load(open(root+'/state.json'))
   if predicate(state): return state
  except (FileNotFoundError,json.JSONDecodeError): pass
  time.sleep(.005)
 raise RuntimeError('observed recorder state timeout')
try:
 observe(lambda value:value['nonce']=='fixture-recorder')
 payload='é🙂'.encode()+b'\\x7f\\t\\r\\x03\\x1b[200~line1\\nline2\\x1b[201~\\x1b[<0;4;3M'
 os.write(master,payload)
 captured=observe(lambda value:base64.b64decode(value['bytes'])==payload)
 fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',26,90,0,0))
 process.send_signal(signal.SIGWINCH)
 resized=observe(lambda value:value['cols']==90 and value['rows']==26)
 print(json.dumps({'exact':captured['bytes'],'cols':resized['cols'],'rows':resized['rows']}))
finally:
 process.terminate()
 process.wait(timeout=3)
 os.close(master);os.close(slave)`;
    const result = JSON.parse(await boundedProcess('python3', ['-c', script, path], undefined, 10_000));
    expect(result.cols).toBe(90); expect(result.rows).toBe(26); expect(Buffer.from(result.exact, 'base64').toString()).toContain('é🙂');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
