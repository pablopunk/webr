import type { APIRoute } from 'astro';
import { projects } from '../../../../lib/models';
import { findProjectIcon } from '../../../../lib/project-icons';

export const GET: APIRoute = async ({ params }) => {
  const project = projects.find((item) => item.id === params.id);
  if (!project) return new Response(null, { status: 404 });
  const icon = await findProjectIcon(project);
  if (!icon) return new Response(null, { status: 404 });
  return new Response(icon.bytes, {
    headers: {
      'Content-Type': icon.contentType,
      'Cache-Control': 'private, max-age=60',
      'X-Content-Type-Options': 'nosniff',
      ...(icon.contentType === 'image/svg+xml' ? { 'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'" } : {}),
    },
  });
};
