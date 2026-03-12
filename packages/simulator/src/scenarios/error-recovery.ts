import type { Scenario } from '../types.js';
import * as h from '../helpers.js';

export const errorRecovery: Scenario = {
  name: 'error-recovery',
  description: 'Tests fail, agent retries and fixes, context compaction',
  projectPath: '/tmp/hudai-sim-project',
  timeline: [
    {
      delay: 500,
      label: '💬 User prompt',
      entries: [h.userPrompt('Fix the payment processing bug — charges are being doubled')],
    },

    // Investigate
    {
      delay: 2000,
      label: '🧠 Investigating',
      entries: [
        h.assistantMessage([
          h.thinking('Double charges suggest a race condition or missing idempotency check. Let me look at the payment handler.'),
          h.readFile('src/payments/handler.ts'),
          h.readFile('src/payments/stripe-client.ts'),
          h.grep('processPayment|chargeCard'),
        ], { inputTokens: 10000, outputTokens: 2000 }),
      ],
    },

    // First fix attempt
    {
      delay: 2500,
      label: '✏️  First fix attempt',
      entries: [
        h.assistantMessage([
          h.textBlock('I see the issue — there\'s no idempotency check. Let me add one.'),
          h.editFile(
            'src/payments/handler.ts',
            'async function processPayment(orderId, amount) {',
            'async function processPayment(orderId, amount) {\n  const existing = await db.query("SELECT id FROM payments WHERE order_id = $1", [orderId]);\n  if (existing.rows.length > 0) return existing.rows[0];',
          ),
        ], { inputTokens: 15000, outputTokens: 1500 }),
      ],
    },

    // Run tests — FAIL
    {
      delay: 2000,
      label: '🧪 Running tests (will fail)',
      entries: (() => {
        const bashTool = h.bash('npm test -- --grep payment');
        const bashId = h.getToolId(bashTool);
        return [
          h.assistantMessage([bashTool], { inputTokens: 18000, outputTokens: 300 }),
          h.toolResult(
            bashId,
            'stdout:\n  FAIL  src/__tests__/payment.test.ts\n' +
            '    ✓ processes single payment (15ms)\n' +
            '    ✗ handles concurrent requests (45ms)\n' +
            '      Error: Expected 1 charge but got 2\n' +
            '    ✗ validates idempotency key (12ms)\n' +
            '      Error: expected 409 status but got 200\n' +
            '    ✓ refunds payment (8ms)\n\n' +
            '  Tests:  2 failed, 2 passed, 4 total\n  Time:   3.0s\n',
          ),
        ];
      })(),
    },

    // Second fix attempt
    {
      delay: 3000,
      label: '🧠 Analyzing failure + second fix',
      entries: [
        h.assistantMessage([
          h.thinking('The idempotency check has a race condition — two concurrent requests can both pass the SELECT check before either INSERTs. I need a database-level lock using SELECT FOR UPDATE or a unique constraint.'),
          h.editFile(
            'src/payments/handler.ts',
            'const existing = await db.query("SELECT id FROM payments WHERE order_id = $1", [orderId]);',
            'const existing = await db.query("SELECT id FROM payments WHERE order_id = $1 FOR UPDATE", [orderId]);',
          ),
        ], { inputTokens: 22000, outputTokens: 1800 }),
      ],
    },

    // Run tests again — 1 still failing
    {
      delay: 2000,
      label: '🧪 Tests again (1 still failing)',
      entries: (() => {
        const bashTool = h.bash('npm test -- --grep payment');
        const bashId = h.getToolId(bashTool);
        return [
          h.assistantMessage([bashTool], { inputTokens: 25000, outputTokens: 300 }),
          h.toolResult(
            bashId,
            'stdout:\n  FAIL  src/__tests__/payment.test.ts\n' +
            '    ✓ processes single payment (12ms)\n' +
            '    ✓ handles concurrent requests (38ms)\n' +
            '    ✗ validates idempotency key (10ms)\n' +
            '      Error: expected 409 status but got 200\n' +
            '    ✓ refunds payment (7ms)\n\n' +
            '  Tests:  1 failed, 3 passed, 4 total\n  Time:   2.8s\n',
          ),
        ];
      })(),
    },

    // Third fix
    {
      delay: 2500,
      label: '✏️  Third fix — return 409',
      entries: [
        h.assistantMessage([
          h.thinking('The test expects a 409 Conflict status when a duplicate idempotency key is used, but I\'m just returning the existing record with 200. Let me fix the status code.'),
          h.editFile(
            'src/payments/handler.ts',
            'if (existing.rows.length > 0) return existing.rows[0];',
            'if (existing.rows.length > 0) return res.status(409).json(existing.rows[0]);',
          ),
        ], { inputTokens: 28000, outputTokens: 800 }),
      ],
    },

    // Final test run — PASS
    {
      delay: 2000,
      label: '🧪 Final test run',
      entries: (() => {
        const bashTool = h.bash('npm test -- --grep payment');
        const bashId = h.getToolId(bashTool);
        return [
          h.assistantMessage([bashTool], { inputTokens: 30000, outputTokens: 300 }),
          h.toolResult(
            bashId,
            'stdout:\n  PASS  src/__tests__/payment.test.ts\n' +
            '    ✓ processes single payment (12ms)\n' +
            '    ✓ handles concurrent requests (38ms)\n' +
            '    ✓ validates idempotency key (10ms)\n' +
            '    ✓ refunds payment (7ms)\n\n' +
            '  Tests:  4 passed, 4 total\n  Time:   2.5s\n',
          ),
        ];
      })(),
    },

    // Compaction
    {
      delay: 2000,
      label: '📦 Context compaction',
      entries: [h.compaction(180000)],
    },

    // Done
    {
      delay: 1500,
      label: '✅ Complete',
      entries: [
        h.assistantMessage([
          h.textBlock('Fixed the double-charge bug! The root cause was a race condition in the idempotency check. I added:\n1. SELECT FOR UPDATE for database-level locking\n2. 409 Conflict response for duplicate idempotency keys\n\nAll 4 tests pass.'),
        ], { inputTokens: 35000, outputTokens: 800 }),
      ],
      hooks: [h.hookIdle()],
    },
  ],
};
