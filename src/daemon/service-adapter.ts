import * as launchd from './launchd';
import { launchAgentPlistPath, systemdUnitPath, windowsTaskName } from './paths';
import * as schtasks from './schtasks';
import * as systemd from './systemd';

export interface ServiceResult {
  ok: boolean;
  stderr: string;
}

export type ServiceResultLike = ServiceResult | Promise<ServiceResult>;

export interface ServiceAdapter {
  readonly platformName: string;

  fileExists(): boolean;
  isRunning(): boolean;
  servicePath(): string;
  install(): Promise<void>;
  start(): ServiceResultLike;
  stop(): ServiceResultLike;
  stopAndDisableAutostart(): ServiceResultLike;
  restart(): ServiceResultLike;
  waitUntilStopped(timeoutMs?: number): Promise<boolean>;
  deleteFile(): Promise<void>;
  describeStatus(): string;
  parseStatus(text: string): { pid?: string; lastExit?: string };
}

function makeLaunchdAdapter(botId?: string): ServiceAdapter {
  const bid = botId;
  return {
    platformName: 'launchd (macOS)',
    fileExists: () => launchd.plistExists(bid),
    isRunning: () => launchd.isLoaded(bid),
    servicePath: () => launchAgentPlistPath(bid),
    install: () => launchd.writePlist(bid),
    start: () => launchd.bootstrap(bid),
    stop: () => launchd.bootout(bid),
    stopAndDisableAutostart: () => launchd.bootout(bid),
    restart: () => launchd.kickstart(bid),
    waitUntilStopped: (t?: number) => launchd.waitUntilUnloaded(bid, t),
    deleteFile: () => launchd.deletePlist(bid),
    describeStatus: () => launchd.describeService(bid),
    parseStatus: (text) => ({
      pid: text.match(/pid\s*=\s*(\d+)/)?.[1],
      lastExit: text.match(/last exit code\s*=\s*(-?\d+)/i)?.[1],
    }),
  };
}

function makeSystemdAdapter(botId?: string): ServiceAdapter {
  const bid = botId;
  return {
    platformName: 'systemd (Linux user)',
    fileExists: () => systemd.unitExists(bid),
    isRunning: () => systemd.isActive(bid),
    servicePath: () => systemdUnitPath(bid),
    install: async () => {
      await systemd.writeUnit(bid);
      systemd.daemonReload();
    },
    start: () => systemd.enableAndStart(bid),
    stop: () => systemd.stop(bid),
    stopAndDisableAutostart: () => systemd.disableAndStop(bid),
    restart: () => systemd.restart(bid),
    waitUntilStopped: (t?: number) => systemd.waitUntilInactive(bid, t),
    deleteFile: async () => {
      await systemd.deleteUnit(bid);
      systemd.daemonReload();
    },
    describeStatus: () => systemd.describeService(bid),
    parseStatus: (text) => ({
      pid: text.match(/Main PID:\s*(\d+)/)?.[1],
      lastExit: text.match(/Process:\s+\d+\s+ExecStart=.*status=(\d+)/)?.[1],
    }),
  };
}

function makeSchtasksAdapter(botId?: string): ServiceAdapter {
  const bid = botId;
  const taskName = () => windowsTaskName(bid);
  return {
    platformName: 'Task Scheduler (Windows)',
    fileExists: () => schtasks.isTaskRegistered(bid),
    isRunning: () => schtasks.isTaskRunning(bid),
    servicePath: () => taskName(),
    install: async () => {
      const r = await schtasks.installTask(bid);
      if (!r.ok) throw new Error(r.stderr || 'schtasks /Create failed');
    },
    start: () => schtasks.runTask(bid),
    stop: () => schtasks.endTask(bid),
    stopAndDisableAutostart: () => schtasks.endAndDisable(bid),
    restart: () => schtasks.restartTask(bid),
    waitUntilStopped: (t?: number) => schtasks.waitUntilStopped(bid, t),
    deleteFile: async () => {
      await schtasks.deleteTask(bid);
    },
    describeStatus: () => schtasks.describeTask(bid),
    parseStatus: (text) => ({
      pid: text.match(/Process ID:\s*(\d+)/i)?.[1],
      lastExit: text.match(/Last Result:\s*(\d+)/i)?.[1],
    }),
  };
}

export function getServiceAdapter(botId?: string): ServiceAdapter | null {
  if (process.platform === 'darwin') return makeLaunchdAdapter(botId);
  if (process.platform === 'linux') return makeSystemdAdapter(botId);
  if (process.platform === 'win32') return makeSchtasksAdapter(botId);
  return null;
}
