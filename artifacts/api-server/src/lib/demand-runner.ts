export type WorkOutcome = "worked" | "idle" | "contended";

/** A wake signal drains persisted work; rare fallback checks cover missed signals
 * and other instances. This does not make an in-process worker Autoscale-safe. */
export class DemandRunner {
  private timer?: ReturnType<typeof setTimeout>;
  private active = false;
  private pending = false;
  private stopped = true;
  private idleMs: number;
  private retryMs = 5000;
  constructor(
    private readonly task: () => Promise<WorkOutcome>,
    private readonly onError: () => void,
    private readonly minimumIdleMs = 15 * 60_000,
    private readonly maximumIdleMs = 60 * 60_000,
  ) { this.idleMs = minimumIdleMs; }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.wake();
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.pending = false;
  }
  wake() {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.idleMs = this.minimumIdleMs;
    this.retryMs = 5000;
    if (this.active) { this.pending = true; return; }
    // Coalesce bursts; do not add latency to the request's DB transaction.
    this.schedule(0);
  }
  private schedule(ms: number) {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.run(), ms);
    this.timer.unref();
  }
  private async run() {
    if (this.active || this.stopped) return;
    this.active = true;
    let outcome: WorkOutcome = "contended";
    try { outcome = await this.task(); }
    catch { this.onError(); }
    finally { this.active = false; }
    if (this.stopped) return;
    if (this.pending || outcome === "worked") {
      this.pending = false;
      this.retryMs = 5000;
      this.schedule(0);
    } else if (outcome === "contended") {
      this.schedule(this.retryMs);
      // Persistent storage/DB failures must not become permanent minute-by-
      // minute database traffic. A new explicit wake resets this backoff.
      this.retryMs = Math.min(this.retryMs * 2, this.maximumIdleMs);
    } else {
      this.retryMs = 5000;
      this.schedule(this.idleMs);
      this.idleMs = Math.min(this.idleMs * 2, this.maximumIdleMs);
    }
  }
}
