import { homedir } from 'node:os';
import { join } from 'node:path';

const appDir = join(homedir(), '.lark-channel');

/**
 * Config path for a named bot. When `botId` is undefined the default
 * config.json is returned. Named bots use config-<botId>.json.
 */
export function configPathFor(botId?: string): string {
  if (!botId) return join(appDir, 'config.json');
  return join(appDir, `config-${botId}.json`);
}

export const paths = {
  appDir,
  cacheDir: appDir,
  configFile: join(appDir, 'config.json'),
  sessionsFile: join(appDir, 'sessions.json'),
  workspacesFile: join(appDir, 'workspaces.json'),
  processesFile: join(appDir, 'processes.json'),
  botsFile: join(appDir, 'bots.json'),
  asksDir: join(appDir, 'asks'),
  secretsFile: join(appDir, 'secrets.enc'),
  keystoreSaltFile: join(appDir, '.keystore.salt'),
  /**
   * Thin shell wrapper that lark-cli (and other openclaw-exec-protocol
   * consumers) invoke to resolve secrets from the bridge's encrypted store.
   * Written user-owned and non-symlinked so it passes lark-cli's
   * AssertSecurePath audit on machines where `node` is a Homebrew/Volta
   * symlink or root-owned (`/usr/bin/node`). Wrapper internals do the
   * `node ... secrets get` invocation; lark-cli only audits the wrapper.
   */
  secretsGetterScript: join(
    appDir,
    process.platform === 'win32' ? 'secrets-getter.cmd' : 'secrets-getter',
  ),
  mediaDir: join(appDir, 'media'),
};

/**
 * Pre-0.1.11 paths (XDG-style). Kept here only so the `migrate` command
 * can detect and move data out of the old location. Don't reference these
 * anywhere in the runtime.
 */
export const legacyPaths = {
  appDir: join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'),
    'lark-channel-bridge',
  ),
  cacheDir: join(
    process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'),
    'lark-channel-bridge',
  ),
};
