import { useState } from 'react';
import { herdrAgentKinds } from '../shared/agent-kinds';

export function HarnessIcon({ harness, size = 14 }: { harness: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  return <span className="harness-icon" style={{ width: size, height: size }} aria-hidden="true">
    {herdrAgentKinds.includes(harness) && !failed
      ? <img src={`/harness-icons/${harness}.png`} alt="" width={size} height={size} onError={() => setFailed(true)} />
      : <span className="harness-icon-letter">{harness.charAt(0).toUpperCase()}</span>}
  </span>;
}
