import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { promptWithImages, usePromptImages } from '../../src/components/usePromptImages';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function Composer() {
  const images = usePromptImages({ machineId: 'local' });
  return <form aria-label="composer" className={images.dragging ? 'is-dropping' : ''} {...images.handlers}>
    <ul aria-label="Attached images">{images.attachments.map((image) => <li key={image.id}><img src={image.preview} alt={image.name} /><button type="button" onClick={() => images.remove(image.id)}>Remove {image.name}</button></li>)}</ul>
    <textarea aria-label="prompt" /><output aria-label="payload">{promptWithImages('Describe these', images.attachments)}</output>
    {images.uploading > 0 && <p>Uploading</p>}{images.error && <p>{images.error}</p>}
  </form>;
}
const transfer = (files: File[]) => ({ files, types: ['Files'], dropEffect: 'none' });
const png = (name = 'shot.png') => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: 'image/png' });
it('shows dropped and pasted images as thumbnails and adds their paths only to the sent prompt', async () => {
  let count = 0; vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ path: `/u/image ${++count}.png` }) })));
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:preview', revokeObjectURL: vi.fn() }));
  render(<Composer />);
  fireEvent.dragEnter(screen.getByLabelText('composer'), { dataTransfer: transfer([png()]) }); expect(screen.getByLabelText('composer').className).toBe('is-dropping');
  fireEvent.drop(screen.getByLabelText('composer'), { dataTransfer: transfer([png('first.png')]) });
  await waitFor(() => expect(screen.getByAltText('first.png')).toBeDefined()); expect(screen.getByLabelText('composer').className).toBe('');
  fireEvent.paste(screen.getByLabelText('prompt'), { clipboardData: { files: [png('second.png')], getData: () => '' } });
  await waitFor(() => expect(screen.getByAltText('second.png')).toBeDefined());
  expect(screen.getByLabelText('payload').textContent).toBe('Describe these /u/image\\ 1.png /u/image\\ 2.png');
  fireEvent.click(screen.getByText('Remove first.png')); expect(screen.queryByAltText('first.png')).toBeNull();
  expect(screen.getByLabelText('payload').textContent).toBe('Describe these /u/image\\ 2.png');
});
it('leaves text pastes alone and explains a refused file', async () => {
  vi.stubGlobal('fetch', vi.fn()); render(<Composer />);
  fireEvent.paste(screen.getByLabelText('prompt'), { clipboardData: { files: [], getData: () => 'plain text' } }); expect(fetch).not.toHaveBeenCalled();
  fireEvent.drop(screen.getByLabelText('composer'), { dataTransfer: transfer([new File(['x'], 'a.pdf', { type: 'application/pdf' })]) });
  await waitFor(() => expect(screen.getByText('Only PNG, JPEG, GIF and WebP images can be attached.')).toBeDefined());
});
