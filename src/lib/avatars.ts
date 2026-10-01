import { botAvatarTypes } from 'bot-avatars';
import type { Thread } from './models';

export function avatarForThread(thread: Thread) {
  const index = thread.avatarIndex;
  const cycle = Math.floor(index / botAvatarTypes.length);
  return {
    type: botAvatarTypes[index % botAvatarTypes.length],
    color: cycle ? `hsl(${((cycle * 137.508) % 360).toFixed(3)} 72% 58%)` : undefined,
    seed: (index * 0.61803398875) % 1,
  };
}
