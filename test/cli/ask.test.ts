import { describe, expect, it, vi } from 'vitest';
import { runAsk } from '../../src/cli/commands/ask';

describe('runAsk', () => {
  it('sends a card and prints the selected option as JSON', async () => {
    const createMessage = vi.fn().mockResolvedValue({
      data: { message_id: 'om_card' },
    });
    const stdoutWrite = vi.fn();
    const deleteAsk = vi.fn().mockResolvedValue(undefined);
    const createPending = vi.fn().mockResolvedValue({ id: 'ask_1' });
    const waitForAnswer = vi.fn().mockResolvedValue({
      id: 'ask_1',
      status: 'answered',
      answer: {
        value: 'prod',
        label: '生产',
        operatorOpenId: 'ou_owner',
        operatorName: 'Alice',
      },
    });

    await runAsk(
      {
        config: 'D:\\tmp\\config.json',
        chatId: 'oc_chat',
        operatorOpenId: 'ou_owner',
        question: '请选择环境',
        options: JSON.stringify([
          { value: 'staging', label: '预发' },
          { value: 'prod', label: '生产' },
        ]),
        timeoutSeconds: 60,
      },
      {
        loadConfig: vi.fn().mockResolvedValue({
          accounts: {
            app: { id: 'cli_123', secret: 'secret', tenant: 'feishu' },
          },
        }),
        resolveAppSecret: vi.fn().mockResolvedValue('secret'),
        createClient: vi.fn().mockReturnValue({
          im: { v1: { message: { create: createMessage } } },
        }),
        createAskStore: () =>
          ({
            createPending,
            waitForAnswer,
            delete: deleteAsk,
          }) as never,
        stdout: { write: stdoutWrite } as never,
      },
    );

    expect(createPending).toHaveBeenCalledOnce();
    expect(createMessage).toHaveBeenCalledOnce();
    expect(waitForAnswer).toHaveBeenCalledWith('ask_1', 60_000);
    expect(deleteAsk).toHaveBeenCalledWith('ask_1');
    expect(stdoutWrite).toHaveBeenCalledWith(
      expect.stringContaining('"value":"prod"'),
    );
  });
});
