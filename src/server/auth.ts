import { betterAuth } from 'better-auth';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import type { MetadataDatabase } from './storage/database';

export function createAuth(database: MetadataDatabase, origin: string, secret: string, provisioning = false) {
  if (secret.length < 32) throw new Error('auth_secret_too_short');
  const auth = betterAuth({
    database: database.sqlite,
    baseURL: origin,
    secret,
    emailAndPassword: { enabled: true, disableSignUp: !provisioning, minPasswordLength: 16 },
    trustedOrigins: [origin],
    disabledPaths: provisioning ? [] : ['/sign-up/email', '/change-email', '/delete-user', '/forget-password', '/reset-password'],
    session: { expiresIn: 8 * 60 * 60, cookieCache: { enabled: false } },
    advanced: { useSecureCookies: true, defaultCookieAttributes: { httpOnly: true, sameSite: 'strict', secure: true } },
    logger: { disabled: true },
  });
  async function authenticate(headers: IncomingHttpHeaders) {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(headers) });
    if (!session || session.user.id !== database.getSetting('allowed_account')) return null;
    return { accountId: session.user.id, sessionId: session.session.id, expiresAt: session.session.expiresAt };
  }
  return { auth, authenticate };
}
export type GatewayAuth = ReturnType<typeof createAuth>;
