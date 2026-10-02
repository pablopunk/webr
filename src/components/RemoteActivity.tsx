import { useEffect, useState } from 'react';
import { describeAuditEvent, listAuditEvents, relativeTime, type AuditEvent } from '../client/pairing';

const VISIBLE_EVENTS = 8;

export function RemoteActivity({ refreshKey }: { refreshKey: unknown }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  useEffect(() => { void listAuditEvents().then(setEvents, () => undefined); }, [refreshKey]);
  if (!events.length) return null;
  return <div className="remote-activity">
    <h3 className="settings-subtitle">Recent activity</h3>
    {events.slice(0, VISIBLE_EVENTS).map((event) => <p className="activity-row" key={event.id}>
      <span>{describeAuditEvent(event)}</span><time dateTime={new Date(event.at).toISOString()}>{relativeTime(event.at)}</time>
    </p>)}
  </div>;
}
