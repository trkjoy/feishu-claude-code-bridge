import { homedir } from 'node:os';
import { join } from 'node:path';
import { paths } from '../config/paths';

/**
 * Logical service name root. Per-bot suffix is `.<botId>` for named bots;
 * the default bot (no botId) keeps the bare root for backward compatibility.
 */
const SERVICE_ROOT = 'lark-channel-bridge.bot';

export function serviceName(botId?: string): string {
  if (!botId || botId === 'default') return SERVICE_ROOT;
  return `${SERVICE_ROOT}.${botId}`;
}

// === macOS launchd ===

export function launchAgentLabel(botId?: string): string {
  return `ai.${serviceName(botId)}`;
}

export function launchAgentPlistPath(botId?: string): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${launchAgentLabel(botId)}.plist`);
}

// === Linux systemd (user units) ===

export function systemdUnitName(botId?: string): string {
  return `${serviceName(botId)}.service`;
}

export function systemdUnitPath(botId?: string): string {
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(base, 'systemd', 'user', systemdUnitName(botId));
}

// === Windows Task Scheduler ===

export function windowsTaskName(botId?: string): string {
  return serviceName(botId).split('.').map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('.');
}

export function windowsLauncherCmdPath(botId?: string): string {
  const suffix = botId && botId !== 'default' ? `-${botId}` : '';
  return join(paths.appDir, `daemon-launcher${suffix}.cmd`);
}

// === Daemon log paths (platform-agnostic) ===

export function daemonLogDir(): string {
  return join(paths.appDir, 'logs');
}

export function daemonStdoutPath(botId?: string): string {
  const suffix = botId && botId !== 'default' ? `-${botId}` : '';
  return join(daemonLogDir(), `daemon-stdout${suffix}.log`);
}

export function daemonStderrPath(botId?: string): string {
  const suffix = botId && botId !== 'default' ? `-${botId}` : '';
  return join(daemonLogDir(), `daemon-stderr${suffix}.log`);
}
