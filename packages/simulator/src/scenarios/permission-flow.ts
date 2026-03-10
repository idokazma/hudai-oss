import type { Scenario } from '../types.js';
import * as h from '../helpers.js';

export const permissionFlow: Scenario = {
  name: 'permission-flow',
  description: 'Agent reads, edits, runs bash — triggers permission checks',
  projectPath: '/tmp/hudai-sim-project',
  timeline: [
    {
      delay: 500,
      label: '💬 User prompt',
      entries: [h.userPrompt('Refactor database queries to use parameterized statements')],
    },

    // Think + read
    {
      delay: 2000,
      label: '🧠 Analyzing codebase',
      entries: [
        h.assistantMessage([
          h.thinking('I need to find all SQL queries that use string concatenation and convert them to parameterized queries to prevent SQL injection.'),
          h.readFile('src/db/queries.ts'),
          h.readFile('src/db/connection.ts'),
          h.grep('db\\.query|\\$\\{'),
        ], { inputTokens: 10000, outputTokens: 1800 }),
      ],
    },

    // Bash command (will trigger permission if not auto-allowed)
    {
      delay: 2500,
      label: '📦 Installing dependency (Bash permission)',
      entries: (() => {
        const bashTool = h.bash('npm install pg-parameterize --save');
        return [
          h.assistantMessage([
            h.textBlock('I\'ll install a helper library for parameterized queries.'),
            bashTool,
          ], { inputTokens: 15000, outputTokens: 600 }),
        ];
      })(),
      hooks: [h.hookPermission('Bash', 'npm install pg-parameterize --save')],
    },

    // Edit files
    {
      delay: 3000,
      label: '✏️  Refactoring queries',
      entries: [
        h.assistantMessage([
          h.editFile(
            'src/db/queries.ts',
            'db.query(`SELECT * FROM users WHERE id = ${userId}`)',
            'db.query("SELECT * FROM users WHERE id = $1", [userId])',
          ),
          h.editFile(
            'src/db/queries.ts',
            'db.query(`INSERT INTO posts (title, body) VALUES (\'${title}\', \'${body}\')`)',
            'db.query("INSERT INTO posts (title, body) VALUES ($1, $2)", [title, body])',
          ),
        ], { inputTokens: 20000, outputTokens: 2000 }),
      ],
    },

    // Write a new file (will trigger Write permission)
    {
      delay: 2000,
      label: '✏️  Creating db config (Write permission)',
      entries: [
        h.assistantMessage([
          h.writeFile('src/db/config.json', JSON.stringify({
            pool: { max: 20, idleTimeoutMs: 30000 },
            parameterize: true,
          }, null, 2)),
        ], { inputTokens: 22000, outputTokens: 800 }),
      ],
      hooks: [h.hookPermission('Write', 'src/db/config.json')],
    },

    // Run tests
    {
      delay: 2000,
      label: '🧪 Running tests',
      entries: (() => {
        const bashTool = h.bash('npm test');
        const bashId = h.getToolId(bashTool);
        return [
          h.assistantMessage([bashTool], { inputTokens: 25000, outputTokens: 400 }),
          h.toolResult(
            bashId,
            'stdout:\n  PASS  src/__tests__/queries.test.ts\n' +
            '  Tests:  8 passed, 8 total\n  Time:   1.9s\n',
          ),
        ];
      })(),
    },

    // Done
    {
      delay: 2000,
      label: '✅ Complete',
      entries: [
        h.assistantMessage([
          h.textBlock('Done! Refactored all database queries to use parameterized statements. All 8 tests pass. This eliminates SQL injection risks.'),
        ], { inputTokens: 28000, outputTokens: 500 }),
      ],
      hooks: [h.hookIdle()],
    },
  ],
};
