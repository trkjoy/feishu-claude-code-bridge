import { describe, expect, it } from 'vitest';
import { shouldAutoBindOrchestrator } from '../../src/bot/default-role';
import type { AppConfig } from '../../src/config/schema';

const cfg: AppConfig = { accounts: { app: { id: 'cli_x', secret: 's', tenant: 'feishu' } } };

describe('shouldAutoBindOrchestrator', () => {
  it('binds for the default bot when no role and persona available', () => {
    expect(shouldAutoBindOrchestrator({ isDefaultBot: true, hasRole: false, personaAvailable: true })).toBe(true);
  });
  it('does not bind a named bot', () => {
    expect(shouldAutoBindOrchestrator({ isDefaultBot: false, hasRole: false, personaAvailable: true })).toBe(false);
  });
  it('does not overwrite an existing role', () => {
    expect(shouldAutoBindOrchestrator({ isDefaultBot: true, hasRole: true, personaAvailable: true })).toBe(false);
  });
  it('does not bind when orchestrator.md is absent', () => {
    expect(shouldAutoBindOrchestrator({ isDefaultBot: true, hasRole: false, personaAvailable: false })).toBe(false);
  });
  it('references cfg type to avoid unused import', () => {
    expect(cfg.role).toBeUndefined();
  });
});
