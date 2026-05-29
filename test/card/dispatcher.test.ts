import { describe, expect, it, vi } from 'vitest';
import { handleCardAction } from '../../src/card/dispatcher';

describe('handleCardAction', () => {
  it('resolves bridge ask callbacks without enqueueing a new pending message', async () => {
    const pendingPush = vi.fn();
    const answer = vi.fn().mockResolvedValue({
      kind: 'answered',
      record: { id: 'ask_1', status: 'answered' },
    });

    await handleCardAction({
      channel: {} as never,
      evt: {
        action: {
          value: {
            __bridge_ask: true,
            ask_id: 'ask_1',
            option_value: 'prod',
            option_label: '生产',
          },
        },
        operator: { openId: 'ou_owner', name: 'Alice' },
        chatId: 'oc_chat',
        messageId: 'om_ask',
      } as never,
      sessions: {} as never,
      workspaces: {} as never,
      activeRuns: {} as never,
      agent: {} as never,
      controls: {
        cfg: {
          accounts: {
            app: { id: 'cli_123', secret: 'secret', tenant: 'feishu' },
          },
        },
      } as never,
      pending: { push: pendingPush } as never,
      chatModeCache: { resolve: vi.fn().mockResolvedValue('p2p') } as never,
      askStore: { answer } as never,
    });

    expect(answer).toHaveBeenCalledWith({
      askId: 'ask_1',
      operatorOpenId: 'ou_owner',
      operatorName: 'Alice',
      optionValue: 'prod',
      optionLabel: '生产',
    });
    expect(pendingPush).not.toHaveBeenCalled();
  });

  it('keeps __claude_cb callbacks on the existing pending queue path', async () => {
    const pendingPush = vi.fn();
    const answer = vi.fn();

    await handleCardAction({
      channel: {} as never,
      evt: {
        action: {
          value: {
            __claude_cb: true,
            choice: 'prod',
          },
        },
        operator: { openId: 'ou_owner', name: 'Alice' },
        chatId: 'oc_chat',
        messageId: 'om_card',
      } as never,
      sessions: {} as never,
      workspaces: {} as never,
      activeRuns: {} as never,
      agent: {} as never,
      controls: {
        cfg: {
          accounts: {
            app: { id: 'cli_123', secret: 'secret', tenant: 'feishu' },
          },
        },
      } as never,
      pending: { push: pendingPush } as never,
      chatModeCache: { resolve: vi.fn().mockResolvedValue('p2p') } as never,
      askStore: { answer } as never,
    });

    expect(answer).not.toHaveBeenCalled();
    expect(pendingPush).toHaveBeenCalledTimes(1);
    expect(pendingPush.mock.calls[0]?.[0]).toBe('oc_chat');
    expect(pendingPush.mock.calls[0]?.[1]?.content).toBe(
      '[card-click] {"choice":"prod"}',
    );
  });
});
