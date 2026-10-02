import { useRef, useState, type ClipboardEvent, type DragEvent } from 'react';
import { carriesFiles, escapePathForTerminal, imageFilesFrom, thumbnailDataUrl, uploadImage } from '../client/image-attach';
import { uuid } from '../lib/uuid';

export type PromptImage = { id: string; name: string; preview: string; path: string };
const ONLY_IMAGES = 'Only PNG, JPEG, GIF and WebP images can be attached.';

export const promptWithImages = (prompt: string, images: PromptImage[]) => [prompt.trim(), ...images.map((image) => escapePathForTerminal(image.path))].filter(Boolean).join(' ');

export function usePromptImages({ machineId }: { machineId: string }) {
  const [dragging, setDragging] = useState(false);
  const [attachments, setAttachments] = useState<PromptImage[]>([]);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState('');
  const depth = useRef(0);
  const attach = async (files: File[]) => {
    if (!files.length) { setError(ONLY_IMAGES); return; }
    setError(''); setUploading((count) => count + files.length);
    for (const file of files) {
      try {
        const path = await uploadImage(machineId, file); const preview = await thumbnailDataUrl(file);
        setAttachments((current) => [...current, { id: uuid(), name: file.name || 'image', preview, path }]);
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'The image could not be attached.'); }
      finally { setUploading((count) => count - 1); }
    }
  };
  const remove = (id: string) => setAttachments((current) => current.filter((image) => image.id !== id));
  const handlers = {
    onDragEnter: (event: DragEvent) => { if (!carriesFiles(event.dataTransfer)) return; event.preventDefault(); depth.current += 1; setDragging(true); },
    onDragOver: (event: DragEvent) => { if (!carriesFiles(event.dataTransfer)) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; },
    onDragLeave: (event: DragEvent) => { if (!carriesFiles(event.dataTransfer)) return; depth.current = Math.max(0, depth.current - 1); if (!depth.current) setDragging(false); },
    onDrop: (event: DragEvent) => { if (!carriesFiles(event.dataTransfer)) return; event.preventDefault(); depth.current = 0; setDragging(false); void attach(imageFilesFrom(event.dataTransfer)); },
    onPaste: (event: ClipboardEvent) => { const images = imageFilesFrom(event.clipboardData); if (!images.length) return; event.preventDefault(); void attach(images); },
  };
  return { dragging, attachments, setAttachments, uploading, error, remove, handlers };
}
