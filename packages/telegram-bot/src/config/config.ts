import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface TelegramConfig {
  chatId: number | null;
  silentMode: boolean;
  serverUrl: string;
}

const HUDAI_HOME = join(homedir(), '.hudai');
const CONFIG_PATH = join(HUDAI_HOME, 'telegram.json');

const DEFAULT_CONFIG: TelegramConfig = {
  chatId: null,
  silentMode: false,
  serverUrl: 'ws://localhost:4200/ws',
};

export function loadConfig(): TelegramConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = readFileSync(CONFIG_PATH, 'utf-8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    }
  } catch {
    // Corrupted config, use defaults
  }
  return { ...DEFAULT_CONFIG };
}

export function saveConfig(config: TelegramConfig): void {
  mkdirSync(HUDAI_HOME, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

export function getBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error(
      'TELEGRAM_BOT_TOKEN not set. Add it to .env or set the environment variable.'
    );
  }
  return token;
}
