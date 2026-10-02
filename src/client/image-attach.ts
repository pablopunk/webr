const attachableTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const MAX_ATTACHED_IMAGE_BYTES = 20 * 1024 * 1024;
const uploadErrors: Record<string, string> = {
  image_too_large: 'This image is larger than 20 MB.',
  unsupported_image: 'Only PNG, JPEG, GIF and WebP images can be attached.',
  uploads_unsupported_target: 'Images can be attached only on the Local machine for now.',
  machine_disconnected: 'The machine is not connected.',
};

export const isAttachableImage = (file: File) => attachableTypes.includes(file.type);
export const imageFilesFrom = (data: DataTransfer | null | undefined) => data?.files ? [...data.files].filter(isAttachableImage) : [];
export const carriesFiles = (data: DataTransfer | null | undefined) => !!data?.types && [...data.types].includes('Files');
export const escapePathForTerminal = (path: string) => path.replace(/([\s\\'"()&;$`!*?[\]{}<>|#~])/g, '\\$1');

export async function uploadImage(machineId: string, file: File): Promise<string> {
  if (!isAttachableImage(file)) throw new Error(uploadErrors.unsupported_image);
  if (file.size > MAX_ATTACHED_IMAGE_BYTES) throw new Error(uploadErrors.image_too_large);
  const response = await fetch(`/api/uploads?machineId=${encodeURIComponent(machineId)}`, { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
  const result = await response.json().catch(() => ({})) as { path?: string; error?: string };
  if (!response.ok || !result.path) throw new Error(uploadErrors[result.error ?? ''] ?? 'The image could not be attached.');
  return result.path;
}

export async function uploadImagesAsTerminalText(machineId: string, files: File[]) {
  const paths: string[] = [];
  for (const file of files) paths.push(await uploadImage(machineId, file));
  return paths.map(escapePathForTerminal).join(' ') + ' ';
}
