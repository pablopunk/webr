const ATTENTIVE_WINDOW_MS = 10_000;

export class ApproverPresence {
  private lastSeenAt = Number.NEGATIVE_INFINITY;
  constructor(private readonly now = Date.now) {}
  seen() { this.lastSeenAt = this.now(); }
  attentive() { return this.now() - this.lastSeenAt < ATTENTIVE_WINDOW_MS; }
}
