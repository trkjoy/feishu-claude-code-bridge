import { describe, expect, it } from 'vitest';
import { buildEncryptedAccountConfig } from '../../src/config/store';
import type { BotRole } from '../../src/config/schema';

const role: BotRole = {
  agent: 'backend-architect',
  systemPrompt: 'You build APIs.',
  skills: ['code-review'],
  boundAt: '2026-05-31T00:00:00.000Z',
};

describe('buildEncryptedAccountConfig role preservation', () => {
  it('carries an existing role through a rebuild', async () => {
    const next = await buildEncryptedAccountConfig('cli_x', 'feishu', undefined, role);
    expect(next.role).toEqual(role);
  });
  it('leaves role undefined when none is passed', async () => {
    const next = await buildEncryptedAccountConfig('cli_x', 'feishu');
    expect(next.role).toBeUndefined();
  });
});
