import type { ReactElement, ReactNode } from 'react';
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';

export function Tooltip({ label, side = 'top', children }: { label: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right'; children: ReactElement }) {
  return <BaseTooltip.Root>
    <BaseTooltip.Trigger render={children} />
    <BaseTooltip.Portal>
      <BaseTooltip.Positioner className="tooltip-positioner" side={side} sideOffset={8} collisionPadding={8}>
        <BaseTooltip.Popup className="tooltip-popup">{label}</BaseTooltip.Popup>
      </BaseTooltip.Positioner>
    </BaseTooltip.Portal>
  </BaseTooltip.Root>;
}
