import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { carriesFiles, imageFilesFrom, uploadImagesAsTerminalText } from '../client/image-attach';
import type { ShowTerminalNotice } from './useTerminalNotice';

const ONLY_IMAGES = 'Only PNG, JPEG, GIF and WebP images can be attached.';
const attachingLabel = (count: number) => count === 1 ? 'Attaching image…' : `Attaching ${count} images…`;
const attachedLabel = (count: number) => count === 1 ? 'Image attached' : `${count} images attached`;

export function useImageAttachments({ machineId, active, writable, send, show }: { machineId: string; active: boolean; writable: RefObject<boolean>; send: (text: string) => void; show: ShowTerminalNotice }) {
  const [dragging, setDragging] = useState(false);
  const sendRef = useRef(send); sendRef.current = send;
  const attach = useCallback(async (files: File[]) => {
    if (!files.length) { show(ONLY_IMAGES, 'error', 4000); return; }
    if (!writable.current) { show('Wait until the terminal accepts input, then attach the image again.', 'error', 4000); return; }
    show(attachingLabel(files.length), 'info');
    try { sendRef.current(await uploadImagesAsTerminalText(machineId, files)); show(attachedLabel(files.length), 'info', 1500); }
    catch (error) { show(error instanceof Error ? error.message : 'The image could not be attached.', 'error', 5000); }
  }, [machineId, show, writable]);

  useEffect(() => {
    if (!active) return;
    let depth = 0;
    const enter = (event: DragEvent) => { if (!carriesFiles(event.dataTransfer)) return; event.preventDefault(); depth += 1; setDragging(true); };
    const over = (event: DragEvent) => { if (!carriesFiles(event.dataTransfer)) return; event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'; };
    const leave = (event: DragEvent) => { if (!carriesFiles(event.dataTransfer)) return; depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const drop = (event: DragEvent) => { if (!carriesFiles(event.dataTransfer)) return; event.preventDefault(); depth = 0; setDragging(false); void attach(imageFilesFrom(event.dataTransfer)); };
    window.addEventListener('dragenter', enter); window.addEventListener('dragover', over); window.addEventListener('dragleave', leave); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragenter', enter); window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); setDragging(false); };
  }, [active, attach]);
  return { dragging, attach };
}
