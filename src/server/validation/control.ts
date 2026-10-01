import { randomUUID, createHash } from 'node:crypto';
import { quoteShell } from '../transport/ssh';
import { encodeUserInput } from '../terminal/writer';
import { controlChecks } from './evidence';
import { waitFor } from './wait';
import { Ownership } from './ownership';
import type { Scratch, ValidationPeer } from './contracts';

const requireProof = (condition: boolean, message: string) => { if (!condition) throw new Error(message); };
const bytes = (state: { bytes: string }) => Buffer.from(state.bytes, 'base64');
export async function validateControl(owner: Ownership, scratch: Scratch) {
  const transport = owner.transport; const checked = new Set<string>(); const peers: ValidationPeer[] = [];
  const resource = await owner.create('recorder', scratch.path);
  const fresh = async () => { await owner.fresh(resource); const foreground = await owner.foreground(resource); if (resource.pid && !foreground.foreground_processes.every((process) => process.pid === resource.pid)) throw new Error('Recorder process occupant changed'); };
  const state = async () => { await fresh(); const data = await transport.recorder(scratch); if (!data || data.nonce !== scratch.nonce || data.pid !== resource.pid) throw new Error('Recorder identity changed'); return data; };
  const attach = async (mode: 'control' | 'observe', takeover = false) => {
    await fresh(); const peer = transport.open(resource, mode, takeover); peers.push(peer);
    await waitFor(transport, async () => peer, (peer) => !!peer.closed || !!peer.frames[0]?.full, 'terminal baseline'); return peer;
  };
  const reacquire = async () => {
    const end = transport.now() + 5000;
    do { const peer = await attach('control'); if (!peer.closed) return peer; if (peer.closed !== 'controller_conflict') throw new Error('Controller reacquire failed: ' + peer.closed); await transport.sleep(25); } while (transport.now() < end);
    throw new Error('Owned controller was not released');
  };
  const input = async (peer: ValidationPeer, text: string, paste = false) => { await fresh(); peer.send({ type: 'terminal.input', text: encodeUserInput(text, paste) }); };
  const recorded = (predicate: (data: Awaited<ReturnType<typeof state>>) => boolean, label: string) => waitFor(transport, state, predicate, label);
  const barrier = async (peer: ValidationPeer) => { const marker = 'BARRIER-' + randomUUID(); await input(peer, marker); await recorded((data) => bytes(data).includes(marker), 'input barrier'); return marker; };
  try {
    const shell = await waitFor(transport, () => owner.foreground(resource), (info) => info.foreground_processes.every((process) => process.pid === info.shell_pid), 'available owned shell'); resource.shellName = shell.foreground_processes[0].name;
    await owner.effect('pane.send_input', { pane_id: resource.paneId, text: 'exec python3 ' + quoteShell(scratch.path + '/recorder.py') + ' ' + quoteShell(scratch.nonce), keys: ['enter'] });
    const ready = await waitFor(transport, () => transport.recorder(scratch), (data) => !!data && data.nonce === scratch.nonce, 'recorder readiness');
    resource.pid = ready!.pid; await owner.journal.record({ event: 'recorder-ready', resource });
    const calibration = { id: randomUUID(), op: 'query' as const, text: 'NATIVE-QUERY-' + randomUUID() }; const calibrationStart = bytes(await state()).length;
    await transport.command(scratch, calibration);
    await waitFor(transport, async () => { await fresh(); return transport.request('pane.read', { pane_id: resource.paneId, source: 'visible', format: 'text', strip_ansi: true }); }, (result) => (result.read as { text?: string })?.text?.includes(calibration.text) ?? false, 'native query calibration output');
    const calibrationMarker = 'CALIBRATION-' + randomUUID(); await fresh(); await owner.effect('pane.send_input', { pane_id: resource.paneId, text: calibrationMarker });
    const calibrated = await recorded((data) => bytes(data).includes(calibrationMarker), 'native calibration barrier');
    const calibrationBytes = bytes(calibrated).subarray(calibrationStart).toString(); const nativeReplyCount = (calibrationBytes.match(/\x1b\[\d+;\d+R/g) ?? []).length;
    requireProof(nativeReplyCount <= 1 && calibrationBytes.replace(/\x1b\[\d+;\d+R/g, '') === calibrationMarker, 'Native query calibration was not isolated');
    const observer = await attach('observe'); requireProof(!observer.closed && observer.frames[0].full, 'Observer did not receive full baseline');
    const a = await attach('control'); if (a.closed) { await owner.journal.preserve('An unknown controller or stream failure exists on the new terminal', resource); throw new Error('First owned controller failed: ' + a.closed); }
    checked.add('full-baseline');
    const before = bytes(await state()); const keys = 'RAW-' + randomUUID() + '\x7f\t\r\x03';
    await input(a, keys); await recorded((data) => bytes(data).subarray(before.length).equals(Buffer.from(keys)), 'ordered raw keys'); checked.add('keys');
    const unicode = 'UTF8-é🙂-' + randomUUID(); await input(a, unicode); await recorded((data) => bytes(data).includes(Buffer.from(unicode)), 'UTF-8 input'); checked.add('unicode');
    const paste = 'PASTE-é🙂\nsecond line\n' + randomUUID(); await input(a, paste, true); await recorded((data) => bytes(data).includes(Buffer.from(encodeUserInput(paste, true))), 'whole bracketed multiline paste'); checked.add('paste');
    for (const invalid of ['\x1b[200~nested', '\x1b[201~nested', '🙂'.repeat(3000)]) {
      let rejected = false; try { encodeUserInput(invalid, true); } catch { rejected = true; } requireProof(rejected, 'Invalid paste/input was accepted');
    }
    const queueStart = bytes(await state()).length; const queued = Array.from({ length: 32 }, (_, index) => `ORDER-${index}-` + 'x'.repeat(128)).join('');
    await fresh(); for (let index = 0; index < 32; index++) a.send({ type: 'terminal.input', text: `ORDER-${index}-` + 'x'.repeat(128) });
    await recorded((data) => bytes(data).subarray(queueStart).equals(Buffer.from(queued)), 'ordered bounded input queue');
    await fresh(); a.send({ type: 'terminal.resize', cols: 90, rows: 26 });
    await recorded((data) => data.cols === 90 && data.rows === 26, 'actual PTY resize'); await waitFor(transport, async () => a.frames, (frames) => frames.some((frame) => frame.full && frame.width === 90 && frame.height === 26), 'resized full frame'); checked.add('resize');
    await fresh(); a.send({ type: 'terminal.mouse', action: 'down', button: 'left', column: 3, row: 2 }); a.send({ type: 'terminal.mouse', action: 'up', button: 'left', column: 3, row: 2 });
    await recorded((data) => /\x1b\[<0;4;3M/.test(bytes(data).toString()) && /\x1b\[<(0|3);4;3m/.test(bytes(data).toString()), 'source SGR mouse events'); checked.add('mouse');
    await fresh(); a.send({ type: 'terminal.scroll', direction: 'down', lines: 2 }); await recorded((data) => (bytes(data).toString().match(/\x1b\[<65;\d+;\d+M/g) ?? []).length >= 2, 'source wheel events'); checked.add('scroll');
    const b = await attach('control'); requireProof(b.closed === 'controller_conflict' && !b.frames.length, 'Second controller failure did not prove a controller conflict'); await barrier(a); checked.add('controller-conflict');
    await fresh(); requireProof(!a.closed, 'The original owned controller no longer owns the terminal'); const c = await attach('control', true); requireProof(!c.closed, 'Own-controller takeover failed');
    await waitFor(transport, async () => a.closed, (reason) => !!reason, 'old owned controller closure'); await barrier(c); checked.add('takeover');
    const command = { id: randomUUID(), op: 'query' as const, text: 'DEVICE-PROBE-' + randomUUID() }; const probeStart = bytes(await state()).length;
    await transport.command(scratch, command); await waitFor(transport, state, (data) => data.commands.includes(command.id), 'output query emission');
    await waitFor(transport, async () => c.frames, (frames) => frames.some((frame) => Buffer.from(frame.bytes).includes(command.text)), 'query output frame'); const marker = await barrier(c);
    const probe = bytes(await state()).subarray(probeStart).toString(); const replies = probe.match(/\x1b\[\d+;\d+R/g) ?? [];
    requireProof(replies.length === nativeReplyCount && probe.replace(/\x1b\[\d+;\d+R/g, '') === marker, 'Unexpected output-derived input or duplicate native device reply'); checked.add('no-device-replies');
    requireProof(c.sequenceOk && c.frames.length > 1 && c.frames.at(-1)!.seq > c.frames[0].seq, 'Stream sequence was not verified'); checked.add('sequence');
    await fresh(); c.send({ type: 'terminal.release' }); await waitFor(transport, async () => c.closed, (reason) => !!reason, 'explicit release'); const d = await reacquire(); await barrier(d); checked.add('release');
    await fresh(); d.disconnect(); await waitFor(transport, async () => d.closed, (reason) => !!reason, 'owned CLI disconnect'); const e = await reacquire(); await barrier(e); checked.add('disconnect');
    const limitStart = bytes(await state()).length; let bounded = false;
    try { e.send({ type: 'terminal.input', text: 'x'.repeat(40_000) }); } catch { bounded = true; }
    requireProof(bounded && !!e.closed, 'Controller writer byte budget did not fail closed'); const last = await reacquire(); const lastMarker = await barrier(last); requireProof(bytes(await state()).subarray(limitStart).equals(Buffer.from(lastMarker)), 'Overloaded input reached the recorder');
    requireProof(controlChecks.every((check) => checked.has(check)), 'Incomplete literal transport proof');
    await owner.journal.record({ event: 'control-proved', checks: [...checked], layer: 'literal-transport', bytesHash: createHash('sha256').update(bytes(await state())).digest('hex') });
    return { kind: 'control' as const, inputAdapter: 'literal-pilot-v1' as const, scope: 'literal-transport' as const, checks: [...checked] };
  } finally { for (const peer of peers.reverse()) peer.close(); }
}
