import type { Writable } from 'node:stream';
import { Client, Domain, LoggerLevel } from '@larksuiteoapi/node-sdk';
import type { AskOption, AskStore } from '../../ask/store';
import { createAskStore } from '../../ask/store';
import { askCard } from '../../card/ask-card';
import { paths } from '../../config/paths';
import type { AppConfig } from '../../config/schema';
import { isComplete } from '../../config/schema';
import { resolveAppSecret } from '../../config/secret-resolver';
import { loadConfig } from '../../config/store';
import { log } from '../../core/logger';

export interface AskCliOptions {
  config?: string;
  chatId: string;
  operatorOpenId: string;
  question: string;
  options: string;
  timeoutSeconds?: number;
}

interface AskClient {
  im: {
    v1: {
      message: {
        create(payload: {
          params: { receive_id_type: 'chat_id' };
          data: { receive_id: string; msg_type: 'interactive'; content: string };
        }): Promise<unknown>;
      };
    };
  };
}

export interface AskCommandDeps {
  loadConfig?: typeof loadConfig;
  resolveAppSecret?: typeof resolveAppSecret;
  createClient?: (cfg: AppConfig, appSecret: string) => AskClient;
  createAskStore?: () => AskStore;
  stdout?: Pick<Writable, 'write'>;
}

export async function runAsk(
  opts: AskCliOptions,
  deps: AskCommandDeps = {},
): Promise<void> {
  const configPath = opts.config ?? process.env.LARK_CHANNEL_CONFIG ?? paths.configFile;
  const cfg = await (deps.loadConfig ?? loadConfig)(configPath);
  if (!isComplete(cfg)) {
    throw new Error(`bridge config is incomplete: ${configPath}`);
  }

  const question = opts.question.trim();
  if (!question) throw new Error('question must not be empty');

  const options = parseAskOptions(opts.options);
  if (options.length < 2) throw new Error('at least two options are required');

  const timeoutSeconds = normalizeTimeoutSeconds(opts.timeoutSeconds);
  const store = (deps.createAskStore ?? (() => createAskStore()))();
  const pending = await store.createPending({
    chatId: opts.chatId,
    operatorOpenId: opts.operatorOpenId,
    question,
    options,
    timeoutSeconds,
  });

  try {
    const appSecret = await (deps.resolveAppSecret ?? resolveAppSecret)(cfg);
    const client = (deps.createClient ?? defaultCreateClient)(cfg, appSecret);
    const card = askCard({
      askId: pending.id,
      question,
      options,
    });

    await client.im.v1.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: opts.chatId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
      },
    });
    log.info('ask', 'created', {
      askId: pending.id,
      chatId: opts.chatId,
      timeoutSeconds,
      optionCount: options.length,
    });

    const answered = await store.waitForAnswer(pending.id, timeoutSeconds * 1000);
    if (!answered.answer) {
      throw new Error(`ask resolved without answer: ${pending.id}`);
    }
    log.info('ask', 'answered', {
      askId: answered.id,
      value: answered.answer.value,
      operator: answered.answer.operatorOpenId.slice(-6),
    });
    const payload = {
      id: answered.id,
      value: answered.answer.value,
      label: answered.answer.label,
      operatorOpenId: answered.answer.operatorOpenId,
      operatorName: answered.answer.operatorName,
    };
    (deps.stdout ?? process.stdout).write(`${JSON.stringify(payload)}\n`);
  } finally {
    await store.delete(pending.id);
  }
}

function defaultCreateClient(cfg: AppConfig, appSecret: string): AskClient {
  return new Client({
    appId: cfg.accounts.app.id,
    appSecret,
    domain: cfg.accounts.app.tenant === 'lark' ? Domain.Lark : Domain.Feishu,
    loggerLevel: LoggerLevel.error,
    source: 'lark-channel-bridge-ask',
  });
}

function parseAskOptions(raw: string): AskOption[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`options must be valid JSON: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('options must be a JSON array');
  }
  const normalized = parsed.map(normalizeOption);
  const seen = new Set<string>();
  for (const option of normalized) {
    if (seen.has(option.value)) {
      throw new Error(`duplicate option value: ${option.value}`);
    }
    seen.add(option.value);
  }
  return normalized;
}

function normalizeOption(input: unknown): AskOption {
  if (typeof input === 'string') {
    const value = input.trim();
    if (!value) throw new Error('option values must not be empty');
    return { value, label: value };
  }
  if (!input || typeof input !== 'object') {
    throw new Error('each option must be a string or object');
  }
  const value = String((input as { value?: unknown }).value ?? '').trim();
  const label = String((input as { label?: unknown }).label ?? '').trim();
  if (!value || !label) {
    throw new Error('each option object must contain non-empty value and label');
  }
  const style = (input as { style?: unknown }).style;
  return {
    value,
    label,
    ...(style === 'primary' || style === 'danger' || style === 'default' ? { style } : {}),
  };
}

function normalizeTimeoutSeconds(raw: number | undefined): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 600;
  return Math.min(3600, Math.max(5, Math.floor(raw)));
}
