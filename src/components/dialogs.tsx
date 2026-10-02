import { createRoot, type Root } from 'react-dom/client';
import { AlertDialog } from '@base-ui/react/alert-dialog';

type DialogRequest = { message: string; confirmLabel: string; cancelLabel?: string; danger?: boolean; resolve: (accepted: boolean) => void };
type ConfirmOptions = { confirmLabel?: string; danger?: boolean };

let root: Root | undefined;
let showing: DialogRequest | undefined;
const show = (request: DialogRequest) => {
  root ??= createRoot(document.body.appendChild(document.createElement('div')));
  showing?.resolve(false);
  showing = request;
  const settle = (accepted: boolean) => { if (showing !== request) return; showing = undefined; root?.render(null); request.resolve(accepted); };
  root.render(<DialogView request={request} settle={settle} />);
};

function DialogView({ request, settle }: { request: DialogRequest; settle: (accepted: boolean) => void }) {
  return <AlertDialog.Root open onOpenChange={(open) => { if (!open) settle(false); }}>
    <AlertDialog.Portal>
      <AlertDialog.Backdrop className="dialog-backdrop" />
      <AlertDialog.Popup className="dialog">
        <AlertDialog.Description className="dialog-message">{request.message}</AlertDialog.Description>
        <div className="dialog-actions">
          {request.cancelLabel && <AlertDialog.Close className="dialog-button">{request.cancelLabel}</AlertDialog.Close>}
          <button type="button" autoFocus className={`dialog-button is-primary ${request.danger ? 'is-danger' : ''}`} onClick={() => settle(true)}>{request.confirmLabel}</button>
        </div>
      </AlertDialog.Popup>
    </AlertDialog.Portal>
  </AlertDialog.Root>;
}

export const confirmDialog = (message: string, { confirmLabel = 'Confirm', danger = false }: ConfirmOptions = {}) =>
  new Promise<boolean>((resolve) => show({ message, confirmLabel, cancelLabel: 'Cancel', danger, resolve }));
export const alertDialog = (message: string) =>
  new Promise<void>((resolve) => show({ message, confirmLabel: 'OK', resolve: () => resolve() }));
