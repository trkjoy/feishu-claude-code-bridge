import { randomBytes } from 'node:crypto';
import { runRegistrationWizard } from '../../bot/wizard';
import { getBot, registerBot } from '../../bot/bot-registry';
import { configPathFor } from '../../config/paths';
import { setSecret } from '../../config/keystore';
import {
  buildEncryptedAccountConfig,
  saveConfig,
} from '../../config/store';
import { secretKeyForApp } from '../../config/schema';

export interface AddOptions {
  name?: string;
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

  // Encrypt the secret before writing to disk
  const encrypted = await buildEncryptedAccountConfig(
    cfg.accounts.app.id,
    cfg.accounts.app.tenant,
    cfg.preferences,
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
  console.log(`  Config: ${configPath}`);
  console.log('');
  console.log(`启动: lark-channel-bridge run --bot ${botId}`);
  console.log(`后台: lark-channel-bridge start --bot ${botId}`);
}
