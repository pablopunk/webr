import { useState } from 'react';
import { herdrAgentKinds } from '../shared/agent-kinds';

export function HarnessIcon({ harness, size = 14 }: { harness: string | undefined; size?: number }) {
  const [failed, setFailed] = useState(false);
  const name = harness ?? '';
  return <span className="harness-icon" style={{ width: size, height: size }} aria-hidden="true">
    {herdrAgentKinds.includes(name) && !failed
      ? <img src={`/harness-icons/${name}.png`} alt="" width={size} height={size} onError={() => setFailed(true)} />
      : <span className="harness-icon-letter">{name.charAt(0).toUpperCase()}</span>}
  </span>;
}
