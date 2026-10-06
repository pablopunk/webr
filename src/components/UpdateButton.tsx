import { CircleArrowUp } from 'lucide-react';
import { useUpdate } from '../client/update';
import { Tooltip } from './Tooltip';

export function UpdateButton() {
  const { status, updating, requestUpdate } = useUpdate();
  if (!status || !(status.available || updating)) return null;
  return <Tooltip label={`Webr ${status.latest} is available`}>
    <button type="button" className="sidebar-update" disabled={updating} onClick={() => void requestUpdate()}>
      <CircleArrowUp size={14} aria-hidden="true" />{updating ? 'Updating…' : 'Update'}
    </button>
  </Tooltip>;
}
