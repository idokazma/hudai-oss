import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hudaiHome } from './data-dir.js';

export interface Secrets {
  geminiApiKey?: string;
  openaiApiKey?: string;
  claudeApiKey?: string;
  telegramBotToken?: string;
  advisorVerbosity?: 'quiet' | 'normal' | 'verbose';
  advisorScope?: 'session' | 'global';
  advisorSystemPrompt?: string;
  advisorProactivePrompt?: string;
}

function secretsPath(): string {
  return join(hudaiHome(), 'secrets.json');
}

export function loadSecrets(): Secrets {
  try {
    const raw = readFileSync(secretsPath(), 'utf-8');
    return JSON.parse(raw) as Secrets;
  } catch {
    return {};
  }
}

export function saveSecrets(secrets: Secrets): void {
  writeFileSync(secretsPath(), JSON.stringify(secrets, null, 2), 'utf-8');
}

/** Get a secret value — env var takes priority, falls back to secrets.json */
export function getSecret(key: keyof Secrets): string | undefined {
  const envMap: Partial<Record<keyof Secrets, string>> = {
    geminiApiKey: 'GEMINI_API_KEY',
    openaiApiKey: 'OPENAI_API_KEY',
    claudeApiKey: 'CLAUDE_API_KEY',
    telegramBotToken: 'TELEGRAM_BOT_TOKEN',
  };
  const envKey = envMap[key];
  const envVal = envKey ? process.env[envKey] : undefined;
  if (envVal) return envVal;
  return loadSecrets()[key];
}

/** Returns boolean flags indicating which keys are set */
export function getKeysStatus(): { geminiApiKey: boolean; openaiApiKey: boolean; claudeApiKey: boolean; telegramBotToken: boolean } {
  return {
    geminiApiKey: !!getSecret('geminiApiKey'),
    openaiApiKey: !!getSecret('openaiApiKey'),
    claudeApiKey: !!getSecret('claudeApiKey'),
    telegramBotToken: !!getSecret('telegramBotToken'),
  };
}
