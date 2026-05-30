import { ClaudeAdapter } from '../../agent/claude/adapter';
import { isComplete } from '../../config/schema';
import { getBot, listBots } from '../../bot/bot-registry';
import { paths } from '../../config/paths';
import { loadConfig } from '../../config/store';
import { daemonStderrPath, daemonStdoutPath } from '../../daemon/paths';
import {
  getServiceAdapter,
  type ServiceAdapter,
  type ServiceResultLike,
} from '../../daemon/service-adapter';
import { readAndPrune, type ProcessEntry } from '../../runtime/registry';
import { preFlightChecks } from '../preflight';

export interface ServiceStartOptions {
  /** Skip lark-cli auto-install + bind during `start`. */
  skipCheckLarkCli?: boolean;
  bot?: string;
}

/**
 * Resolve the adapter for the current platform, or exit with a helpful
 * message. All service-level commands gate on this.
 */
function requireAdapter(cmdName: string, botId?: string): ServiceAdapter {
  const adapter = getServiceAdapter(botId);
  if (!adapter) {
    console.error(
      `${cmdName}: 当前系统不支持后台运行。`,
    );
    console.error('  目前支持: macOS (launchd) / Linux (systemd)');
    console.error('  Windows 支持后续版本。');
    process.exit(1);
  }
  return adapter;
}

/**
 * Strip the misleading "Try re-running the command as root for richer
 * errors" line that launchctl always appends — it's incorrect for our
 * per-user LaunchAgents domain. Running as root targets a different
 * domain (system-wide) and won't even see our plist.
 */
function formatServiceStderr(stderr: string): string {
  return stderr
    .split('\n')
    .filter((line) => !/re-running the command as root/i.test(line))
    .join('\n')
    .trim();
}

async function resolveConfigPath(botId?: string): Promise<string> {
  if (!botId) return paths.configFile;
  const bot = await getBot(botId);
  if (!bot) {
    throw new Error(`未找到 bot "${botId}"。用 \`lark-channel-bridge ps\` 查看已配置的 bot。`);
  }
  return bot.configPath;
}

async function ensureOneConfigured(botId: string): Promise<void> {
  const cfgPath = await resolveConfigPath(botId);
  const cfg = await loadConfig(cfgPath);
  if (!isComplete(cfg)) {
    throw new Error(`bot "${botId}" 还没配置 app 凭据。请先运行 \`run --bot ${botId}\` 完成首次扫码向导。`);
  }
}

/**
 * Poll `~/.lark-channel/processes.json` for a freshly-registered bridge
 * instance whose appId matches our config and whose `botName` is filled —
 * the latter only happens AFTER the WS handshake to Feishu succeeds, so
 * by the time we see it the daemon is genuinely online.
 *
 * `beforePids` is the set of pids already running before we kicked off
 * the start/restart; we exclude them so the previous daemon instance
 * (in restart scenarios, briefly) or a separate foreground `run` doesn't
 * get misreported as our newly-spawned one.
 */
async function waitForServiceConnect(
  appId: string,
  beforePids: ReadonlySet<number>,
  timeoutMs = 30_000,
): Promise<ProcessEntry | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const live = readAndPrune();
    const fresh = live.find(
      (e) => e.appId === appId && !beforePids.has(e.pid) && Boolean(e.botName),
    );
    if (fresh) return fresh;
    await new Promise((r) => setTimeout(r, 500));
  }
  return undefined;
}

/**
 * Snapshot current pids for this app + invoke the OS service action +
 * wait for a fresh registry entry, then print the same connection line
 * `run` uses. Throws on service failure; warns (no throw) on connect timeout.
 */
async function reportConnectAfter(
  verb: 'started' | 'restarted',
  fn: () => ServiceResultLike,
  botId?: string,
): Promise<void> {
  const cfgPath = await resolveConfigPath(botId);
  const cfg = await loadConfig(cfgPath);
  const appId = cfg.accounts?.app?.id ?? '';
  const beforePids = new Set(
    readAndPrune()
      .filter((e) => e.appId === appId)
      .map((e) => e.pid),
  );

  const r = await fn();
  if (!r.ok) {
    throw new Error(formatServiceStderr(r.stderr) || `${verb} failed`);
  }

  const action = verb === 'started' ? '正在等待 bot 连接...' : '正在等待 bot 重新连接...';
  console.log(action);

  const entry = await waitForServiceConnect(appId, beforePids);
  if (entry) {
    const agent = new ClaudeAdapter();
    const verbZh = verb === 'started' ? '已启动' : '已重启';
    console.log(
      `✓ ${verbZh}  bot: ${entry.botName} (${entry.appId})  agent: ${agent.displayName} (${agent.id})  进程: ${entry.id}`,
    );
    return;
  }
  console.warn(`⚠ 已下发指令,但 30 秒内未观察到 bot 连接成功 (${verb})。`);
  console.warn(`  查看日志: tail -f ${daemonStderrPath(botId)}`);
  console.warn(`              tail -f ${daemonStdoutPath(botId)}`);
}

// ── per-bot helpers (throw on error, no process.exit) ──────────────────

async function startOneBot(botId: string, skipCheckLarkCli?: boolean): Promise<void> {
  const adapter = getServiceAdapter(botId);
  if (!adapter) throw new Error('platform not supported');

  await ensureOneConfigured(botId);
  await adapter.install();

  if (adapter.isRunning()) {
    console.log('  检测到旧 bot 实例,先停掉再重启...');
    const r = await adapter.stop();
    if (!r.ok) console.warn(`  ⚠ 停止旧实例时有警告: ${formatServiceStderr(r.stderr)}`);
    const ok = await adapter.waitUntilStopped();
    if (!ok) throw new Error('旧 bot 实例没有完全停止。请稍后重试。');
  }

  await reportConnectAfter('started', adapter.start, botId);
}

async function stopOneBot(botId: string): Promise<void> {
  const adapter = getServiceAdapter(botId);
  if (!adapter) throw new Error('platform not supported');

  if (!adapter.fileExists()) {
    throw new Error('还没在后台运行过');
  }
  if (!adapter.isRunning()) {
    throw new Error('当前没在后台运行');
  }

  const cfgPath = await resolveConfigPath(botId);
  const cfg = await loadConfig(cfgPath);
  const appId = cfg.accounts?.app?.id;
  const entry = appId
    ? readAndPrune().find((e) => e.appId === appId && Boolean(e.botName))
    : undefined;

  const r = await adapter.stopAndDisableAutostart();
  if (!r.ok) {
    throw new Error(formatServiceStderr(r.stderr) || 'stop failed');
  }

  const label = entry ? `${entry.botName} (${entry.appId})` : botId;
  console.log(`✓ bot ${label} 已停止运行`);
}

async function restartOneBot(botId: string): Promise<void> {
  const adapter = getServiceAdapter(botId);
  if (!adapter) throw new Error('platform not supported');

  if (!adapter.fileExists()) {
    throw new Error('还没在后台运行过。请先运行 `start --bot ' + botId + '` 启动。');
  }

  if (adapter.isRunning()) {
    await reportConnectAfter('restarted', adapter.restart, botId);
    return;
  }
  await reportConnectAfter('started', adapter.start, botId);
}

async function statusOneBot(botId: string): Promise<void> {
  const adapter = getServiceAdapter(botId);
  if (!adapter) throw new Error('platform not supported');

  const cfgPath = await resolveConfigPath(botId);
  const cfg = await loadConfig(cfgPath);
  const appId = cfg.accounts?.app?.id;
  const entry = appId
    ? readAndPrune().find((e) => e.appId === appId && Boolean(e.botName))
    : undefined;

  const running = adapter.isRunning();
  if (!adapter.fileExists() && !running) {
    console.log(`  ${botId}: 从未启动过`);
    return;
  }

  const { pid, lastExit } = adapter.parseStatus(adapter.describeStatus());
  const label = entry?.botName ? `${entry.botName} (${entry.appId})` : botId;
  if (running) {
    console.log(`  ${botId}: ✓ ${label}  运行中${pid ? `  pid=${pid}` : ''}`);
  } else {
    console.log(`  ${botId}: ✗ ${label}  已停止${lastExit && lastExit !== '-1' ? `  exit=${lastExit}` : ''}`);
  }
}

async function unregisterOneBot(botId: string): Promise<void> {
  const adapter = getServiceAdapter(botId);
  if (!adapter) throw new Error('platform not supported');

  if (!adapter.fileExists()) {
    throw new Error('还没在后台运行过,无需清理');
  }

  if (adapter.isRunning()) {
    const r = await adapter.stopAndDisableAutostart();
    if (!r.ok) {
      console.warn(`  ⚠ 停止时有警告: ${formatServiceStderr(r.stderr)}`);
    } else {
      console.log('  ✓ 已停止运行');
    }
  }

  await adapter.deleteFile();
  console.log(`  ✓ 已清除后台运行注册`);
}

// ── public commands (single / bulk dispatch) ───────────────────────────

/**
 * `bridge start` — install (write file + reload) then start.
 *
 * With `--bot <id>`: start a single named bot.
 * Without `--bot`: start ALL registered bots.
 */
export async function runServiceStart(opts: ServiceStartOptions = {}): Promise<void> {
  // Platform check once before the bulk loop.
  requireAdapter('start', opts.bot);

  if (opts.bot) {
    await preFlightChecks({ skipCheckLarkCli: opts.skipCheckLarkCli });
    try {
      await startOneBot(opts.bot, opts.skipCheckLarkCli);
    } catch (err) {
      console.error(`✗ ${(err as Error).message}`);
      process.exit(1);
    }
    return;
  }

  // Bulk mode: start all registered bots.
  const bots = await listBots();
  if (bots.length === 0) {
    console.log('还没有配置任何 bot。用 `lark-channel-bridge add` 创建。');
    return;
  }

  await preFlightChecks({ skipCheckLarkCli: opts.skipCheckLarkCli });

  console.log(`批量启动 ${bots.length} 个 bot...\n`);
  let ok = 0, fail = 0;
  for (const bot of bots) {
    process.stdout.write(`  ${bot.id}`);
    if (bot.botName) process.stdout.write(` (${bot.botName})`);
    process.stdout.write('... ');
    try {
      await startOneBot(bot.id, opts.skipCheckLarkCli);
      ok++;
    } catch (err) {
      const msg = (err as Error).message;
      console.log(`✗ ${msg}`);
      fail++;
    }
  }
  if (ok + fail > 1) {
    console.log(`\n完成: ${ok} 成功, ${fail} 失败`);
  }
}

/**
 * `bridge stop` — stop AND prevent auto-restart on next boot.
 *
 * With `--bot <id>`: stop a single bot.
 * Without `--bot`: stop ALL running bots.
 */
export async function runServiceStop(botId?: string): Promise<void> {
  requireAdapter('stop', botId);

  if (botId) {
    try {
      await stopOneBot(botId);
    } catch (err) {
      const msg = (err as Error).message;
      // "还没在后台运行过" and "当前没在后台运行" are informational, not errors.
      if (msg.includes('还没在后台运行过') || msg.includes('当前没在后台运行')) {
        console.log(msg);
        return;
      }
      console.error(`✗ ${msg}`);
      process.exit(1);
    }
    return;
  }

  // Bulk mode: stop all bots that are running.
  const bots = await listBots();
  if (bots.length === 0) {
    console.log('还没有配置任何 bot。');
    return;
  }

  console.log(`批量停止 ${bots.length} 个 bot...\n`);
  let ok = 0, fail = 0, skipped = 0;
  for (const bot of bots) {
    process.stdout.write(`  ${bot.id}`);
    if (bot.botName) process.stdout.write(` (${bot.botName})`);
    process.stdout.write('... ');
    try {
      await stopOneBot(bot.id);
      ok++;
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('还没在后台运行过') || msg.includes('当前没在后台运行')) {
        console.log(`跳过 (${msg})`);
        skipped++;
      } else {
        console.log(`✗ ${msg}`);
        fail++;
      }
    }
  }
  if (ok + fail + skipped > 1) {
    console.log(`\n完成: ${ok} 成功, ${fail} 失败, ${skipped} 跳过`);
  }
}

/**
 * `bridge restart` — bounce the running daemon in place.
 *
 * With `--bot <id>`: restart a single bot.
 * Without `--bot`: restart ALL registered bots.
 */
export async function runServiceRestart(botId?: string): Promise<void> {
  requireAdapter('restart', botId);

  if (botId) {
    try {
      await restartOneBot(botId);
    } catch (err) {
      console.error(`✗ ${(err as Error).message}`);
      process.exit(1);
    }
    return;
  }

  // Bulk mode: restart all registered bots.
  const bots = await listBots();
  if (bots.length === 0) {
    console.log('还没有配置任何 bot。用 `lark-channel-bridge add` 创建。');
    return;
  }

  console.log(`批量重启 ${bots.length} 个 bot...\n`);
  let ok = 0, fail = 0;
  for (const bot of bots) {
    process.stdout.write(`  ${bot.id}`);
    if (bot.botName) process.stdout.write(` (${bot.botName})`);
    process.stdout.write('... ');
    try {
      await restartOneBot(bot.id);
      ok++;
    } catch (err) {
      console.log(`✗ ${(err as Error).message}`);
      fail++;
    }
  }
  if (ok + fail > 1) {
    console.log(`\n完成: ${ok} 成功, ${fail} 失败`);
  }
}

/** `bridge status` — report whether the daemon is running, with pid + log paths. */
export async function runServiceStatus(botId?: string): Promise<void> {
  requireAdapter('status', botId);

  if (botId) {
    const adapter = getServiceAdapter(botId)!;

    if (!adapter.fileExists()) {
      console.log('bot 当前没在后台运行(从未启动过)');
      console.log('  通过 `start` 启动 bot');
      return;
    }
    if (!adapter.isRunning()) {
      console.log('bot 当前没在后台运行');
      console.log('  通过 `start` 重新启动');
      return;
    }

    const cfgPath = await resolveConfigPath(botId);
    const cfg = await loadConfig(cfgPath);
    const appId = cfg.accounts?.app?.id;
    const entry = appId
      ? readAndPrune().find((e) => e.appId === appId && Boolean(e.botName))
      : undefined;

    const { pid, lastExit } = adapter.parseStatus(adapter.describeStatus());

    if (entry) {
      console.log(`✓ bot ${entry.botName} (${entry.appId}) 正在后台运行`);
    } else {
      console.log('✓ bot 正在后台运行');
    }
    if (pid) console.log(`  进程 ID: ${pid}`);
    console.log('  日志:');
    console.log(`    ${daemonStdoutPath(botId)}`);
    console.log(`    ${daemonStderrPath(botId)}`);
    if (lastExit && lastExit !== '-1') console.log(`  上次退出码: ${lastExit}`);
    return;
  }

  // Bulk mode: show status for all registered bots.
  const bots = await listBots();
  const live = readAndPrune();

  if (bots.length === 0 && live.length === 0) {
    console.log('还没有配置任何 bot。');
    return;
  }

  // Merge bot registry + live processes
  const liveByBotId = new Map<string, ProcessEntry>();
  for (const e of live) {
    if (e.botId) liveByBotId.set(e.botId, e);
  }

  const allIds = new Set(bots.map((b) => b.id));
  for (const e of live) {
    if (e.botId) allIds.add(e.botId);
  }

  const entries: { botId: string; botName?: string; appId?: string; running: boolean; pid?: number }[] = [];
  for (const id of allIds) {
    const bot = bots.find((b) => b.id === id);
    const proc = liveByBotId.get(id);
    entries.push({
      botId: id,
      botName: proc?.botName ?? bot?.botName,
      appId: bot?.appId ?? proc?.appId,
      running: Boolean(proc),
      pid: proc?.pid,
    });
  }

  const runningCount = entries.filter((e) => e.running).length;
  console.log(`# Bot 状态 (${entries.length} 个已配置, ${runningCount} 个运行中)\n`);

  const rows = entries.map((e, idx) => ({
    idx: String(idx + 1),
    botId: e.botId,
    status: e.running ? '运行中' : '已停止',
    pid: e.running ? String(e.pid ?? '?') : '-',
    app: e.botName ? e.botName : (e.appId ? `${e.appId.slice(0, 12)}...` : '-'),
  }));

  const headers = { idx: '#', botId: 'Bot ID', status: '状态', pid: 'PID', app: 'Bot' };
  printTable([headers, ...rows]);

  console.log('\n日志路径:');
  for (const e of entries) {
    console.log(`  ${e.botId}: stdout → ${daemonStdoutPath(e.botId)}`);
    console.log(`  ${' '.repeat(e.botId.length)}  stderr → ${daemonStderrPath(e.botId)}`);
  }
}

/**
 * `bridge unregister` — stop, disable autostart, and remove the service
 * definition file.
 *
 * With `--bot <id>`: unregister a single bot.
 * Without `--bot`: unregister ALL bots.
 */
export async function runServiceUnregister(botId?: string): Promise<void> {
  requireAdapter('unregister', botId);

  if (botId) {
    try {
      await unregisterOneBot(botId);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('还没在后台运行过')) {
        console.log(msg);
        return;
      }
      console.error(`✗ ${msg}`);
      process.exit(1);
    }
    console.log('  (配置 / 日志 / 会话保留在 ~/.lark-channel/)');
    return;
  }

  // Bulk mode: unregister all bots.
  const bots = await listBots();
  if (bots.length === 0) {
    console.log('还没有配置任何 bot。');
    return;
  }

  console.log(`批量清除 ${bots.length} 个 bot 的后台注册...\n`);
  let ok = 0, fail = 0, skipped = 0;
  for (const bot of bots) {
    process.stdout.write(`  ${bot.id}`);
    if (bot.botName) process.stdout.write(` (${bot.botName})`);
    process.stdout.write('... ');
    try {
      await unregisterOneBot(bot.id);
      ok++;
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes('还没在后台运行过')) {
        console.log(`跳过 (${msg})`);
        skipped++;
      } else {
        console.log(`✗ ${msg}`);
        fail++;
      }
    }
  }
  if (ok + fail + skipped > 1) {
    console.log(`\n完成: ${ok} 成功, ${fail} 失败, ${skipped} 跳过`);
  }
  console.log('(配置 / 日志 / 会话保留在 ~/.lark-channel/)');
}

// ── table helpers (shared with ps.ts) ──────────────────────────────────

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
