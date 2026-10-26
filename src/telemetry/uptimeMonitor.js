// Calls the hub's healthUrl when it has one. Hubs without a URL count as healthy.
export async function httpProbe(hub, { timeoutMs = 3000 } = {}) {
  if (!hub.healthUrl) return 0;
  const started = Date.now();
  const response = await fetch(hub.healthUrl, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Health check returned ${response.status}`);
  return Date.now() - started;
}

export class UptimeMonitor {
  constructor({
    router,
    probe = httpProbe,
    intervalMs = 30000,
    windowSize = 20,
    failureThreshold = 3,
    now = () => Date.now(),
  }) {
    this.router = router;
    this.probe = probe;
    this.intervalMs = intervalMs;
    this.windowSize = windowSize;
    this.failureThreshold = failureThreshold;
    this.now = now;
    this.stats = new Map();
    this.timer = null;
  }

  entry(nodeId) {
    if (!this.stats.has(nodeId)) {
      this.stats.set(nodeId, { samples: [], consecutiveFailures: 0, lastCheckedAt: null });
    }
    return this.stats.get(nodeId);
  }

  record(nodeId, ok, latencyMs = 0) {
    const entry = this.entry(nodeId);
    entry.samples.push({ ok, latencyMs });
    if (entry.samples.length > this.windowSize) entry.samples.shift();
    entry.lastCheckedAt = new Date(this.now()).toISOString();

    const hub = this.router.getHub(nodeId);
    if (ok) {
      entry.consecutiveFailures = 0;
      if (hub?.status === 'down') this.router.setHubStatus(nodeId, 'up');
    } else {
      entry.consecutiveFailures += 1;
      if (hub && entry.consecutiveFailures >= this.failureThreshold) {
        this.router.setHubStatus(nodeId, 'down');
      }
    }
  }

  async checkAll() {
    await Promise.all(
      this.router.listHubs().map(async (hub) => {
        try {
          const latencyMs = await this.probe(hub);
          this.record(hub.id, true, latencyMs);
        } catch {
          this.record(hub.id, false);
        }
      }),
    );
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.checkAll().catch(() => {});
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  snapshot() {
    return this.router.listHubs().map((hub) => {
      const entry = this.stats.get(hub.id);
      const samples = entry?.samples ?? [];
      const okSamples = samples.filter((sample) => sample.ok);
      return {
        id: hub.id,
        name: hub.name,
        status: hub.status,
        uptimePct: samples.length ? Math.round((okSamples.length / samples.length) * 1000) / 10 : null,
        avgLatencyMs: okSamples.length
          ? Math.round(okSamples.reduce((sum, sample) => sum + sample.latencyMs, 0) / okSamples.length)
          : null,
        consecutiveFailures: entry?.consecutiveFailures ?? 0,
        lastCheckedAt: entry?.lastCheckedAt ?? null,
      };
    });
  }
}
