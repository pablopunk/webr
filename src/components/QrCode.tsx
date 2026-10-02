import { encode } from 'uqr';

const QUIET_ZONE = 2;

export function QrCode({ value, label }: { value: string; label: string }) {
  const { data, size } = encode(value);
  const modules = data.flatMap((row, y) => row.flatMap((dark, x) => dark ? [`M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`] : []));
  const span = size + QUIET_ZONE * 2;
  return <svg className="qr-code" role="img" aria-label={label} viewBox={`0 0 ${span} ${span}`} shapeRendering="crispEdges">
    <rect width={span} height={span} fill="#fff" />
    <path d={modules.join('')} fill="#000" />
  </svg>;
}
