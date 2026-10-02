import { expect, it } from 'vitest';
import { boundedProcess } from '../src/server/transport/process';
import { quoteShell, remoteCommand, sshOptions, SshForward } from '../src/server/transport/ssh';
import { HerdrTarget } from '../src/server/transport/herdr-target';
import { validateInstalledSchema } from '../src/server/protocol/validate';
import { openCliStream } from '../src/server/terminal/cli';
import { frame } from './fixtures/target';

it('quotes target-host argv without using --machine or an interactive PTY and requires strict host keys', () => {
  expect(quoteShell("a'b")).toBe("'a'\\''b'");
  const command = remoteCommand('/safe/herdr.sock', 'herdr', ['terminal', 'session', 'observe', "term_'quoted"]);
  expect(command).not.toContain('--machine'); expect(command).toContain("'term_'\\''quoted'");
  expect(sshOptions).toContain('-T'); expect(sshOptions).toContain('StrictHostKeyChecking=yes'); expect(sshOptions).toContain('BatchMode=yes'); expect(sshOptions).toContain('ExitOnForwardFailure=yes');
  expect(() => new SshForward('-unsafe', '/safe/herdr.sock')).toThrow('invalid_ssh_target'); expect(() => remoteCommand('/safe\nunsafe', 'herdr', [])).toThrow();
});
it('bounds process stdout and enforces deadlines without installing or stopping a server', async () => {
  await expect(boundedProcess(process.execPath, ['-e', 'setInterval(()=>{},100)'], undefined, 20)).rejects.toThrow('process_timeout');
  await expect(boundedProcess(process.execPath, ['-e', 'process.stdout.write("a".repeat(1000))'], undefined, 1000, 100)).rejects.toThrow('process_output_limit');
});
it('parses exact CLI frame envelopes from an owned fake process and tears down only that process', async () => {
  const value = frame(); let seen = false;
  await new Promise<void>((resolve, reject) => {
    const program = `console.log(JSON.stringify(${JSON.stringify({ type: 'terminal.frame', encoding: 'ansi', ...value, bytes: Buffer.from(value.bytes).toString('base64') })}));setInterval(()=>{},100);`;
    const stream = openCliStream(process.execPath, ['-e', program], {}, (received) => { seen = true; expect(received.seq).toBe(1); expect(received.full).toBe(true); stream.close(); resolve(); }, (reason) => { if (!seen) reject(new Error(reason)); });
  });
});
it('rejects unsupported schemas and keeps real control and launch effects disabled', async () => {
  expect(validateInstalledSchema({ protocol: 99 })).toContain('Unsupported protocol: expected 22');
  const target = new HerdrTarget({ id: 'test', name: 'Test', session: 'default', enabled: true, transport: 'local', locations: [] });
  expect(target.writable).toBe(false); expect(() => target.openTerminal('term_unknown', 'control', 80, 24, false, () => {}, () => {})).toThrow('terminal_control_unavailable');
  await expect(target.create({ machineId: 'test', projectId: 'none', agent: 'claude', model: 'Default', prompt: 'must not send', worktree: true }, '00000000-0000-4000-8000-000000000001')).rejects.toThrow('launch_unavailable');
});
