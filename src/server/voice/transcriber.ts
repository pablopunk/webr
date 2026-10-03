import { fork, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { downloadModel, isModelDownloaded, modelFiles } from './model';

export type VoiceState = 'unavailable' | 'needs-download' | 'downloading' | 'ready';
type Reply = { id: number; text?: string; error?: string };
type Pending = { resolve: (text: string) => void; reject: (error: Error) => void };

const IDLE_UNLOAD_MS = 5 * 60 * 1000;
const WORKER_PATH = fileURLToPath(new URL('./worker.mjs', import.meta.url));

const recognizerInstalled = () => { try { createRequire(import.meta.url).resolve('sherpa-onnx-node'); return true; } catch { return false; } };

export class Transcriber {
  private download?: Promise<void>;
  private worker?: Promise<ChildProcess>;
  private pending = new Map<number, Pending>();
  private nextId = 0;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private readonly installed: boolean;

  constructor(private readonly directory: string, private readonly idleUnloadMs = IDLE_UNLOAD_MS, installed = recognizerInstalled()) {
    this.installed = installed;
  }

  async state(): Promise<VoiceState> {
    if (!this.installed) return 'unavailable';
    if (this.download) return 'downloading';
    return await isModelDownloaded(this.directory) ? 'ready' : 'needs-download';
  }

  warm() {
    if (!this.installed) return Promise.reject(new Error('voice_unavailable'));
    this.keepAliveWhileIdle();
    return this.worker ??= this.ensureDownloaded().then(() => this.startWorker()).catch((error) => { this.worker = undefined; throw error; });
  }

  async transcribe(samples: Float32Array, sampleRate: number) {
    const worker = await this.warm();
    const id = this.nextId++;
    const text = new Promise<string>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    worker.send({ id, samples, sampleRate });
    try { return await text; } finally { this.keepAliveWhileIdle(); }
  }

  close() { clearTimeout(this.idleTimer); void this.worker?.then((worker) => worker.kill(), () => undefined); this.worker = undefined; }

  private ensureDownloaded() {
    return this.download ??= isModelDownloaded(this.directory)
      .then((ready) => ready ? undefined : downloadModel(this.directory))
      .finally(() => { this.download = undefined; });
  }

  private startWorker() {
    return new Promise<ChildProcess>((resolve, reject) => {
      const worker = fork(WORKER_PATH, [], { serialization: 'advanced', stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { ...process.env, WEBR_VOICE_MODEL: JSON.stringify(modelFiles(this.directory)) } });
      worker.on('message', (message: Reply & { ready?: boolean }) => { if (message.ready) resolve(worker); else this.settle(message); });
      worker.once('exit', (code) => { this.forgetWorker(worker, new Error(`voice_worker_exited_${code}`)); reject(new Error('voice_worker_failed')); });
    });
  }

  private settle({ id, text, error }: Reply) {
    const request = this.pending.get(id);
    this.pending.delete(id);
    if (error !== undefined) request?.reject(new Error(error)); else request?.resolve(text ?? '');
  }

  private forgetWorker(worker: ChildProcess, reason: Error) {
    void this.worker?.then((current) => { if (current === worker) this.worker = undefined; }, () => undefined);
    for (const request of this.pending.values()) request.reject(reason);
    this.pending.clear();
  }

  private keepAliveWhileIdle() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => { if (!this.pending.size) this.close(); }, this.idleUnloadMs);
    this.idleTimer.unref();
  }
}
