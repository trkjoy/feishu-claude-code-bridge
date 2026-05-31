import { randomBytes } from 'node:crypto';
import * as p from '@clack/prompts';
import { runRegistrationWizard } from '../../bot/wizard';
import { getBot, registerBot } from '../../bot/bot-registry';
import { listAgents, readAgentPersona } from '../../bot/agent-catalog';
import { configPathFor } from '../../config/paths';
import { setSecret } from '../../config/keystore';
import {
  buildEncryptedAccountConfig,
  saveConfig,
} from '../../config/store';
import { secretKeyForApp, type BotRole } from '../../config/schema';

export interface AddOptions {
  name?: string;
  agent?: string;
  skills?: string;
}

function parseSkills(list?: string): string[] | undefined {
  if (!list) return undefined;
  const skills = list.split(',').map((s) => s.trim()).filter(Boolean);
  return skills.length ? skills : undefined;
}

/**
 * Resolve an optional bound role. `--agent` snapshots non-interactively; with
 * no flag, offer an interactive picker over ~/.claude/agents (skip if none).
 * Returns undefined when the user skips or no agents are available.
 */
async function resolveRole(opts: AddOptions, now: string): Promise<BotRole | undefined> {
  if (opts.agent) {
    const persona = await readAgentPersona(opts.agent);
    if (!persona) {
      throw new Error(`未找到 agent "${opts.agent}"（~/.claude/agents/${opts.agent}.md 不存在）`);
    }
    return { agent: opts.agent, systemPrompt: persona, skills: parseSkills(opts.skills), boundAt: now };
  }
  const agents = await listAgents();
  if (agents.length === 0) {
    console.log('未检测到团队 agent（~/.claude/agents 为空或不存在），跳过角色绑定。');
    return undefined;
  }
  const picked = await p.select({
    message: '为这个 bot 绑定一个团队角色？',
    options: [
      { value: '', label: '跳过（用默认 BRIDGE 角色）' },
      ...agents.map((a) => ({ value: a, label: a })),
    ],
  });
  if (p.isCancel(picked) || !picked) return undefined;
  const persona = await readAgentPersona(picked as string);
  if (!persona) return undefined;
  return { agent: picked as string, systemPrompt: persona, skills: parseSkills(opts.skills), boundAt: now };
}

/**
 * Resolve a bot id BEFORE we write any secret / config to disk. Catching a
 * collision up front avoids the failure mode where setSecret + saveConfig
 * already ran (saveConfig would clobber an existing bot's config-<id>.json)
 * and only then registerBot throws on the duplicate id, orphaning the write.
 */
async function resolveBotId(name?: string): Promise<string> {
  if (name) {
    if (await getBot(name)) {
      throw new Error(`bot id "${name}" 已存在。换一个 --name，或先 \`ps\` 查看已有 bot。`);
    }
    return name;
  }
  // Auto id: retry on the (1/65536) hex collision so we never proceed with
  // an id that already maps to a configured bot.
  for (let i = 0; i < 10; i++) {
    const id = randomBytes(2).toString('hex');
    if (!(await getBot(id))) return id;
  }
  // Pathologically unlucky — widen the space as a last resort.
  return randomBytes(4).toString('hex');
}

export async function runAdd(opts: AddOptions): Promise<void> {
  const cfg = await runRegistrationWizard();

  const botId = await resolveBotId(opts.name?.trim());
  const configPath = configPathFor(botId);

  const role = await resolveRole(opts, new Date().toISOString());

  // Encrypt the secret before writing to disk
  const encrypted = await buildEncryptedAccountConfig(
    cfg.accounts.app.id,
    cfg.accounts.app.tenant,
    cfg.preferences,
    role,
  );
  await setSecret(secretKeyForApp(cfg.accounts.app.id), cfg.accounts.app.secret as string);
  await saveConfig(encrypted, configPath);

  await registerBot({
    id: botId,
    appId: cfg.accounts.app.id,
    tenant: cfg.accounts.app.tenant,
    configPath,
    createdAt: new Date().toISOString(),
  });

  console.log(`\n✓ Bot "${botId}" 已创建`);
  console.log(`  App ID: ${cfg.accounts.app.id}`);
  console.log(`  Tenant: ${cfg.accounts.app.tenant}`);
  if (role) {
    console.log(`  Role:   ${role.agent}${role.skills?.length ? ` (skills: ${role.skills.join(', ')})` : ''}`);
  }
  console.log(`  Config: ${configPath}`);
  console.log('');
  console.log(`启动: lark-channel-bridge run --bot ${botId}`);
  console.log(`后台: lark-channel-bridge start --bot ${botId}`);
}
