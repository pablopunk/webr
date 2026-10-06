import { useEffect, useRef, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { ImageUp } from 'lucide-react';
import type { Project } from '../lib/models';
import { ProjectIcon } from './ProjectIcon';
import { fetchIconCandidates, resetProjectIcon, setProjectIcon, type IconCandidateOption } from '../client/thread-actions';

const iconSize = 128;

async function squarePng(file: Blob): Promise<Blob> {
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
  const [candidates, setCandidates] = useState<IconCandidateOption[]>([]);
  useEffect(() => {
    if (!open) return;
    let current = true;
    void fetchIconCandidates(project).then((found) => { if (current) setCandidates(found); }).catch(() => {});
    return () => { current = false; setCandidates([]); };
  }, [open, project.id, project.machineId]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); onClose(); } catch (error) { onError(error); } finally { setBusy(false); }
  };
  const upload = (file?: File) => { if (file) void run(async () => setProjectIcon(project, await squarePng(file))); };
  const choose = (candidate: IconCandidateOption) => void run(async () => setProjectIcon(project, await squarePng(await (await fetch(candidate.url)).blob())));
  return <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Backdrop className="dialog-backdrop" />
      <Dialog.Popup className="dialog">
        <Dialog.Title className="dialog-message">Change icon for {project.name}</Dialog.Title>
        <div className="icon-current"><ProjectIcon project={project} /><span>Current icon</span></div>
        <button type="button" className={`icon-dropzone ${dragging ? 'is-dragging' : ''}`} disabled={busy} onClick={() => picker.current?.click()}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
          onDrop={(event) => { event.preventDefault(); setDragging(false); upload(event.dataTransfer.files[0]); }}>
          <ImageUp size={22} aria-hidden="true" />Drop an image here, or click to choose
        </button>
        <input ref={picker} type="file" accept="image/*" hidden onChange={(event) => { upload(event.target.files?.[0]); event.target.value = ''; }} />
        {candidates.length > 0 && <div className="icon-candidates" role="group" aria-label="Images found in this project">
          {candidates.map((candidate) => <button key={candidate.url} type="button" className="icon-candidate" disabled={busy} title={candidate.name} aria-label={`Use ${candidate.name}`} onClick={() => choose(candidate)}><img src={candidate.url} alt="" loading="lazy" /></button>)}
        </div>}
        <div className="dialog-actions">
          <button type="button" className="dialog-button" disabled={busy} onClick={() => void run(() => resetProjectIcon(project))}>Reset to default</button>
          <Dialog.Close className="dialog-button">Cancel</Dialog.Close>
        </div>
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>;
}
