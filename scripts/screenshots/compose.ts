import sharp from 'sharp';
import { frame, KEYBOARD_HEIGHT, PHONE_HEIGHT, PHONE_WIDTH, STATUS_BAR_HEIGHT } from './frames';

const BACKDROP = '#131313';
const JPEG_QUALITY = 92;

export type PhoneFrame = { statusBar: string; keyboard: boolean };

export async function composePhone(appShot: string, { statusBar, keyboard }: PhoneFrame): Promise<Buffer> {
  const appHeight = PHONE_HEIGHT - STATUS_BAR_HEIGHT - (keyboard ? KEYBOARD_HEIGHT : 0);
  const app = await sharp(appShot).resize(PHONE_WIDTH, appHeight, { fit: 'fill' }).toBuffer();
  const layers = [{ input: frame(statusBar), top: 0, left: 0 }, { input: app, top: STATUS_BAR_HEIGHT, left: 0 }, ...(keyboard ? [{ input: frame('keyboard.png'), top: PHONE_HEIGHT - KEYBOARD_HEIGHT, left: 0 }] : [])];
  return sharp({ create: { width: PHONE_WIDTH, height: PHONE_HEIGHT, channels: 3, background: BACKDROP } }).composite(layers).jpeg({ quality: JPEG_QUALITY }).toBuffer();
}

export const asJpeg = (shot: string) => sharp(shot).jpeg({ quality: JPEG_QUALITY }).toBuffer();
