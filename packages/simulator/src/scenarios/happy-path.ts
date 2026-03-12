import type { Scenario } from '../types.js';
import * as h from '../helpers.js';

export const happyPath: Scenario = {
  name: 'happy-path',
  description: 'Full agent lifecycle: think → read → edit → test → done',
  projectPath: '/tmp/hudai-sim-project',
  timeline: [
    // User prompt
    {
      delay: 500,
      label: '💬 User prompt',
      entries: [h.userPrompt('Implement user authentication with JWT')],
    },

    // Agent thinks + reads files
    {
      delay: 2000,
      label: '🧠 Agent thinking + reading files',
      entries: (() => {
        const readTool = h.readFile('src/routes/index.ts');
        return [
          h.assistantMessage([
            h.thinking('I need to implement JWT authentication. Let me first look at the existing route structure to understand the codebase.'),
            h.textBlock('Let me start by examining the existing route structure.'),
            readTool,
          ], { inputTokens: 8000, outputTokens: 2000 }),
        ];
      })(),
    },

    // Tool result for Read + more reads
    {
      delay: 1500,
      label: '📖 Reading more files',
      entries: (() => {
        const read1 = h.readFile('src/config/env.ts');
        const read2 = h.readFile('package.json');
        const grepTool = h.grep('jwt|jsonwebtoken|bcrypt');
        return [
          h.assistantMessage([
            h.thinking('Good, I can see the route structure. Let me check the config and dependencies.'),
            read1,
            read2,
            grepTool,
          ], { inputTokens: 12000, outputTokens: 1500 }),
        ];
      })(),
    },

    // Agent creates a plan via TodoWrite
    {
      delay: 2000,
      label: '📋 Creating plan',
      entries: (() => {
        const todo = h.todoWrite([
          { content: 'Create JWT auth middleware', status: 'in_progress' },
          { content: 'Add login/logout route handlers', status: 'pending' },
          { content: 'Write integration tests', status: 'pending' },
          { content: 'Update API documentation', status: 'pending' },
        ]);
        return [
          h.assistantMessage([
            h.textBlock('I\'ll create a plan for the implementation:'),
            todo,
          ], { inputTokens: 15000, outputTokens: 800 }),
        ];
      })(),
    },

    // Agent creates auth middleware
    {
      delay: 2500,
      label: '✏️  Creating auth middleware',
      entries: (() => {
        const writeTool = h.writeFile(
          'src/middleware/auth.ts',
          [
            'import jwt from "jsonwebtoken";',
            'import { Request, Response, NextFunction } from "express";',
            '',
            'export function authMiddleware(req: Request, res: Response, next: NextFunction) {',
            '  const token = req.headers.authorization?.replace("Bearer ", "");',
            '  if (!token) return res.status(401).json({ error: "No token" });',
            '  try {',
            '    const decoded = jwt.verify(token, process.env.JWT_SECRET!);',
            '    (req as any).user = decoded;',
            '    next();',
            '  } catch {',
            '    res.status(401).json({ error: "Invalid token" });',
            '  }',
            '}',
          ].join('\n'),
        );
        return [
          h.assistantMessage([
            h.thinking('Now I\'ll create the auth middleware with JWT validation.'),
            writeTool,
          ], { inputTokens: 18000, outputTokens: 3000 }),
        ];
      })(),
    },

    // Update plan + create routes
    {
      delay: 2000,
      label: '✏️  Creating auth routes',
      entries: (() => {
        const todo = h.todoWrite([
          { content: 'Create JWT auth middleware', status: 'completed' },
          { content: 'Add login/logout route handlers', status: 'in_progress' },
          { content: 'Write integration tests', status: 'pending' },
          { content: 'Update API documentation', status: 'pending' },
        ]);
        const writeTool = h.writeFile(
          'src/routes/auth.ts',
          [
            'import { Router } from "express";',
            'import jwt from "jsonwebtoken";',
            '',
            'const router = Router();',
            '',
            'router.post("/login", async (req, res) => {',
            '  const { email, password } = req.body;',
            '  // Validate credentials...',
            '  const token = jwt.sign({ email }, process.env.JWT_SECRET!, { expiresIn: "24h" });',
            '  res.json({ token });',
            '});',
            '',
            'router.post("/logout", (req, res) => {',
            '  res.json({ message: "Logged out" });',
            '});',
            '',
            'export default router;',
          ].join('\n'),
        );
        return [
          h.assistantMessage([todo, writeTool], { inputTokens: 22000, outputTokens: 2500 }),
        ];
      })(),
    },

    // Wire routes + edit existing file
    {
      delay: 1500,
      label: '✏️  Wiring routes into app',
      entries: [
        h.assistantMessage([
          h.editFile(
            'src/routes/index.ts',
            'export default router;',
            'import authRouter from "./auth";\nrouter.use("/auth", authRouter);\n\nexport default router;',
          ),
        ], { inputTokens: 25000, outputTokens: 800 }),
      ],
    },

    // Write tests
    {
      delay: 2000,
      label: '🧪 Writing tests',
      entries: (() => {
        const todo = h.todoWrite([
          { content: 'Create JWT auth middleware', status: 'completed' },
          { content: 'Add login/logout route handlers', status: 'completed' },
          { content: 'Write integration tests', status: 'in_progress' },
          { content: 'Update API documentation', status: 'pending' },
        ]);
        const writeTool = h.writeFile(
          'src/__tests__/auth.test.ts',
          [
            'import { describe, it, expect } from "vitest";',
            '',
            'describe("auth middleware", () => {',
            '  it("validates JWT token", () => { expect(true).toBe(true); });',
            '  it("rejects expired token", () => { expect(true).toBe(true); });',
            '  it("login returns token", () => { expect(true).toBe(true); });',
            '  it("logout invalidates session", () => { expect(true).toBe(true); });',
            '});',
          ].join('\n'),
        );
        return [
          h.assistantMessage([todo, writeTool], { inputTokens: 30000, outputTokens: 2000 }),
        ];
      })(),
    },

    // Run tests
    {
      delay: 1500,
      label: '🧪 Running tests',
      entries: (() => {
        const bashTool = h.bash('npm test');
        const bashId = h.getToolId(bashTool);
        return [
          h.assistantMessage([bashTool], { inputTokens: 32000, outputTokens: 500 }),
          // Tool result with test output
          h.toolResult(
            bashId,
            'stdout:\n  PASS  src/__tests__/auth.test.ts\n' +
            '    ✓ validates JWT token (12ms)\n' +
            '    ✓ rejects expired token (5ms)\n' +
            '    ✓ login returns token (23ms)\n' +
            '    ✓ logout invalidates session (8ms)\n\n' +
            '  Tests:  4 passed, 4 total\n  Time:   2.8s\n',
          ),
        ];
      })(),
    },

    // Update docs + complete
    {
      delay: 2500,
      label: '📝 Updating docs + completing',
      entries: (() => {
        const todo = h.todoWrite([
          { content: 'Create JWT auth middleware', status: 'completed' },
          { content: 'Add login/logout route handlers', status: 'completed' },
          { content: 'Write integration tests', status: 'completed' },
          { content: 'Update API documentation', status: 'completed' },
        ]);
        return [
          h.assistantMessage([
            h.editFile('README.md', '## API', '## API\n\n### Authentication\n- POST /auth/login\n- POST /auth/logout'),
            todo,
            h.textBlock('Done! I\'ve implemented JWT authentication with:\n- Auth middleware for token validation\n- Login/logout endpoints\n- 4 passing tests\n- Updated API docs'),
          ], { inputTokens: 38000, outputTokens: 1500 }),
        ];
      })(),
      // Agent is now idle — fire hook notification
      hooks: [h.hookIdle()],
    },
  ],
};
