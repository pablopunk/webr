import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { FRAME_DIRECTORY, KEYBOARD_HEIGHT, PHONE_WIDTH, STATUS_BAR_HEIGHT } from './frames';

const brand = (name: string) => fileURLToPath(new URL(`../../assets/brand/${name}`, import.meta.url));
const statusBars = { 'status-sidebar.png': 'sidebar.jpg', 'status-typing.png': 'typing.jpg', 'status-cmdk.png': 'cmdk.jpg' };

for (const [frame, source] of Object.entries(statusBars)) await sharp(brand(source)).extract({ left: 0, top: 0, width: PHONE_WIDTH, height: STATUS_BAR_HEIGHT }).toFile(`${FRAME_DIRECTORY}/${frame}`);
await sharp(brand('typing.jpg')).extract({ left: 0, top: 2048 - KEYBOARD_HEIGHT, width: PHONE_WIDTH, height: KEYBOARD_HEIGHT }).toFile(`${FRAME_DIRECTORY}/keyboard.png`);
