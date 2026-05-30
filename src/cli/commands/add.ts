import { randomBytes } from 'node:crypto';
import { runRegistrationWizard } from '../../bot/wizard';
import { registerBot } from '../../bot/bot-registry';
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

export async function runAdd(opts: AddOptions): Promise<void> {
  const cfg = await runRegistrationWizard();

  const botId = opts.name?.trim() || randomBytes(2).toString('hex');
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
