import type { APIRoute } from 'astro';
import { createThread } from '../../lib/mock-store';

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
    if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 8000 ||
      typeof input.projectId !== 'string' || typeof input.agent !== 'string' ||
      !input.agent.trim() || input.agent.length > 80 || /[\x00-\x1f\x7f]/.test(input.agent) ||
      typeof input.model !== 'string' || !input.model.trim() || input.model.length > 120 ||
      /[\x00-\x1f\x7f]/.test(input.model) ||
      typeof input.worktree !== 'boolean') throw new Error('Invalid thread details');
    const thread = await createThread({
      prompt: input.prompt, projectId: input.projectId,
      agent: input.agent, model: input.model, worktree: input.worktree,
    });
    return Response.json({ id: thread.id }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Could not create thread' }, { status: 400 });
  }
};
