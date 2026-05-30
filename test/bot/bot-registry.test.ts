import { describe, expect, it } from 'vitest';
import { planDefaultBotIdMigration, type BotEntry } from '../../src/bot/bot-registry';

const CONFIG = '/home/u/.lark-channel/config.json';

function entry(over: Partial<BotEntry>): BotEntry {
  return {
    id: 'x',
    appId: 'cli_app',
    tenant: 'feishu',
    configPath: '/home/u/.lark-channel/config-x.json',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('planDefaultBotIdMigration', () => {
  it('renames a legacy hex default entry to "default" and leaves others alone', () => {
    const hex = entry({ id: 'a3f2', configPath: CONFIG });
    const named = entry({ id: 'prod', configPath: '/home/u/.lark-channel/config-prod.json' });

    const plan = planDefaultBotIdMigration([hex, named], CONFIG);

    expect(plan?.oldId).toBe('a3f2');
    expect(plan?.entries.find((e) => e.configPath === CONFIG)?.id).toBe('default');
    expect(
      plan?.entries.find((e) => e.configPath.endsWith('config-prod.json'))?.id,
    ).toBe('prod');
  });

  it('is a no-op when the default entry already uses "default"', () => {
    expect(
      planDefaultBotIdMigration([entry({ id: 'default', configPath: CONFIG })], CONFIG),
    ).toBeNull();
  });

  it('does not collide when a "default" entry already exists elsewhere', () => {
    const hex = entry({ id: 'a3f2', configPath: CONFIG });
    const existingDefault = entry({ id: 'default', configPath: '/other/config.json' });
    expect(planDefaultBotIdMigration([hex, existingDefault], CONFIG)).toBeNull();
  });

  it('is a no-op when there is no default (config.json) entry', () => {
    const named = entry({ id: 'prod', configPath: '/home/u/.lark-channel/config-prod.json' });
    expect(planDefaultBotIdMigration([named], CONFIG)).toBeNull();
  });
});
