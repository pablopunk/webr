import { useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { carriesFiles, imageFilesFrom, uploadImagesAsTerminalText } from '../client/image-attach';

export function usePromptImages({ machineId, insert }: { machineId: string; insert: (text: string) => void }) {
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<{ text: string; tone: 'info' | 'error' } | null>(null);
  const depth = useRef(0);
  const attach = async (files: File[]) => {
    if (!files.length) { setStatus({ text: 'Only PNG, JPEG, GIF and WebP images can be attached.', tone: 'error' }); return; }
    setStatus({ text: files.length === 1 ? 'Attaching image…' : `Attaching ${files.length} images…`, tone: 'info' });
    try { insert(await uploadImagesAsTerminalText(machineId, files)); setStatus(null); }
    catch (error) { setStatus({ text: error instanceof Error ? error.message : 'The image could not be attached.', tone: 'error' }); }
  };
  const handlers = {
    onDragEnter: (event: DragEvent) => { if (!carriesFiles(event.dataTransfer)) return; event.preventDefault(); depth.current += 1; setDragging(true); },
    onDragOver: (event: DragEvent) => { if (!carriesFiles(event.dataTransfer)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; },
    onDragLeave: (event: DragEvent) => { if (!carriesFiles(event.dataTransfer)) return; depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); },
    onDrop: (event: DragEvent) => { if (!carriesFiles(event.dataTransfer)) return; event.preventDefault(); depth.current = 0; setDragging(false); void attach(imageFilesFrom(event.dataTransfer)); },
    onPaste: (event: ClipboardEvent) => { const images = imageFilesFrom(event.clipboardData); if (!images.length) return; event.preventDefault(); void attach(images); },
  };
  return { dragging, status, handlers };
}
