import { SocketApi } from '../src/server/protocol/socket';
import { discoverLocalSession } from '../src/server/transport/local-session';
import { localSocket, type TargetProfile } from '../src/server/transport/registry';

const NOT_INSTALLED = 'Herdr was not found. Install Herdr and make sure the "herdr" command is on your PATH, then try again.';
const NOT_RUNNING = 'Herdr is not running yet. Webr will start its default session when it connects.';

const UNRESPONSIVE = 'A Herdr session exists but does not answer. Quit Herdr, then start it again.';

const problems: [match: string, advice: string][] = [
  ['ENOENT', NOT_INSTALLED],
  ['multiple_herdr_sessions', 'More than one Herdr session is running. Start Webr from the session you want, or set HERDR_SESSION to its name.'],
  ['herdr_session_unreachable', UNRESPONSIVE],
  ['rpc_timeout', UNRESPONSIVE],
  ['missing_default_session', 'Herdr has no default session. Start Herdr once, then try again.'],
];

export const describeHerdrProblem = (error: unknown) => {
  const text = `${(error as NodeJS.ErrnoException).code ?? ''} ${error instanceof Error ? error.message : String(error)}`;
  return problems.find(([match]) => text.includes(match))?.[1] ?? `Webr could not reach Herdr: ${text.trim()}`;
};

async function answers(profile: TargetProfile) {
  const api = new SocketApi(localSocket(profile));
  try { await api.request('ping'); return true; }
  catch (error) { if (['ENOENT', 'ECONNREFUSED'].includes((error as NodeJS.ErrnoException).code ?? '')) return false; throw error; }
  finally { api.close(); }
}

export type HerdrStatus = { ok: true; note?: string } | { ok: false; problem: string };

export async function checkHerdr(discover: () => Promise<TargetProfile> = () => discoverLocalSession(), ping: (profile: TargetProfile) => Promise<boolean> = answers): Promise<HerdrStatus> {
  try {
    const profile = await discover();
    return profile.transport !== 'local' || await ping(profile) ? { ok: true } : { ok: true, note: NOT_RUNNING };
  } catch (error) { return { ok: false, problem: describeHerdrProblem(error) }; }
}
