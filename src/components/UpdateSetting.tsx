import { useUpdate } from '../client/update';

export function UpdateSetting() {
  const { status, updating, checking, checkNow, requestUpdate } = useUpdate();
  const upToDate = status && !status.available;
  return <section><h2>Updates</h2><div className="settings-row">
    <span>{status ? `Webr ${status.current}` : 'Webr'}<small className="device-meta">{status?.available ? `Version ${status.latest} is available.` : upToDate ? 'You are on the latest version.' : 'Checking for updates…'}</small></span>
    {status?.available
      ? <button type="button" className="dialog-button is-primary" disabled={updating} onClick={() => void requestUpdate()}>{updating ? 'Updating…' : `Update to ${status.latest}`}</button>
      : <button type="button" className="dialog-button" disabled={checking || !status} onClick={() => void checkNow()}>{checking ? 'Checking…' : 'Check for updates'}</button>}
  </div></section>;
}
