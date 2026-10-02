import { AlertDialog } from '@base-ui/react/alert-dialog';
import { usePendingPairRequests } from '../client/pairing';

export function PairingPrompt() {
  const { pending, decide } = usePendingPairRequests();
  const request = pending[0];
  return <AlertDialog.Root open={!!request} onOpenChange={(open) => { if (!open && request) void decide(request.id, 'deny'); }}>
    <AlertDialog.Portal>
      <AlertDialog.Backdrop className="dialog-backdrop" />
      <AlertDialog.Popup className="dialog pairing-prompt">
        {request && <>
          <AlertDialog.Title className="pairing-title">Allow {request.deviceName} to connect?</AlertDialog.Title>
          <AlertDialog.Description className="dialog-message">Only approve if this code matches the one shown on that device.</AlertDialog.Description>
          <div className="pairing-code" aria-label={`Code ${request.code}`}>{request.code}</div>
          {pending.length > 1 && <p className="settings-note">{pending.length - 1} more waiting</p>}
          <div className="dialog-actions">
            <button type="button" className="dialog-button" onClick={() => void decide(request.id, 'deny')}>Deny</button>
            <button type="button" autoFocus className="dialog-button is-primary" onClick={() => void decide(request.id, 'approve')}>Approve</button>
          </div>
        </>}
      </AlertDialog.Popup>
    </AlertDialog.Portal>
  </AlertDialog.Root>;
}
