export const perfAvailable = import.meta.env.DEV;

type Stat = { p50: number; p95: number; max: number; n: number };
export type PerfSnapshot = { rates: Record<string, number>; stats: Record<string, Stat>; gauges: Record<string, number> };

const overlayKey = 'webr-perf';
const counters = new Map<string, number>();
const samples = new Map<string, number[]>();
const gauges = new Map<string, number>();
const listeners = new Set<() => void>();
let collecting = false;
let overlay = false;
let snapshot: PerfSnapshot = { rates: {}, stats: {}, gauges: {} };
let outbox: Record<string, unknown>[] = [];

const percentile = (sorted: number[], fraction: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
const summarize = (values: number[]): Stat => { const sorted = [...values].sort((a, b) => a - b); return { p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), max: sorted[sorted.length - 1], n: sorted.length }; };
const emit = () => listeners.forEach((listener) => listener());
const roundAll = (values: Record<string, number>) => Object.fromEntries(Object.entries(values).map(([name, value]) => [name, +value.toFixed(2)]));

/** Counts something that happened (events, bytes). Reported as a per-second rate. */
export function count(name: string, amount = 1) { if (collecting) counters.set(name, (counters.get(name) ?? 0) + amount); }
/** Records how long something took, in ms. Reported as p50/p95/max per second. */
export function time(name: string, ms: number) { if (collecting) (samples.get(name) ?? samples.set(name, []).get(name)!).push(ms); }
/** Records the latest value of something that has a level (queue depth). */
export function gauge(name: string, value: number) { if (collecting) gauges.set(name, value); }
/** Writes one record to the perf log right away, for rare things worth reading one by one. */
export function event(name: string, fields: Record<string, unknown> = {}) { if (collecting) outbox.push({ event: name, ...fields }); }
/** Starts a stopwatch; the returned function records the elapsed ms under `name` (and returns it). */
export function span(name: string) { const start = performance.now(); return () => { const elapsed = performance.now() - start; time(name, elapsed); return elapsed; }; }
export const perfNow = () => performance.now();

const isActive = (rates: Record<string, number>) => Object.keys(rates).some((name) => name !== 'frames' && rates[name]);

function publishSecond(elapsedSeconds: number) {
  snapshot = {
    rates: roundAll(Object.fromEntries([...counters].map(([name, total]) => [name, total / elapsedSeconds]))),
    stats: Object.fromEntries([...samples].filter(([, values]) => values.length).map(([name, values]) => [name, Object.fromEntries(Object.entries(summarize(values)).map(([key, value]) => [key, +value.toFixed(2)])) as Stat])),
    gauges: roundAll(Object.fromEntries(gauges)),
  };
  if (isActive(snapshot.rates)) outbox.push({ event: 'client.second', seconds: +elapsedSeconds.toFixed(2), ...snapshot });
  counters.clear(); samples.clear(); emit();
}

function flushOutbox() {
  if (!outbox.length) return;
  const records = outbox; outbox = [];
  void fetch('/api/dev/perf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ records }), keepalive: true }).catch(() => undefined);
}

type ProfileFrame = { name: string; resourceId?: number; line?: number; column?: number };
type ProfileTrace = { resources: string[]; frames: ProfileFrame[]; stacks: { parentId?: number; frameId: number }[]; samples: { timestamp: number; stackId?: number }[] };
type ProfilerInstance = { stop: () => Promise<ProfileTrace> };
const SLOW_TASK_MS = 200;
const PROFILE_WINDOW_MS = 30_000;
const SAMPLE_INTERVAL_MS = 10;

const frameLabel = (trace: ProfileTrace, frameId: number) => {
  const { name, resourceId, line, column } = trace.frames[frameId];
  return `${name || '(anonymous)'} ${resourceId === undefined ? '' : trace.resources[resourceId].replace(location.origin, '')}:${line ?? 0}:${column ?? 0}`;
};

function hottestFrames(trace: ProfileTrace, from: number, to: number) {
  const self = new Map<string, number>(); const inclusive = new Map<string, number>();
  for (const sample of trace.samples) {
    if (sample.timestamp < from || sample.timestamp > to || sample.stackId === undefined) continue;
    const seen = new Set<string>();
    for (let id: number | undefined = sample.stackId; id !== undefined; id = trace.stacks[id].parentId) {
      const label = frameLabel(trace, trace.stacks[id].frameId);
      if (id === sample.stackId) self.set(label, (self.get(label) ?? 0) + SAMPLE_INTERVAL_MS);
      if (!seen.has(label)) { seen.add(label); inclusive.set(label, (inclusive.get(label) ?? 0) + SAMPLE_INTERVAL_MS); }
    }
  }
  const top = (totals: Map<string, number>) => [...totals].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([label, ms]) => `${ms}ms ${label}`);
  return { self: top(self), inclusive: top(inclusive) };
}

/** Needs the `Document-Policy: js-profiling` header (the dev server sends it) and a Chromium browser. */
function profileSlowTasks() {
  const Profiler = (globalThis as { Profiler?: new (options: { sampleInterval: number; maxBufferSize: number }) => ProfilerInstance }).Profiler;
  if (!Profiler) return () => {};
  const begin = () => { try { return new Profiler({ sampleInterval: SAMPLE_INTERVAL_MS, maxBufferSize: PROFILE_WINDOW_MS / SAMPLE_INTERVAL_MS }); } catch { return undefined; } };
  let profiler = begin();
  const restart = async (inspect?: (trace: ProfileTrace) => void) => {
    const finished = profiler; profiler = undefined;
    try { const trace = await finished?.stop(); if (trace) inspect?.(trace); } catch { /* profiler already stopped */ }
    profiler = begin();
  };
  const rotation = setInterval(() => void restart(), PROFILE_WINDOW_MS - 1000);
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) if (entry.duration >= SLOW_TASK_MS) void restart((trace) => event('slow.task.profile', { durationMs: Math.round(entry.duration), ...hottestFrames(trace, entry.startTime, entry.startTime + entry.duration) }));
  });
  try { observer.observe({ entryTypes: ['longtask'] }); } catch { /* longtask unsupported */ }
  return () => { clearInterval(rotation); observer.disconnect(); };
}

type AnimationFrameTiming = PerformanceEntry & { renderStart: number; styleAndLayoutStart: number; scripts: { duration: number; invoker: string; sourceURL: string; sourceFunctionName: string }[] };
/** Splits a slow frame into script, style/layout and paint time, which the JS profiler cannot see. */
function explainSlowAnimationFrames() {
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as AnimationFrameTiming[]) {
      if (entry.duration < SLOW_TASK_MS) continue;
      const end = entry.startTime + entry.duration;
      event('slow.animation.frame', { durationMs: Math.round(entry.duration), scriptMs: Math.round(entry.scripts.reduce((total, script) => total + script.duration, 0)), styleAndLayoutMs: Math.round(end - entry.styleAndLayoutStart), renderMs: Math.round(end - entry.renderStart), scripts: entry.scripts.map((script) => `${Math.round(script.duration)}ms ${script.invoker} ${script.sourceFunctionName} ${script.sourceURL}`) });
    }
  });
  try { observer.observe({ type: 'long-animation-frame', buffered: false }); } catch { /* long-animation-frame unsupported */ }
}

function observeFrames() {
  let last = performance.now(); let raf = 0;
  const tick = (now: number) => { time('frameMs', now - last); count('frames'); last = now; raf = requestAnimationFrame(tick); };
  raf = requestAnimationFrame(tick);
  const longTasks = new PerformanceObserver((list) => { for (const entry of list.getEntries()) { time('longTaskMs', entry.duration); count('longTasks'); } });
  try { longTasks.observe({ entryTypes: ['longtask'] }); } catch { /* longtask unsupported */ }
  return () => { cancelAnimationFrame(raf); longTasks.disconnect(); };
}

const stallWatchdogSource = `
  let last = performance.now(); let reported = 0;
  onmessage = (message) => { if (reported) post({ event: 'main.unfrozen', stalledMs: Math.round(performance.now() - last) }); reported = 0; last = performance.now(); };
  const post = (record) => fetch(self.name + '/api/dev/perf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ records: [record] }) }).catch(() => {});
  setInterval(() => { const stalled = performance.now() - last; if (stalled > 300 && performance.now() - reported > 1000) { reported = performance.now(); post({ event: 'main.stalled', stalledMs: Math.round(stalled) }); } }, 100);
`;

/** A worker keeps running while the page's main thread is frozen, so it can report the freeze. */
function watchMainThreadStalls() {
  const url = URL.createObjectURL(new Blob([stallWatchdogSource], { type: 'text/javascript' }));
  const worker = new Worker(url, { name: location.origin });
  const beat = setInterval(() => worker.postMessage(0), 100);
  return () => { clearInterval(beat); worker.terminate(); URL.revokeObjectURL(url); };
}

/** Starts collecting and shipping metrics to the dev server's perf log. Does nothing in production builds. */
export function startPerf() {
  if (!perfAvailable || collecting) return;
  collecting = true;
  try { overlay = localStorage.getItem(overlayKey) === '1'; } catch { /* storage unavailable */ }
  let started = performance.now();
  observeFrames(); watchMainThreadStalls(); profileSlowTasks(); explainSlowAnimationFrames();
  setInterval(() => { const now = performance.now(); publishSecond((now - started) / 1000); started = now; }, 1000);
  setInterval(flushOutbox, 1000);
  emit();
}

export const perfVisible = () => overlay;
export const perfSnapshot = () => snapshot;
export function subscribePerf(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function setPerfVisible(next: boolean) {
  overlay = next;
  try { localStorage.setItem(overlayKey, next ? '1' : '0'); } catch { /* storage unavailable */ }
  emit();
}
