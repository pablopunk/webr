import { useState } from 'react';
import { notificationPermission, notificationsSupported, requestNotificationPermission } from '../client/pairing';

export function NotificationSetting() {
  const [permission, setPermission] = useState(notificationPermission);
  if (!notificationsSupported() || permission !== 'default') return null;
  return <div className="settings-row">
    <span>Notify me about new requests<small className="device-meta">Shown when Webr is open in a hidden tab.</small></span>
    <button type="button" className="dialog-button" onClick={() => void requestNotificationPermission().then(setPermission)}>Turn on</button>
  </div>;
}
