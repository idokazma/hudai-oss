import type { FastifyInstance } from 'fastify';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { WS_PORT } from '@hudai/shared';
import type { HooksHandler } from '../hooks/hooks-handler.js';
import type { ActivityUpdate } from '../hooks/hooks-handler.js';
import type { SessionMonitor } from '../swarm/session-monitor.js';

const CLAUDE_SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');
const HUDAI_HOOK_URL = `http://localhost:${WS_PORT}/api/hooks/notification`;

export interface HooksRouteContext {
  hooksHandler: HooksHandler;
  getHooksActive: () => boolean;
  setHooksActive: (v: boolean) => void;
  setLastHookActivityAt: (v: number) => void;
  applyActivityUpdate: (update: ActivityUpdate) => void;
  getSessionMonitor: () => SessionMonitor | null;
}

export function registerHooksRoutes(fastify: FastifyInstance, ctx: HooksRouteContext): void {
  fastify.post('/api/hooks/notification', async (request, reply) => {
    const body = request.body as Record<string, any> | undefined;
    if (!body || typeof body !== 'object') {
      return reply.status(400).send({ error: 'Invalid request body' });
    }

    if (!ctx.getHooksActive()) {
      ctx.setHooksActive(true);
      console.log('[hooks] First notification received — hooks are now the primary activity source');
    }
    ctx.setLastHookActivityAt(Date.now());

    const update = ctx.hooksHandler.handleNotification({
      matcher: body.matcher || body.type || '',
      message: body.message,
      tool: body.tool,
      command: body.command,
      question: body.question,
      options: body.options,
    });

    if (update) {
      ctx.applyActivityUpdate(update);
      const monitor = ctx.getSessionMonitor();
      if (monitor) {
        monitor.applyHookUpdate(update);
      }
    }

    return { ok: true };
  });

  fastify.post('/api/hooks/working', async () => {
    if (!ctx.getHooksActive()) {
      ctx.setHooksActive(true);
    }
    ctx.setLastHookActivityAt(Date.now());
    ctx.applyActivityUpdate({ activity: 'working', detail: undefined });
    const monitor = ctx.getSessionMonitor();
    if (monitor) {
      monitor.applyHookUpdate({ activity: 'working' });
    }
    return { ok: true };
  });

  fastify.get('/api/hooks/status', async () => {
    return checkHooksInstalled(ctx.getHooksActive());
  });

  fastify.post('/api/hooks/install', async () => {
    let settings: Record<string, any> = {};
    try {
      const content = await readFile(CLAUDE_SETTINGS_PATH, 'utf-8');
      settings = JSON.parse(content);
    } catch {
      // File doesn't exist or isn't valid JSON — start fresh
    }

    if (!settings.hooks) settings.hooks = {};
    if (!Array.isArray(settings.hooks.Notification)) settings.hooks.Notification = [];

    const existing = settings.hooks.Notification.some((h: any) => {
      const cmd = h.command || '';
      return cmd.includes('/api/hooks/notification');
    });

    if (!existing) {
      settings.hooks.Notification.push({
        matcher: '',
        command: `curl -s -X POST ${HUDAI_HOOK_URL} -H 'Content-Type: application/json' -d '$CLAUDE_NOTIFICATION'`,
      });
    }

    await writeFile(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2));
    return { ok: true, installed: true };
  });

  fastify.post('/api/hooks/uninstall', async () => {
    try {
      const content = await readFile(CLAUDE_SETTINGS_PATH, 'utf-8');
      const settings = JSON.parse(content);
      if (Array.isArray(settings?.hooks?.Notification)) {
        settings.hooks.Notification = settings.hooks.Notification.filter((h: any) => {
          const cmd = h.command || '';
          return !cmd.includes('/api/hooks/notification');
        });
        if (settings.hooks.Notification.length === 0) {
          delete settings.hooks.Notification;
        }
        if (Object.keys(settings.hooks).length === 0) {
          delete settings.hooks;
        }
      }
      await writeFile(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2));
    } catch {
      // Settings file doesn't exist — nothing to uninstall
    }
    return { ok: true, installed: false };
  });
}

async function checkHooksInstalled(hooksActive: boolean): Promise<{ installed: boolean; hooksActive: boolean }> {
  try {
    const content = await readFile(CLAUDE_SETTINGS_PATH, 'utf-8');
    const settings = JSON.parse(content);
    const hooks = settings?.hooks?.Notification;
    if (!Array.isArray(hooks)) return { installed: false, hooksActive };
    const hasHudai = hooks.some((h: any) => {
      const cmd = h.command || '';
      const url = h.url || '';
      return cmd.includes('localhost') && cmd.includes('/api/hooks/') ||
             url.includes('localhost') && url.includes('/api/hooks/');
    });
    return { installed: hasHudai, hooksActive };
  } catch {
    return { installed: false, hooksActive };
  }
}
