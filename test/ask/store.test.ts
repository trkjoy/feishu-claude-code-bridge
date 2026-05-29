import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createAskStore } from '../../src/ask/store';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('createAskStore', () => {
  it('creates a pending ask and resolves the first valid answer', async () => {
    const store = createAskStore({ asksDir: createTempDir() });

    const pending = await store.createPending({
      chatId: 'oc_chat',
      operatorOpenId: 'ou_owner',
      question: '请选择环境',
      options: [
        { value: 'staging', label: '预发' },
        { value: 'prod', label: '生产' },
      ],
      timeoutSeconds: 60,
    });

    expect(pending.status).toBe('pending');
    expect(pending.answer).toBeUndefined();

    const answered = await store.answer({
      askId: pending.id,
      operatorOpenId: 'ou_owner',
      operatorName: 'Alice',
      optionValue: 'prod',
    });

    expect(answered.kind).toBe('answered');
    expect(answered.record?.status).toBe('answered');
    expect(answered.record?.answer).toMatchObject({
      value: 'prod',
      label: '生产',
      operatorOpenId: 'ou_owner',
      operatorName: 'Alice',
    });
  });

  it('rejects answers from a different operator', async () => {
    const store = createAskStore({ asksDir: createTempDir() });

    const pending = await store.createPending({
      chatId: 'oc_chat',
      operatorOpenId: 'ou_owner',
      question: '请选择环境',
      options: [
        { value: 'staging', label: '预发' },
        { value: 'prod', label: '生产' },
      ],
      timeoutSeconds: 60,
    });

    const answered = await store.answer({
      askId: pending.id,
      operatorOpenId: 'ou_other',
      operatorName: 'Bob',
      optionValue: 'prod',
    });

    expect(answered.kind).toBe('forbidden');
  });

  it('waits until an answer is written', async () => {
    const store = createAskStore({ asksDir: createTempDir(), pollMs: 2 });

    const pending = await store.createPending({
      chatId: 'oc_chat',
      operatorOpenId: 'ou_owner',
      question: '请选择环境',
      options: [
        { value: 'staging', label: '预发' },
        { value: 'prod', label: '生产' },
      ],
      timeoutSeconds: 60,
    });

    const waiter = store.waitForAnswer(pending.id, 100);
    setTimeout(() => {
      void store.answer({
        askId: pending.id,
        operatorOpenId: 'ou_owner',
        operatorName: 'Alice',
        optionValue: 'staging',
      });
    }, 5);

    const answered = await waiter;

    expect(answered.answer).toMatchObject({
      value: 'staging',
      label: '预发',
      operatorOpenId: 'ou_owner',
      operatorName: 'Alice',
    });
  });
});

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ask-store-'));
  tempDirs.push(dir);
  return dir;
}
