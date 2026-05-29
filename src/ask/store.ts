import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { paths } from '../config/paths';

export interface AskOption {
  value: string;
  label: string;
  style?: 'primary' | 'danger' | 'default';
}

export interface AskAnswer {
  value: string;
  label: string;
  operatorOpenId: string;
  operatorName?: string;
  answeredAt: string;
}

export interface AskRecord {
  id: string;
  status: 'pending' | 'answered';
  chatId: string;
  operatorOpenId: string;
  question: string;
  options: AskOption[];
  createdAt: string;
  expiresAt: string;
  answer?: AskAnswer;
}

export interface CreatePendingAskInput {
  chatId: string;
  operatorOpenId: string;
  question: string;
  options: AskOption[];
  timeoutSeconds: number;
}

export interface AnswerAskInput {
  askId: string;
  operatorOpenId: string;
  operatorName?: string;
  optionValue: string;
  optionLabel?: string;
}

export interface AnswerAskResult {
  kind:
    | 'answered'
    | 'not_found'
    | 'already_answered'
    | 'forbidden'
    | 'invalid_option'
    | 'expired';
  record?: AskRecord;
}

export interface AskStore {
  createPending(input: CreatePendingAskInput): Promise<AskRecord>;
  read(id: string): Promise<AskRecord | undefined>;
  answer(input: AnswerAskInput): Promise<AnswerAskResult>;
  waitForAnswer(id: string, timeoutMs: number): Promise<AskRecord>;
  delete(id: string): Promise<void>;
}

export interface AskStoreOptions {
  asksDir?: string;
  now?: () => Date;
  pollMs?: number;
}

export function createAskStore(opts: AskStoreOptions = {}): AskStore {
  const asksDir = opts.asksDir ?? paths.asksDir;
  const now = opts.now ?? (() => new Date());
  const pollMs = Math.max(1, opts.pollMs ?? 500);

  return {
    async createPending(input) {
      const createdAt = now();
      const record: AskRecord = {
        id: generateAskId(),
        status: 'pending',
        chatId: input.chatId,
        operatorOpenId: input.operatorOpenId,
        question: input.question,
        options: input.options,
        createdAt: createdAt.toISOString(),
        expiresAt: new Date(createdAt.getTime() + input.timeoutSeconds * 1000).toISOString(),
      };
      await writeAskRecord(asksDir, record);
      return record;
    },

    read(id) {
      return readAskRecord(asksDir, id);
    },

    async answer(input) {
      const record = await readAskRecord(asksDir, input.askId);
      if (!record) return { kind: 'not_found' };
      if (record.status !== 'pending') {
        return { kind: 'already_answered', record };
      }
      if (Date.parse(record.expiresAt) <= now().getTime()) {
        return { kind: 'expired', record };
      }
      if (record.operatorOpenId !== input.operatorOpenId) {
        return { kind: 'forbidden', record };
      }
      const option = record.options.find((item) => item.value === input.optionValue);
      if (!option) {
        return { kind: 'invalid_option', record };
      }

      const answered: AskRecord = {
        ...record,
        status: 'answered',
        answer: {
          value: option.value,
          label: option.label,
          operatorOpenId: input.operatorOpenId,
          operatorName: input.operatorName,
          answeredAt: now().toISOString(),
        },
      };
      await writeAskRecord(asksDir, answered);
      return { kind: 'answered', record: answered };
    },

    async waitForAnswer(id, timeoutMs) {
      const deadline = now().getTime() + timeoutMs;
      while (true) {
        const record = await readAskRecord(asksDir, id);
        if (!record) throw new Error(`ask not found: ${id}`);
        if (record.status === 'answered') return record;
        const nowMs = now().getTime();
        if (Date.parse(record.expiresAt) <= nowMs || nowMs >= deadline) {
          throw new Error(`ask timed out: ${id}`);
        }
        await sleep(pollMs);
      }
    },

    async delete(id) {
      try {
        await unlink(askPath(asksDir, id));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    },
  };
}

function generateAskId(): string {
  return `ask_${randomBytes(6).toString('hex')}`;
}

function askPath(asksDir: string, id: string): string {
  return join(asksDir, `${id}.json`);
}

async function readAskRecord(asksDir: string, id: string): Promise<AskRecord | undefined> {
  try {
    const text = await readFile(askPath(asksDir, id), 'utf8');
    return JSON.parse(text) as AskRecord;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

async function writeAskRecord(asksDir: string, record: AskRecord): Promise<void> {
  const target = askPath(asksDir, record.id);
  const tmp = `${target}.tmp-${process.pid}`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  await rename(tmp, target);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
