import { describe, expect, it } from 'vitest';
import { pickLiveEntry } from '../../src/cli/commands/service';
import type { ProcessEntry } from '../../src/runtime/registry';

function proc(over: Partial<ProcessEntry>): ProcessEntry {
  return {
    id: 'p',
    pid: 1000,
    appId: 'cli_app',
    tenant: 'feishu',
    configPath: '/cfg',
    startedAt: '2026-01-01T00:00:00.000Z',
    version: '0.0.0',
    ...over,
  };
}

describe('pickLiveEntry', () => {
  it('matches by botId even when two bots share one Feishu app', () => {
    const a = proc({ id: 'pa', pid: 1, botId: 'aaa', appId: 'shared', botName: 'A' });
    const b = proc({ id: 'pb', pid: 2, botId: 'bbb', appId: 'shared', botName: 'B' });
    expect(pickLiveEntry([a, b], 'bbb', 'shared')?.id).toBe('pb');
  });

  it('falls back to appId when no botId matches (pre-migration entry)', () => {
    const legacy = proc({ id: 'pl', pid: 3, botId: undefined, appId: 'cli_x', botName: 'Legacy' });
    expect(pickLiveEntry([legacy], 'default', 'cli_x')?.id).toBe('pl');
  });

  it('ignores entries whose botName is not yet filled (handshake pending)', () => {
    const noName = proc({ id: 'pn', pid: 4, botId: 'ccc', appId: 'cli_y', botName: undefined });
    expect(pickLiveEntry([noName], 'ccc', 'cli_y')).toBeUndefined();
  });

  it('returns undefined when nothing matches', () => {
    const x = proc({ id: 'px', pid: 5, botId: 'zzz', appId: 'cli_z', botName: 'Z' });
    expect(pickLiveEntry([x], 'nope', 'also-nope')).toBeUndefined();
  });
});
