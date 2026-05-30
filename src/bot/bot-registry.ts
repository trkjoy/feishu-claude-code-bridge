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
 * The default bot (config.json) always uses the literal id 'default'. The
 * whole daemon machinery special-cases it — bare service name, no `--bot`
 * flag, unsuffixed launcher/log paths (see daemon/paths.ts serviceName +
 * buildLauncherCmd). Keep this in sync with that special-casing.
 */
export const DEFAULT_BOT_ID = 'default';

/**
 * Ensure the default bot (config.json) has an entry in the registry.
 * Called on every start so existing single-bot users get auto-registered
 * without running `add`. Uses the literal id 'default' so the entry lines up
 * with the rest of the daemon machinery (bare service name, no `--bot`).
 * Idempotent — if an entry with the same appId or configPath already
 * exists, it's left alone (and `migrateDefaultBotId` repairs legacy
 * random-hex default ids on the next `start`).
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
  const entry: BotEntry = {
    id: DEFAULT_BOT_ID,
    appId,
    tenant,
    configPath: paths.configFile,
    createdAt: new Date().toISOString(),
  };
  await writeAtomic([...bots, entry], paths.botsFile);
  log.info('bot-registry', 'default-entry-created', { appId, id: DEFAULT_BOT_ID });
  return DEFAULT_BOT_ID;
}

/**
 * Upgrade migration: older bridge versions auto-registered the default bot
 * (config.json) under a RANDOM hex id, while the rest of the daemon
 * special-cases the literal id 'default'. The mismatch made the default
 * bot's OS service name diverge from the legacy bare-name service, risking a
 * duplicate autostart entry after upgrade. Rename the default entry's id to
 * 'default' so it lines up again.
 *
 * Returns `{ oldId }` when a rename happened — the caller cleans up the
 * now-orphaned per-id OS service. Returns null when there's nothing to do.
 * Idempotent: no-op once the default entry already has id 'default', or when
 * a 'default' entry already exists (avoid colliding).
 *
 * Registry-only and side-effect-free w.r.t. OS services — never invoke from
 * the daemon process that a per-id service launched (it would be left with a
 * launcher referencing a bot id that no longer resolves). Drive it from the
 * CLI service commands, which then delete the orphaned service.
 */
export async function migrateDefaultBotId(): Promise<{ oldId: string } | null> {
  const bots = await listBots();
  const def = bots.find((b) => b.configPath === paths.configFile);
  if (!def || def.id === DEFAULT_BOT_ID) return null;
  if (bots.some((b) => b.id === DEFAULT_BOT_ID)) return null;
  const oldId = def.id;
  const next = bots.map((b) => (b.id === oldId ? { ...b, id: DEFAULT_BOT_ID } : b));
  await writeAtomic(next, paths.botsFile);
  log.info('bot-registry', 'default-id-migrated', { oldId });
  return { oldId };
}
