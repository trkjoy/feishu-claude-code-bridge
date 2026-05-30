import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  daemonLogDir,
  daemonStderrPath,
  daemonStdoutPath,
  windowsLauncherCmdPath,
  windowsTaskName,
} from './paths';

export interface LauncherInputs {
  nodePath: string;
  bridgeEntryPath: string;
  envPath: string;
  botId?: string;
}

export function buildLauncherCmd(inputs: LauncherInputs): string {
  const runArgs = inputs.botId && inputs.botId !== 'default'
    ? ` run --bot "${inputs.botId}"`
    : ' run';
  return [
    '@echo off',
    `set "PATH=${inputs.envPath}"`,
    `"${inputs.nodePath}" "${inputs.bridgeEntryPath}"${runArgs} >> "${daemonStdoutPath(inputs.botId)}" 2>> "${daemonStderrPath(inputs.botId)}"`,
    '',
  ].join('\r\n');
}

async function writeLauncherCmd(botId?: string): Promise<void> {
  const bridgeEntryPath = process.argv[1];
  if (!bridgeEntryPath) {
    throw new Error('cannot determine bridge entry path (process.argv[1] is empty)');
  }
  const content = buildLauncherCmd({
    nodePath: process.execPath,
    bridgeEntryPath,
    envPath: process.env.PATH ?? '',
    botId,
  });
  const cmdPath = windowsLauncherCmdPath(botId);
  await mkdir(dirname(cmdPath), { recursive: true });
  await mkdir(daemonLogDir(), { recursive: true });
  await writeFile(cmdPath, content, 'utf8');
}

interface SchtasksResult {
  ok: boolean;
  stderr: string;
  stdout: string;
}

function runSchtasks(args: string[]): SchtasksResult {
  const r = spawnSync('schtasks', args, { encoding: 'utf8' });
  return {
    ok: r.status === 0,
    stderr: r.stderr ?? '',
    stdout: r.stdout ?? '',
  };
}

export async function installTask(botId?: string): Promise<SchtasksResult> {
  await writeLauncherCmd(botId);
  const taskName = windowsTaskName(botId);
  return runSchtasks([
    '/Create',
    '/F',
    '/SC',
    'ONLOGON',
    '/RL',
    'LIMITED',
    '/TN',
    taskName,
    '/TR',
    `"${windowsLauncherCmdPath(botId)}"`,
  ]);
}

export function runTask(botId?: string): SchtasksResult {
  return runSchtasks(['/Run', '/TN', windowsTaskName(botId)]);
}

export function endTask(botId?: string): SchtasksResult {
  return runSchtasks(['/End', '/TN', windowsTaskName(botId)]);
}

export function disableTask(botId?: string): SchtasksResult {
  return runSchtasks(['/Change', '/TN', windowsTaskName(botId), '/Disable']);
}

export function enableTask(botId?: string): SchtasksResult {
  return runSchtasks(['/Change', '/TN', windowsTaskName(botId), '/Enable']);
}

export function endAndDisable(botId?: string): SchtasksResult {
  const ended = endTask(botId);
  const disabled = disableTask(botId);
  // Both must succeed: /End stops the running process, /Disable prevents the
  // ONLOGON autostart from bringing it back. Surface the first failure with
  // its own stderr. The old `disabled.ok ? disabled : ended.ok ? disabled :
  // ended` masked an /End failure whenever /Disable happened to succeed —
  // reporting stop "ok" while the daemon was still running.
  if (!ended.ok) return ended;
  return disabled;
}

export async function restartTask(botId?: string): Promise<SchtasksResult> {
  endTask(botId);
  await waitUntilStopped(botId);
  return runTask(botId);
}

export function isTaskRegistered(botId?: string): boolean {
  const taskName = windowsTaskName(botId);
  const r = spawnSync('schtasks', ['/Query', '/TN', taskName], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  return r.status === 0;
}

export function isTaskRunning(botId?: string): boolean {
  const taskName = windowsTaskName(botId);
  const r = runSchtasks(['/Query', '/V', '/FO', 'LIST', '/TN', taskName]);
  if (!r.ok) return false;
  return /Status:\s+Running/i.test(r.stdout);
}

export function describeTask(botId?: string): string {
  const taskName = windowsTaskName(botId);
  const r = runSchtasks(['/Query', '/V', '/FO', 'LIST', '/TN', taskName]);
  return r.stdout || r.stderr || '';
}

export async function waitUntilStopped(botId?: string, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isTaskRunning(botId)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

export async function deleteTask(botId?: string): Promise<SchtasksResult> {
  const taskName = windowsTaskName(botId);
  const r = runSchtasks(['/Delete', '/F', '/TN', taskName]);
  if (existsSync(windowsLauncherCmdPath(botId))) {
    await rm(windowsLauncherCmdPath(botId), { force: true });
  }
  return r;
}
