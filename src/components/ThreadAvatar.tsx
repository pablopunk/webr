import { useEffect, useState } from 'react';
import { BotAvatar } from 'bot-avatars';
import type { Thread } from '../lib/models';
import { avatarForThread } from '../lib/avatars';

const TIME_FOR_A_JUMP_TO_LAND_MS = 2000;

function usePauseAfterLanding(working: boolean) {
  const [paused, setPaused] = useState(!working);
  useEffect(() => {
    if (working) { setPaused(false); return; }
    const timer = setTimeout(() => setPaused(true), TIME_FOR_A_JUMP_TO_LAND_MS);
    return () => clearTimeout(timer);
  }, [working]);
  return paused;
}

export function ThreadAvatar({ thread, working, size }: { thread: Thread; working: boolean; size: number }) {
  const paused = usePauseAfterLanding(working);
  return <BotAvatar {...avatarForThread(thread)} state={working ? 'working' : 'default'} size={size} paused={paused} />;
}
