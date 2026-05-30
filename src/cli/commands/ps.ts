import { listBots } from '../../bot/bot-registry';
import { readAndPrune, resolveTarget, isAlive } from '../../runtime/registry';

export function runPs(): void {
  const live = readAndPrune();
  if (live.length === 0) {
    console.log('当前没有 bot 在运行。');
    return;
  }
  console.log(`# 当前共 ${live.length} 个 bot 在运行\n`);
  const rows = live.map((e, idx) => {
    const ago = formatAgo(Date.now() - new Date(e.startedAt).getTime());
    const app = e.botName ? `${e.botName} (${e.appId})` : e.appId;
    const botLabel = e.botId || '-';
    return {
      idx: String(idx + 1),
      id: e.id,
      pid: String(e.pid),
      bot: botLabel,
      app,
      started: ago,
      version: e.version,
    };
  });
  const headers = { idx: '#', id: 'ID', pid: 'PID', bot: 'Bot', app: 'Bot Name', started: '启动', version: '版本' };
  printTable([headers, ...rows]);
}

/** List all registered bots (running or not) with status. */
export async function runBotsList(): Promise<void> {
  const bots = await listBots();
  const live = readAndPrune();

  if (bots.length === 0 && live.length === 0) {
    console.log('还没有配置任何 bot。');
    console.log('用 `lark-channel-bridge add` 扫码创建第一个 bot。');
    return;
  }

  // Merge: registered bots + running processes not yet in the bot registry
  const liveBotIds = new Set(live.map((e) => e.botId).filter(Boolean) as string[]);
  const allIds = new Set(bots.map((b) => b.id));

  // Add live entries whose botId is not in the registry (e.g. newly started)
  for (const e of live) {
    if (e.botId && !allIds.has(e.botId)) {
      allIds.add(e.botId);
    }
  }

  const entries: {
    botId: string;
    appId?: string;
    botName?: string;
    tenant?: string;
    running: boolean;
    pid?: number;
    processId?: string;
    configPath?: string;
    createdAt?: string;
  }[] = [];

  for (const id of allIds) {
    const bot = bots.find((b) => b.id === id);
    const proc = live.find((e) => e.botId === id);
    entries.push({
      botId: id,
      appId: bot?.appId ?? proc?.appId,
      botName: proc?.botName ?? bot?.botName,
      tenant: bot?.tenant ?? proc?.tenant,
      running: Boolean(proc),
      pid: proc?.pid,
      processId: proc?.id,
      configPath: bot?.configPath ?? proc?.configPath,
      createdAt: bot?.createdAt,
    });
  }

  const runningCount = entries.filter((e) => e.running).length;
  console.log(`# Bot 列表（${entries.length} 个已配置，${runningCount} 个运行中）\n`);

  const rows = entries.map((e, idx) => ({
    idx: String(idx + 1),
    botId: e.botId,
    status: e.running ? '运行中' : '已停止',
    pid: e.running ? String(e.pid) : '-',
    app: e.botName ? `${e.botName}` : (e.appId ? `${e.appId.slice(0, 12)}...` : '-'),
  }));

  const headers = { idx: '#', botId: 'Bot ID', status: '状态', pid: 'PID', app: 'Bot' };
  printTable([headers, ...rows]);

  console.log('\n操作: run --bot <id> | start --bot <id> | stop --bot <id> | kill <pid>');
}

export async function runKillCli(target: string | undefined): Promise<void> {
  if (!target) {
    console.error('用法: lark-channel-bridge kill <bot id 或序号>');
    process.exit(1);
  }
  const entry = resolveTarget(target);
  if (!entry) {
    console.error(`✗ 没找到匹配的 bot:${target}`);
    console.error('  用 `lark-channel-bridge ps` 看可选目标。');
    process.exit(1);
  }
  console.log(`正在关闭 bot ${entry.id}...`);
  try {
    process.kill(entry.pid, 'SIGTERM');
  } catch (err) {
    console.error(`✗ 关闭失败:${(err as Error).message}`);
    process.exit(1);
  }
  // Poll for up to 2s; SIGKILL as last resort. 100ms poll keeps the wait
  // tight on quick exits without spamming kill(0).
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (!isAlive(entry.pid)) {
      console.log(`✓ 已关闭 bot ${entry.id}。`);
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  console.warn('⚠️ 2 秒内没退出,强制关闭。');
  try {
    process.kill(entry.pid, 'SIGKILL');
  } catch (err) {
    console.error(`✗ 强制关闭失败:${(err as Error).message}`);
    process.exit(1);
  }
}

function formatAgo(ms: number): string {
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s 前`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m 前`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h 前`;
  return `${Math.floor(ms / 86_400_000)}d 前`;
}

/** Minimal fixed-width table. Header row is index 0. */
function printTable(rows: Record<string, string>[]): void {
  if (rows.length === 0) return;
  const headerRow = rows[0];
  if (!headerRow) return;
  const cols = Object.keys(headerRow);
  const widths: Record<string, number> = {};
  for (const col of cols) {
    widths[col] = Math.max(...rows.map((r) => displayWidth(r[col] ?? '')));
  }
  for (const r of rows) {
    const line = cols
      .map((c) => padEndDisplay(r[c] ?? '', widths[c] ?? 0))
      .join('  ');
    console.log(line);
  }
}

function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    w += code > 0x2e80 ? 2 : 1;
  }
  return w;
}

function padEndDisplay(s: string, target: number): string {
  const pad = target - displayWidth(s);
  return pad > 0 ? s + ' '.repeat(pad) : s;
}
