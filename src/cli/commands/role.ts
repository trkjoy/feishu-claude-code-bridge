import { getBot } from '../../bot/bot-registry';
import { readAgentPersona } from '../../bot/agent-catalog';
import { paths } from '../../config/paths';
import { buildEncryptedAccountConfig, loadConfig, saveConfig } from '../../config/store';
import { isComplete, type AppConfig, type BotRole } from '../../config/schema';

export interface RoleOptions {
  agent?: string;
  skills?: string;
  clear?: boolean;
  refresh?: boolean;
}

export interface RoleChange {
  clear?: boolean;
  agent?: string;
  persona?: string; // resolved snapshot when (re)binding
  skills?: string[];
  now: string;
}

/** Pure role-state transition. Unit tested. */
export function nextRole(current: BotRole | undefined, change: RoleChange): BotRole | undefined {
  if (change.clear) return undefined;
  if (change.agent && change.persona !== undefined) {
    return {
      agent: change.agent,
      systemPrompt: change.persona,
      skills: change.skills ?? current?.skills,
      boundAt: change.now,
    };
  }
  if (change.skills) {
    if (!current) return undefined; // no role to attach skills to
    return { ...current, skills: change.skills };
  }
  return current;
}

function parseSkills(list?: string): string[] | undefined {
  if (!list) return undefined;
  const skills = list.split(',').map((s) => s.trim()).filter(Boolean);
  return skills.length ? skills : undefined;
}

async function resolveConfigPath(botId: string): Promise<string> {
  if (botId === 'default') return paths.configFile;
  const bot = await getBot(botId);
  if (!bot) throw new Error(`未找到 bot "${botId}"。用 \`lark-channel-bridge ps\` 查看。`);
  return bot.configPath;
}

export async function runRole(botId: string, opts: RoleOptions): Promise<void> {
  const configPath = await resolveConfigPath(botId);
  const loaded = await loadConfig(configPath);
  if (!isComplete(loaded)) throw new Error(`bot "${botId}" 还没配置完成。`);
  const cfg = loaded as AppConfig;

  // Show mode: no mutating flags.
  if (!opts.agent && !opts.skills && !opts.clear && !opts.refresh) {
    if (!cfg.role) {
      console.log(`bot "${botId}" 未绑定角色（使用默认 BRIDGE 角色）。`);
      return;
    }
    console.log(`bot "${botId}" 角色: ${cfg.role.agent}`);
    if (cfg.role.skills?.length) console.log(`  技能: ${cfg.role.skills.join(', ')}`);
    console.log(`  绑定于: ${cfg.role.boundAt}`);
    return;
  }

  let change: RoleChange = {
    clear: opts.clear,
    skills: parseSkills(opts.skills),
    now: new Date().toISOString(),
  };
  if (opts.refresh) {
    const agent = cfg.role?.agent;
    if (!agent) throw new Error(`bot "${botId}" 未绑定角色，无法 --refresh。`);
    const persona = await readAgentPersona(agent);
    if (!persona) throw new Error(`未找到 agent "${agent}" 的定义，无法刷新。`);
    change = { ...change, agent, persona };
  } else if (opts.agent) {
    const persona = await readAgentPersona(opts.agent);
    if (!persona) {
      throw new Error(`未找到 agent "${opts.agent}"（~/.claude/agents/${opts.agent}.md 不存在）`);
    }
    change = { ...change, agent: opts.agent, persona };
  } else if (opts.skills && !cfg.role) {
    throw new Error(`bot "${botId}" 未绑定角色，请先 \`role ${botId} --agent <name>\` 再设技能。`);
  }

  const updated = nextRole(cfg.role, change);
  const nextCfg = await buildEncryptedAccountConfig(
    cfg.accounts.app.id,
    cfg.accounts.app.tenant,
    cfg.preferences,
    updated,
  );
  await saveConfig(nextCfg, configPath);

  if (!updated) console.log(`✓ 已解绑 bot "${botId}" 的角色。`);
  else {
    console.log(
      `✓ bot "${botId}" 角色 → ${updated.agent}${updated.skills?.length ? ` (skills: ${updated.skills.join(', ')})` : ''}`,
    );
  }
  console.log(`  重启生效: lark-channel-bridge restart --bot ${botId}`);
}
