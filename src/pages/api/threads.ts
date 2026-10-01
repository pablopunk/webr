import type { APIRoute } from 'astro';
import { createThread } from '../../lib/mock-store';
import type { AgentKind } from '../../lib/models';

const agentKinds: AgentKind[] = ['claude', 'codex', 'opencode', 'pi'];

export const POST: APIRoute = async ({ request }) => {
  if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') {
    return Response.json({ error: 'Expected JSON' }, { status: 415 });
  }
  try {
    const origin = request.headers.get('origin');
    if (origin && new URL(origin).host !== new URL(request.url).host) {
      return Response.json({ error: 'Invalid origin' }, { status: 403 });
    }
    const data: unknown = await request.json();
    if (!data || typeof data !== 'object') throw new Error('Invalid request');
    const input = data as Record<string, unknown>;
    if (typeof input.title !== 'string' || typeof input.projectId !== 'string' ||
      typeof input.agent !== 'string' || !agentKinds.includes(input.agent as AgentKind) ||
      typeof input.worktree !== 'boolean') throw new Error('Invalid thread details');
    const thread = await createThread({
      title: input.title, projectId: input.projectId,
      agent: input.agent as AgentKind, worktree: input.worktree,
    });
    return Response.json({ id: thread.id }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Could not create thread' }, { status: 400 });
  }
};
