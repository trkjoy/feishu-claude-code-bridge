import type { LarkChannel } from '@larksuiteoapi/node-sdk';
import { log, withTrace } from '../core/logger';

type TraceFn = typeof withTrace;

interface MessageReadLogger {
  info(phase: string, event: string, fields?: Record<string, unknown>): void;
}

interface RawDispatcher {
  register(handlers: Record<string, (payload: unknown) => Promise<void> | void>): unknown;
}

interface RawDispatcherChannel {
  dispatcher?: RawDispatcher;
}

interface RawMessageReadPayload {
  event_id?: string;
  uuid?: string;
  open_chat_id?: string;
  chat_id?: string;
  open_id?: string;
  user_id?: string;
  message_id_list?: string[];
  open_message_ids?: string[];
  reader?: {
    reader_id?: {
      open_id?: string;
      user_id?: string;
      union_id?: string;
    };
    read_time?: string;
  };
}

interface NormalizedMessageReadEvent {
  eventId?: string;
  openChatId?: string;
  readerOpenId?: string;
  readerUserId?: string;
  readerUnionId?: string;
  readTime?: string;
  messageIds: string[];
}

interface RegisterMessageReadHandlerDeps {
  logger?: MessageReadLogger;
  trace?: TraceFn;
}

export function registerMessageReadHandler(
  channel: LarkChannel,
  deps: RegisterMessageReadHandlerDeps = {},
): boolean {
  const dispatcher = getRawDispatcher(channel);
  if (!dispatcher) return false;

  const logger = deps.logger ?? log;
  const trace = deps.trace ?? withTrace;

  dispatcher.register({
    'im.message.message_read_v1': async (payload) => {
      const evt = normalizeMessageReadPayload(payload);
      await trace({ chatId: evt.openChatId, msgId: evt.messageIds[0] }, async () => {
        logger.info('read', 'message-read', {
          eventId: evt.eventId,
          openChatId: evt.openChatId,
          readerOpenId: evt.readerOpenId,
          readerUserId: evt.readerUserId,
          readerUnionId: evt.readerUnionId,
          readTime: evt.readTime,
          messageIds: evt.messageIds,
        });
      });
    },
  });

  return true;
}

function getRawDispatcher(channel: LarkChannel): RawDispatcher | undefined {
  const maybeChannel = channel as unknown as RawDispatcherChannel;
  const dispatcher = maybeChannel.dispatcher;
  if (!dispatcher || typeof dispatcher.register !== 'function') return undefined;
  return dispatcher;
}

function normalizeMessageReadPayload(payload: unknown): NormalizedMessageReadEvent {
  const raw = (payload ?? {}) as RawMessageReadPayload;
  return {
    eventId: raw.event_id ?? raw.uuid,
    openChatId: raw.open_chat_id ?? raw.chat_id,
    readerOpenId: raw.reader?.reader_id?.open_id ?? raw.open_id,
    readerUserId: raw.reader?.reader_id?.user_id ?? raw.user_id,
    readerUnionId: raw.reader?.reader_id?.union_id,
    readTime: raw.reader?.read_time,
    messageIds: raw.message_id_list ?? raw.open_message_ids ?? [],
  };
}
