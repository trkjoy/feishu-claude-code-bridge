import { describe, expect, it } from 'vitest';
import { nextRole } from '../../src/cli/commands/role';
import type { BotRole } from '../../src/config/schema';

const NOW = '2026-05-31T00:00:00.000Z';
const current: BotRole = {
  agent: 'a',
  systemPrompt: 'A persona',
  skills: ['s1'],
  boundAt: '2026-01-01T00:00:00.000Z',
};

describe('nextRole', () => {
  it('clears the role', () => {
    expect(nextRole(current, { clear: true, now: NOW })).toBeUndefined();
  });
  it('binds a new agent with a fresh persona snapshot', () => {
    const r = nextRole(undefined, { agent: 'b', persona: 'B persona', now: NOW });
    expect(r).toEqual({ agent: 'b', systemPrompt: 'B persona', skills: undefined, boundAt: NOW });
  });
  it('replacing an agent carries skills only when none are given', () => {
    const r = nextRole(current, { agent: 'b', persona: 'B persona', now: NOW });
    expect(r?.skills).toEqual(['s1']);
  });
  it('sets skills on an existing role without changing persona', () => {
    const r = nextRole(current, { skills: ['x', 'y'], now: NOW });
    expect(r).toMatchObject({ agent: 'a', systemPrompt: 'A persona', skills: ['x', 'y'] });
  });
  it('returns current unchanged when setting skills with no existing role', () => {
    expect(nextRole(undefined, { skills: ['x'], now: NOW })).toBeUndefined();
  });
});
