import type { TargetProfile } from '../transport/registry';
export function assertValidationConsent(env: NodeJS.ProcessEnv, consent: boolean, profile: TargetProfile) {
  if (env.HERDR_ENV !== '1' || !env.HERDR_PANE_ID || !env.HERDR_SOCKET_PATH) throw new Error('Live validation requires a genuine managed caller context; do not set HERDR_ENV yourself');
  if (!consent) throw new Error('Explicit --consent is required before creating test resources');
  if (!profile.enabled) throw new Error('The selected approved target is disabled');
  if (!['local', 'ssh'].includes(profile.transport)) throw new Error('Only Linux/macOS local or SSH targets are supported');
}
