import { useCallback, useEffect, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Check, Copy } from 'lucide-react';
import { writeClipboardText } from '../client/terminal-clipboard';
import { QrCode } from './QrCode';
import { confirmDialog } from './dialogs';
import { createInvite, listDevices, relativeTime, revokeDevice, type Device, type Invite } from '../client/pairing';

function InviteDialog({ invite, onClose }: { invite: Invite; onClose: () => void }) {
  const [urlIndex, setUrlIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const url = invite.urls[urlIndex];
  const copy = () => writeClipboardText(invite.token).then((ok) => { if (!ok) return; setCopied(true); setTimeout(() => setCopied(false), 1500); });
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Backdrop className="dialog-backdrop" />
      <Dialog.Popup className="dialog pairing-invite">
        <Dialog.Title className="pairing-title">Connect a device</Dialog.Title>
        {url
          ? <><Dialog.Description className="dialog-message">Scan with the device’s camera, or open Webr there and enter the code.</Dialog.Description>
            <QrCode value={url} label="QR code to connect a device" />
            {invite.urls.length > 1 && <div className="theme-control theme-control--labels" role="group" aria-label="Address">{invite.urls.map((address, index) => <button key={address} type="button" aria-pressed={index === urlIndex} className={index === urlIndex ? 'theme-option is-selected' : 'theme-option'} onClick={() => setUrlIndex(index)}>{new URL(address).host}</button>)}</div>}</>
          : <Dialog.Description className="dialog-message">Webr only listens on this computer. Restart it with <code>--lan</code> or <code>--origin &lt;url&gt;</code> so other devices can reach it.</Dialog.Description>}
        <div className="pairing-token"><code>{invite.token}</code><button type="button" className="dialog-button" onClick={() => void copy()} aria-label="Copy code">{copied ? <Check size={14} /> : <Copy size={14} />}</button></div>
        <p className="settings-note">Works once and expires in 5 minutes.</p>
        <div className="dialog-actions"><Dialog.Close className="dialog-button is-primary">Done</Dialog.Close></div>
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>;
}

export function RemoteAccess() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [invite, setInvite] = useState<Invite>();
  const [error, setError] = useState('');
  const refresh = useCallback(() => listDevices().then(setDevices, () => undefined), []);
  useEffect(() => { void refresh(); }, [refresh]);

  const showInvite = () => createInvite().then((created) => { setError(''); setInvite(created); }, (failure: Error) => setError(failure.message));
  const revoke = async (device: Device) => {
    if (!await confirmDialog(`Disconnect ${device.name}? It will need to be approved again.`, { confirmLabel: 'Disconnect', danger: true })) return;
    await revokeDevice(device.id);
    if (device.current) location.reload(); else await refresh();
  };

  return <section id="remote-access">
    <div className="settings-section-title"><h2>Remote access</h2></div>
    <p className="settings-note">Other devices ask to connect and you approve them here. This computer never needs a code.</p>
    <div className="settings-row"><span>Connect a device</span><button type="button" className="dialog-button" onClick={() => void showInvite()}>Show code</button></div>
    {error && <p role="alert" className="form-error">{error}</p>}
    {devices.map((device) => <div className="settings-row" key={device.id}>
      <span>{device.name}{device.current && <em className="device-tag">This device</em>}<small className="device-meta">Active {relativeTime(device.lastSeenAt)}</small></span>
      <button type="button" className="dialog-button" onClick={() => void revoke(device)}>Disconnect</button>
    </div>)}
    {invite && <InviteDialog invite={invite} onClose={() => setInvite(undefined)} />}
  </section>;
}
