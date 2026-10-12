import { BotAvatar } from 'bot-avatars';
import type { Thread } from '../lib/models';
import { avatarForThread } from '../lib/avatars';

const FACE_FORWARD = 0;

export function ThreadAvatar({ thread, working, size }: { thread: Thread; working: boolean; size: number }) {
  return <BotAvatar {...avatarForThread(thread)} state={working ? 'working' : 'default'} size={size} paused turn={working ? undefined : FACE_FORWARD} />;
}
