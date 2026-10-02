import { botAvatarTypes } from 'bot-avatars';
import type { Thread } from './models';

const GOLDEN_ANGLE_DEGREES = 137.508;

const hueFarFromThePreviousThread = (index: number) => ((index * GOLDEN_ANGLE_DEGREES) % 360).toFixed(3);

export function avatarForThread(thread: Thread) {
  const index = thread.avatarIndex;
  return {
    type: botAvatarTypes[index % botAvatarTypes.length],
    color: `hsl(${hueFarFromThePreviousThread(index)} 72% 58%)`,
    seed: (index * 0.61803398875) % 1,
  };
}
