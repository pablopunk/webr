import { randomUUID } from 'node:crypto';
import type { TargetAdapter } from './target';
import type { NativeSnapshot } from '../protocol/native';

export class TargetSupervisor {
  readonly generation = randomUUID();
  revision = 0;
  snapshot?: NativeSnapshot;
  connected = false;
  error?: string;
  freshAt: string | null = null;
  private dirty = false;
  private reading = false;
  private stopped = false;
  private subscription?: () => void;
  private timer?: ReturnType<typeof setTimeout>;
  private health?: ReturnType<typeof setInterval>;
  private epoch = 0;
  constructor(readonly target: TargetAdapter, private publish: () => void, private delay = 25) {}
  async start() {
    if (this.stopped) return;
    const epoch = ++this.epoch;
    try {
      const unsubscribe = await this.target.subscribe(() => this.invalidate(), (reason) => this.disconnect(reason));
      if (this.stopped || epoch !== this.epoch) { unsubscribe(); return; }
      this.subscription = unsubscribe;
      this.invalidate();
      this.health ??= setInterval(() => this.invalidate(), 15_000);
      this.health.unref();
    } catch { if (epoch === this.epoch) this.disconnect('target_unavailable'); }
  }
  invalidate() {
    this.dirty = true;
    if (!this.timer && !this.reading && this.subscription) this.timer = setTimeout(() => { this.timer = undefined; void this.refresh(); }, this.delay);
  }
  stop() {
    this.stopped = true; ++this.epoch;
    clearTimeout(this.timer); clearInterval(this.health);
    this.subscription?.(); this.subscription = undefined; this.target.close();
  }
  private async refresh() {
    if (this.reading || this.stopped || !this.subscription) return;
    this.reading = true;
    this.dirty = false;
    const epoch = this.epoch;
    try {
      const snapshot = await this.target.snapshot();
      if (epoch !== this.epoch || this.stopped) return;
      this.snapshot = snapshot; this.connected = true; this.error = undefined;
      this.freshAt = new Date().toISOString(); ++this.revision; this.publish();
    } catch { if (epoch === this.epoch) this.disconnect('snapshot_failed'); }
    finally {
      this.reading = false;
      if (this.dirty && this.hasSubscription()) this.invalidate();
    }
  }
  private hasSubscription() { return !!this.subscription; }
  private disconnect(reason: string) {
    if (this.stopped) return;
    ++this.epoch; this.subscription?.(); this.subscription = undefined;
    this.connected = false; this.error = reason; this.freshAt = null; ++this.revision; this.publish();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = undefined; void this.start(); }, Math.max(100, this.delay));
  }
}
