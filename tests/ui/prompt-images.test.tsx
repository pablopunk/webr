import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { usePromptImages } from '../../src/components/usePromptImages';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function Composer({ insert }: { insert: (text: string) => void }) {
  const images = usePromptImages({ machineId: 'local', insert });
  return <form aria-label="composer" className={images.dragging ? 'is-dropping' : ''} {...images.handlers}><textarea aria-label="prompt" />{images.status && <p>{images.status.text}</p>}</form>;
}
const transfer = (files: File[]) => ({ files, types: ['Files'], dropEffect: 'none' });
const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'shot.png', { type: 'image/png' });
it('inserts the uploaded image path into the prompt when an image is dropped or pasted', async () => {
  let count = 0; vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ path: `/u/image-${++count}.png` }) })));
  const insert = vi.fn(); render(<Composer insert={insert} />);
  fireEvent.dragEnter(screen.getByLabelText('composer'), { dataTransfer: transfer([png()]) }); expect(screen.getByLabelText('composer').className).toBe('is-dropping');
  fireEvent.drop(screen.getByLabelText('composer'), { dataTransfer: transfer([png()]) });
  await waitFor(() => expect(insert).toHaveBeenCalledWith('/u/image-1.png ')); expect(screen.getByLabelText('composer').className).toBe('');
  fireEvent.paste(screen.getByLabelText('prompt'), { clipboardData: { files: [png()], getData: () => '' } });
  await waitFor(() => expect(insert).toHaveBeenLastCalledWith('/u/image-2.png '));
});
it('leaves text pastes alone and explains a refused file', async () => {
  vi.stubGlobal('fetch', vi.fn()); const insert = vi.fn(); render(<Composer insert={insert} />);
  fireEvent.paste(screen.getByLabelText('prompt'), { clipboardData: { files: [], getData: () => 'plain text' } }); expect(fetch).not.toHaveBeenCalled();
  fireEvent.drop(screen.getByLabelText('composer'), { dataTransfer: transfer([new File(['x'], 'a.pdf', { type: 'application/pdf' })]) });
  await waitFor(() => expect(screen.getByText('Only PNG, JPEG, GIF and WebP images can be attached.')).toBeDefined()); expect(insert).not.toHaveBeenCalled();
});
