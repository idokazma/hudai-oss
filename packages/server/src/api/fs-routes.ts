import type { FastifyInstance } from 'fastify';
import { completePath, scanRecentProjects } from '../fs/path-completer.js';
import type { SessionStore } from '../persistence/event-store.js';

export function registerFsRoutes(fastify: FastifyInstance, sessionStore: SessionStore): void {
  // Autocomplete: GET /api/fs/complete?path=/home/user/Des → matching directories
  fastify.get('/api/fs/complete', async (request) => {
    const { path: partial } = request.query as { path?: string };
    const suggestions = await completePath(partial || '');
    return { suggestions };
  });

  // Recent projects: GET /api/fs/projects → past sessions + scanned git repos
  fastify.get('/api/fs/projects', async () => {
    const sessions = sessionStore.list();
    const pastPaths = sessions
      .filter((s) => s.mode === 'stream' || s.projectPath.startsWith('/'))
      .map((s) => s.projectPath)
      .filter((p, i, arr) => arr.indexOf(p) === i);
    const projects = await scanRecentProjects(pastPaths);
    return { projects };
  });
}
