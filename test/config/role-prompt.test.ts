import { describe, expect, it } from 'vitest';
import { getRoleSystemPrompt, type AppConfig } from '../../src/config/schema';

const base: AppConfig = {
  accounts: { app: { id: 'cli_x', secret: 's', tenant: 'feishu' } },
};

describe('getRoleSystemPrompt', () => {
  it('returns empty string when no role is set', () => {
    expect(getRoleSystemPrompt(base)).toBe('');
  });
  it('includes the persona and skill hints when a role is set', () => {
    const out = getRoleSystemPrompt({
      ...base,
      role: {
        agent: 'backend-architect',
        systemPrompt: 'You build APIs.',
        skills: ['code-review', 'lark-base'],
        boundAt: '2026-05-31T00:00:00.000Z',
      },
    });
    expect(out).toContain('You build APIs.');
    expect(out).toContain('code-review');
    expect(out).toContain('lark-base');
  });
  it('omits the skills section when skills is empty/absent', () => {
    const out = getRoleSystemPrompt({
      ...base,
      role: { agent: 'a', systemPrompt: 'Persona only.', boundAt: '2026-05-31T00:00:00.000Z' },
    });
    expect(out).toContain('Persona only.');
    expect(out).not.toContain('应优先使用');
  });
});
