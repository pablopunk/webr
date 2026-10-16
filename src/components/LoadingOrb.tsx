import { BotAvatar } from 'bot-avatars';

export function LoadingOrbVisual({ size = 128 }: { size?: number }) {
  return <span className="loading-orb-visual" style={{ width: size, height: size }} aria-hidden="true">
    <BotAvatar type="circle" color="#9A62FF" state="working" size={Math.round(size * 0.68)} speed={0.85} whirl={1} interactive={false} aria-hidden="true" />
  </span>;
}

export function LoadingOrb({ title, detail, size }: { title: string; detail?: string; size?: number }) {
  return <div className="loading-orb" role="status" aria-live="polite" aria-busy="true">
    <LoadingOrbVisual size={size} />
    <div className="loading-orb-copy">
      <h1>{title}</h1>
      {detail && <p>{detail}</p>}
    </div>
  </div>;
}
