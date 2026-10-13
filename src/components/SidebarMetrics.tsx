import { useEffect, useState } from 'react';
import { Cpu, MemoryStick } from 'lucide-react';
import { Tooltip } from './Tooltip';

type Metrics = { cpu: number; cpuCores?: number; memory: number; memoryUsedBytes?: number; memoryTotalBytes?: number };
type Sample = Metrics & { at: number };

const gibibytes = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

function Metric({ label, metrics, kind, disabled, onOpenMonitor }: { label: string; metrics?: Metrics; kind: 'cpu' | 'memory'; disabled: boolean; onOpenMonitor: () => void }) {
  const Icon = kind === 'cpu' ? Cpu : MemoryStick;
  const value = metrics?.[kind];
  const strugglingAt = 80;
  const spikingAt = kind === 'cpu' ? 50 : 60;
  const pressure = value === undefined ? 'is-idle' : value >= strugglingAt ? 'is-struggling' : value >= spikingAt ? 'is-spiking' : 'is-normal';
  return <Tooltip side="bottom" label={<div className={`sidebar-metric-tooltip ${pressure}`}>
    <div className="sidebar-metric-tooltip-heading"><strong>{label === 'RAM' ? 'Memory' : 'CPU'}</strong><strong>{value === undefined ? '—' : `${value}%`}</strong></div>
    <div className="sidebar-metric-meter"><span style={{ width: `${value ?? 0}%` }} /></div>
    <p>{kind === 'cpu'
      ? Number.isFinite(metrics?.cpuCores) ? `${metrics!.cpuCores} logical cores` : 'Core count unavailable'
      : Number.isFinite(metrics?.memoryUsedBytes) && Number.isFinite(metrics?.memoryTotalBytes)
        ? `${gibibytes(metrics!.memoryUsedBytes!)} of ${gibibytes(metrics!.memoryTotalBytes!)} used`
        : 'Memory breakdown unavailable'}</p>
    <small>Live · updates every 2 seconds · click to open a monitor terminal</small>
  </div>}>
    <button type="button" aria-label={`Open ${label === 'RAM' ? 'RAM' : 'CPU'} monitor terminal`} disabled={disabled} className={`sidebar-metric is-${kind} ${pressure}`} onClick={onOpenMonitor}>
      <span className={`sidebar-metric-glyph is-${kind}`} aria-hidden="true">
        <Icon className="sidebar-metric-icon" size={17} strokeWidth={1.8} />
      </span>
    </button>
  </Tooltip>;
}

export function SidebarMetrics({ disabled, onOpenMonitor }: { disabled: boolean; onOpenMonitor: () => void }) {
  const [samples, setSamples] = useState<Sample[]>([]);
  useEffect(() => {
    let disposed = false;
    const sample = async () => {
      try {
        const response = await fetch('/api/metrics');
        if (!response.ok) return;
        const payload = await response.json() as Partial<Metrics>;
        if (!Number.isFinite(payload.cpu) || !Number.isFinite(payload.memory)) return;
        const metrics: Metrics = {
          cpu: payload.cpu!, memory: payload.memory!,
          ...(Number.isFinite(payload.cpuCores) ? { cpuCores: payload.cpuCores } : {}),
          ...(Number.isFinite(payload.memoryUsedBytes) ? { memoryUsedBytes: payload.memoryUsedBytes } : {}),
          ...(Number.isFinite(payload.memoryTotalBytes) ? { memoryTotalBytes: payload.memoryTotalBytes } : {}),
        };
        if (!disposed) setSamples((previous) => [...previous, { ...metrics, at: Date.now() }].slice(-20));
      } catch { /* Metrics are optional; keep the latest successful sample. */ }
    };
    void sample();
    const interval = window.setInterval(() => void sample(), 2000);
    return () => { disposed = true; window.clearInterval(interval); };
  }, []);
  const latest = samples.at(-1);
  return <div className="sidebar-metrics" aria-label="Server resource usage">
    <Metric label="CPU" metrics={latest} kind="cpu" disabled={disabled} onOpenMonitor={onOpenMonitor} />
    <Metric label="RAM" metrics={latest} kind="memory" disabled={disabled} onOpenMonitor={onOpenMonitor} />
  </div>;
}
