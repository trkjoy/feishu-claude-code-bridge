import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  daemonLogDir,
  daemonStderrPath,
  daemonStdoutPath,
  systemdUnitName,
  systemdUnitPath,
} from './paths';

export interface UnitInputs {
  nodePath: string;
  bridgeEntryPath: string;
  envPath: string;
  botId?: string;
}

export function buildUnit(inputs: UnitInputs): string {
  const unitName = systemdUnitName(inputs.botId);
  const escape = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const runArgs = inputs.botId && inputs.botId !== 'default'
    ? ` run --bot "${escape(inputs.botId)}"`
    : ' run';
  return `[Unit]
Description=Lark Channel Bridge bot${inputs.botId ? ` (${inputs.botId})` : ''}
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart="${escape(inputs.nodePath)}" "${escape(inputs.bridgeEntryPath)}"${runArgs}
Restart=always
RestartSec=5
StandardOutput=append:${daemonStdoutPath(inputs.botId)}
StandardError=append:${daemonStderrPath(inputs.botId)}
Environment="PATH=${escape(inputs.envPath)}"

[Install]
WantedBy=default.target
`;
}

export async function writeUnit(botId?: string): Promise<void> {
  const bridgeEntryPath = process.argv[1];
  if (!bridgeEntryPath) {
    throw new Error('cannot determine bridge entry path (process.argv[1] is empty)');
  }
  const content = buildUnit({
    nodePath: process.execPath,
    bridgeEntryPath,
    envPath: process.env.PATH ?? '',
    botId,
  });
  const unitPath = systemdUnitPath(botId);
  await mkdir(dirname(unitPath), { recursive: true });
  await mkdir(daemonLogDir(), { recursive: true });
  await writeFile(unitPath, content, 'utf8');
}

export function unitExists(botId?: string): boolean {
  return existsSync(systemdUnitPath(botId));
}

interface SystemctlResult {
  ok: boolean;
  stderr: string;
  stdout: string;
}

function runSystemctl(args: string[]): SystemctlResult {
  const r = spawnSync('systemctl', ['--user', ...args], { encoding: 'utf8' });
  return {
    ok: r.status === 0,
    stderr: r.stderr ?? '',
    stdout: r.stdout ?? '',
  };
}

export function daemonReload(): SystemctlResult {
  return runSystemctl(['daemon-reload']);
}

export function enableAndStart(botId?: string): SystemctlResult {
  return runSystemctl(['enable', '--now', systemdUnitName(botId)]);
}

export function stop(botId?: string): SystemctlResult {
  return runSystemctl(['stop', systemdUnitName(botId)]);
}

export function disableAndStop(botId?: string): SystemctlResult {
  return runSystemctl(['disable', '--now', systemdUnitName(botId)]);
}

export function restart(botId?: string): SystemctlResult {
  return runSystemctl(['restart', systemdUnitName(botId)]);
}

export function isActive(botId?: string): boolean {
  const r = spawnSync('systemctl', ['--user', 'is-active', systemdUnitName(botId)], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  return r.status === 0;
}

export function describeService(botId?: string): string {
  const r = runSystemctl(['status', systemdUnitName(botId), '--no-pager']);
  return r.stdout || r.stderr || '';
}

export async function waitUntilInactive(botId?: string, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isActive(botId)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

export async function deleteUnit(botId?: string): Promise<void> {
  await rm(systemdUnitPath(botId), { force: true });
}
