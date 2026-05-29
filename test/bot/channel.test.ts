import { describe, expect, it, vi } from 'vitest';
import { registerMessageReadHandler } from '../../src/bot/message-read';

describe('registerMessageReadHandler', () => {
  it('returns false when the SDK channel does not expose a raw dispatcher', () => {
    const registered = registerMessageReadHandler({} as never);

    expect(registered).toBe(false);
  });

  it('registers im.message.message_read_v1 and logs reader details', async () => {
    const handlers: Record<string, (payload: unknown) => Promise<void> | void> = {};
    const register = vi.fn((next: Record<string, (payload: unknown) => Promise<void> | void>) => {
      Object.assign(handlers, next);
      return undefined;
    });
    const info = vi.fn();
    const traceCalls: Array<{ chatId?: string; msgId?: string }> = [];
    const trace = async <T>(ctx: { chatId?: string; msgId?: string }, fn: () => Promise<T>) => {
      traceCalls.push(ctx);
      return await fn();
    };

    const registered = registerMessageReadHandler(
      {
        dispatcher: { register },
      } as never,
      {
        logger: { info },
        trace,
      },
    );

    expect(registered).toBe(true);
    expect(register).toHaveBeenCalledOnce();
    const handler = handlers['im.message.message_read_v1'];
    expect(handler).toBeTypeOf('function');
    if (!handler) throw new Error('message_read_v1 handler was not registered');

    await handler({
      event_id: 'evt_123',
      open_chat_id: 'oc_123',
      reader: {
        reader_id: {
          open_id: 'ou_123',
          user_id: 'u_123',
          union_id: 'on_123',
        },
        read_time: '1716970000',
      },
      message_id_list: ['om_1', 'om_2'],
    });

    expect(traceCalls).toEqual([{ chatId: 'oc_123', msgId: 'om_1' }]);
    expect(info).toHaveBeenCalledWith('read', 'message-read', {
      eventId: 'evt_123',
      openChatId: 'oc_123',
      readerOpenId: 'ou_123',
      readerUserId: 'u_123',
      readerUnionId: 'on_123',
      readTime: '1716970000',
      messageIds: ['om_1', 'om_2'],
    });
  });
});
