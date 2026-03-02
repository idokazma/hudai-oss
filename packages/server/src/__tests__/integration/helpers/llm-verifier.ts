import type { LLMClient } from '../../../llm/llm-provider.js';
import type { ServerMessage } from '@hudai/shared';
import type { CallLogEntry } from './mock-llm-provider.js';

export interface VerificationEvidence {
  wsMessages: ServerMessage[];
  llmCallLog: CallLogEntry[];
  agentWrites: string[];
}

export interface VerificationResult {
  pass: boolean;
  violations: string[];
  notes: string[];
}

/**
 * Optional LLM-based verifier for integration test assertions.
 * Only used when HUDAI_LLM_VERIFY=1 is set.
 */
export class LlmVerifier {
  constructor(private llm: LLMClient) {}

  static isEnabled(): boolean {
    return process.env.HUDAI_LLM_VERIFY === '1';
  }

  async verify(
    scenarioDescription: string,
    evidence: VerificationEvidence,
  ): Promise<VerificationResult> {
    const evidenceText = [
      '## WebSocket Messages',
      JSON.stringify(evidence.wsMessages.map(m => m.kind), null, 2),
      '',
      '## LLM Call Log',
      evidence.llmCallLog.map((c, i) =>
        `[${i}] label=${c.label || 'none'} prompt=${c.prompt.slice(0, 200)}...`
      ).join('\n'),
      '',
      '## Agent Writes',
      evidence.agentWrites.join(', ') || '(none)',
    ].join('\n');

    const prompt = `You are a test verifier for an AI agent monitoring system called Hudai.

## Scenario
${scenarioDescription}

## Evidence
${evidenceText}

## Instructions
Evaluate whether the evidence is consistent with the scenario description.
Return a JSON object with:
- "pass": boolean — true if evidence matches scenario expectations
- "violations": string[] — list of any expectation failures
- "notes": string[] — optional observations

Respond with ONLY valid JSON.`;

    const response = await this.llm.generate(prompt);

    try {
      const parsed = JSON.parse(response.trim());
      return {
        pass: Boolean(parsed.pass),
        violations: Array.isArray(parsed.violations) ? parsed.violations : [],
        notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      };
    } catch {
      return {
        pass: false,
        violations: [`LLM verifier returned invalid JSON: ${response.slice(0, 200)}`],
        notes: [],
      };
    }
  }
}
