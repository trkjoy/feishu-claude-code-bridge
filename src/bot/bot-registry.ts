import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { paths } from '../config/paths';
import type { TenantBrand } from '../config/schema';
import { log } from '../core/logger';

/**
 * Persistent registry of all configured bots on this machine.
 * Separate from the runtime process registry (processes.json) — that one
 * tracks running processes; this one tracks which bots exist at all.
 *
 * File: ~/.lark-channel/bots.json
 */

export interface BotEntry {
  id: string;
  appId: string;
  tenant: TenantBrand;
  botName?: string;
  configPath: string;
  createdAt: string;
}

interface RegistryFile {
  entries: BotEntry[];
}

const EMPTY: RegistryFile = { entries: [] };

function isValidEntry(e: unknown): e is BotEntry {
  if (!e || typeof e !== 'object') return false;
  const x = e as Record<string, unknown>;
  return (
    typeof x.id === 'string' &&
    typeof x.appId === 'string' &&
    (x.tenant === 'feishu' || x.tenant === 'lark') &&
    typeof x.configPath === 'string' &&
    typeof x.createdAt === 'string'
  );
}

async function readRaw(path: string): Promise<RegistryFile> {
  try {
    const text = await readFile(path, 'utf8');
    const parsed = JSON.parse(text) as Partial<RegistryFile>;
    if (!parsed || !Array.isArray(parsed.entries)) return { ...EMPTY };
    return { entries: parsed.entries.filter(isValidEntry) };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ...EMPTY };
    throw err;
  }
}

async function writeAtomic(entries: BotEntry[], path: string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}`;
  const body = `${JSON.stringify({ entries } satisfies RegistryFile, null, 2)}\n`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(tmp, body, 'utf8');
  await rename(tmp, path);
}

export async function listBots(): Promise<BotEntry[]> {
  return (await readRaw(paths.botsFile)).entries;
}

export async function getBot(id: string): Promise<BotEntry | undefined> {
  const bots = await listBots();
  return bots.find((b) => b.id === id);
}

export async function getBotByAppId(appId: string): Promise<BotEntry | undefined> {
  const bots = await listBots();
  return bots.find((b) => b.appId === appId);
}

export async function registerBot(entry: BotEntry): Promise<void> {
  const bots = await listBots();
  if (bots.some((b) => b.id === entry.id)) {
    throw new Error(`Bot id "${entry.id}" already exists`);
  }
  await writeAtomic([...bots, entry], paths.botsFile);
}

export async function removeBot(id: string): Promise<boolean> {
  const bots = await listBots();
  const next = bots.filter((b) => b.id !== id);
  if (next.length === bots.length) return false;
  await writeAtomic(next, paths.botsFile);
  return true;
}

export async function updateBot(
  id: string,
  patch: Partial<Pick<BotEntry, 'botName' | 'tenant'>>,
): Promise<void> {
  const bots = await listBots();
  let changed = false;
  const next = bots.map((b) => {
    if (b.id !== id) return b;
    changed = true;
    return { ...b, ...patch };
  });
  if (!changed) return;
  await writeAtomic(next, paths.botsFile);
}

/**
 * Ensure the default bot (config.json) has an entry in the registry.
 * Called on every start so existing single-bot users get auto-registered
 * without running `add`. Generates a real short ID for the entry.
 * Idempotent — if an entry with the same appId or configPath already
 * exists, it's left alone.
 */
export async function ensureDefaultBotEntry(
  appId: string,
  tenant: TenantBrand,
): Promise<string> {
  const bots = await listBots();
  const existing = bots.find(
    (b) => b.appId === appId || b.configPath === paths.configFile,
  );
  if (existing) return existing.id;
  const id = randomBytes(2).toString('hex');
  const entry: BotEntry = {
    id,
    appId,
    tenant,
    configPath: paths.configFile,
    createdAt: new Date().toISOString(),
  };
  await writeAtomic([...bots, entry], paths.botsFile);
  log.info('bot-registry', 'default-entry-created', { appId, id });
  return id;
}
