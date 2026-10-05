import { useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { ImageUp } from 'lucide-react';
import type { Project } from '../lib/models';
import { resetProjectIcon, setProjectIcon } from '../client/thread-actions';

const iconSize = 128;

async function squarePng(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = iconSize;
  const scale = Math.min(iconSize / bitmap.width, iconSize / bitmap.height);
  const width = bitmap.width * scale; const height = bitmap.height * scale;
  canvas.getContext('2d')!.drawImage(bitmap, (iconSize - width) / 2, (iconSize - height) / 2, width, height);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not read this image.')), 'image/png'));
}

export function ProjectIconDialog({ project, open, onClose, onError }: { project: Project; open: boolean; onClose: () => void; onError: (error: unknown) => void }) {
  const picker = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); onClose(); } catch (error) { onError(error); } finally { setBusy(false); }
  };
  const upload = (file?: File) => { if (file) void run(async () => setProjectIcon(project, await squarePng(file))); };
  return <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Backdrop className="dialog-backdrop" />
      <Dialog.Popup className="dialog">
        <Dialog.Title className="dialog-message">Change icon for {project.name}</Dialog.Title>
        <button type="button" className={`icon-dropzone ${dragging ? 'is-dragging' : ''}`} disabled={busy} onClick={() => picker.current?.click()}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
          onDrop={(event) => { event.preventDefault(); setDragging(false); upload(event.dataTransfer.files[0]); }}>
          <ImageUp size={22} aria-hidden="true" />Drop an image here, or click to choose
        </button>
        <input ref={picker} type="file" accept="image/*" hidden onChange={(event) => { upload(event.target.files?.[0]); event.target.value = ''; }} />
        <div className="dialog-actions">
          <button type="button" className="dialog-button" disabled={busy} onClick={() => void run(() => resetProjectIcon(project))}>Reset to default</button>
          <Dialog.Close className="dialog-button">Cancel</Dialog.Close>
        </div>
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>;
}
