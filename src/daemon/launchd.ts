import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { dirname } from 'node:path';
import {
  daemonLogDir,
  daemonStderrPath,
  daemonStdoutPath,
  launchAgentLabel,
  launchAgentPlistPath,
} from './paths';

export interface PlistInputs {
  nodePath: string;
  bridgeEntryPath: string;
  envPath: string;
  botId?: string;
}

export function buildPlist(inputs: PlistInputs): string {
  const label = launchAgentLabel(inputs.botId);
  const escape = (s: string): string =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const runArgs = inputs.botId && inputs.botId !== 'default'
    ? `<string>run</string>
        <string>--bot</string>
        <string>${escape(inputs.botId)}</string>`
    : '<string>run</string>';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${label}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${escape(inputs.nodePath)}</string>
        <string>${escape(inputs.bridgeEntryPath)}</string>
        ${runArgs}
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${escape(daemonStdoutPath(inputs.botId))}</string>
    <key>StandardErrorPath</key>
    <string>${escape(daemonStderrPath(inputs.botId))}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${escape(inputs.envPath)}</string>
    </dict>
</dict>
</plist>
`;
}

export async function writePlist(botId?: string): Promise<void> {
  const bridgeEntryPath = process.argv[1];
  if (!bridgeEntryPath) {
    throw new Error('cannot determine bridge entry path (process.argv[1] is empty)');
  }
  const content = buildPlist({
    nodePath: process.execPath,
    bridgeEntryPath,
    envPath: process.env.PATH ?? '',
    botId,
  });
  const plistPath = launchAgentPlistPath(botId);
  await mkdir(dirname(plistPath), { recursive: true });
  await mkdir(daemonLogDir(), { recursive: true });
  await writeFile(plistPath, content, 'utf8');
}

export function plistExists(botId?: string): boolean {
  return existsSync(launchAgentPlistPath(botId));
}

function userTarget(): string {
  return `gui/${userInfo().uid}`;
}

function serviceTarget(botId?: string): string {
  return `${userTarget()}/${launchAgentLabel(botId)}`;
}

interface LaunchctlResult {
  ok: boolean;
  stderr: string;
  stdout: string;
}

function runLaunchctl(args: string[]): LaunchctlResult {
  const r = spawnSync('launchctl', args, { encoding: 'utf8' });
  return {
    ok: r.status === 0,
    stderr: r.stderr ?? '',
    stdout: r.stdout ?? '',
  };
}

export function bootstrap(botId?: string): LaunchctlResult {
  return runLaunchctl(['bootstrap', userTarget(), launchAgentPlistPath(botId)]);
}

export function bootout(botId?: string): LaunchctlResult {
  return runLaunchctl(['bootout', serviceTarget(botId)]);
}

export function kickstart(botId?: string): LaunchctlResult {
  return runLaunchctl(['kickstart', '-k', serviceTarget(botId)]);
}

export function isLoaded(botId?: string): boolean {
  const r = spawnSync('launchctl', ['print', serviceTarget(botId)], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  return r.status === 0;
}

export async function waitUntilUnloaded(botId?: string, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isLoaded(botId)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

export function describeService(botId?: string): string {
  const r = runLaunchctl(['print', serviceTarget(botId)]);
  return r.stdout || r.stderr || '';
}

export async function deletePlist(botId?: string): Promise<void> {
  await rm(launchAgentPlistPath(botId), { force: true });
}
