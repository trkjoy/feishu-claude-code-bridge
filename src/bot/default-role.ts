import { readAgentPersona } from './agent-catalog';
import type { AppConfig } from '../config/schema';

export const ORCHESTRATOR_AGENT = 'orchestrator';

/** Pure gate: bind orchestrator only for the default bot, only when it has no
 * role yet, only when the orchestrator persona is actually available. */
export function shouldAutoBindOrchestrator(input: {
  isDefaultBot: boolean;
  hasRole: boolean;
  personaAvailable: boolean;
}): boolean {
  return input.isDefaultBot && !input.hasRole && input.personaAvailable;
}

/** Returns the cfg unchanged, or a copy with an orchestrator role attached
 * (and the caller should persist it). Pure except for the persona read. */
export async function maybeAttachDefaultRole(
  cfg: AppConfig,
  isDefaultBot: boolean,
  now: string,
): Promise<{ cfg: AppConfig; bound: boolean }> {
  const persona =
    isDefaultBot && !cfg.role ? await readAgentPersona(ORCHESTRATOR_AGENT) : undefined;
  if (
    !shouldAutoBindOrchestrator({
      isDefaultBot,
      hasRole: Boolean(cfg.role),
      personaAvailable: Boolean(persona),
    })
  ) {
    return { cfg, bound: false };
  }
  return {
    cfg: { ...cfg, role: { agent: ORCHESTRATOR_AGENT, systemPrompt: persona as string, boundAt: now } },
    bound: true,
  };
}
