import { fileURLToPath } from 'node:url';

export const FRAME_DIRECTORY = fileURLToPath(new URL('./frames', import.meta.url));
export const PHONE_WIDTH = 942;
export const PHONE_HEIGHT = 2048;
export const STATUS_BAR_HEIGHT = 142;
export const KEYBOARD_HEIGHT = 930;
export const PHONE_CSS_WIDTH = 430;
export const PHONE_SCALE = PHONE_WIDTH / PHONE_CSS_WIDTH;
export const cssHeight = (pixels: number) => Math.round(pixels / PHONE_SCALE);
export const frame = (name: string) => `${FRAME_DIRECTORY}/${name}`;
