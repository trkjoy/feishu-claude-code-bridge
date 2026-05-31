# Bot ↔ Team-Agent Role Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a bot optionally adopt a standard-team agent persona + preferred-skill hints (snapshotted at bind time), injected into that bot's `claude` process; default bot defaults to orchestrator.

**Architecture:** Persona is snapshotted into the bot's own config (`role` block) at `add`/`role` time — runtime never reads `~/.claude/agents`. Injection happens once via the `ClaudeAdapter` constructor (covers every `agent.run` callsite). Phase A only: bots stay independent, no cross-bot dispatch.

**Tech Stack:** TypeScript, Node.js, commander, @clack/prompts, vitest. Commands: `pnpm typecheck`, `pnpm test [path]`, `pnpm build`.

**Spec:** `docs/plans/2026-05-31-bot-agent-role-binding-design.md`

**Refinement vs spec:** injection is done at adapter **construction** (`start.ts`), not per-run in `channel.ts` — strictly DRYer and covers `channel.ts`, `comments.ts`, `commands/index.ts` run callsites at once.

---

### Task 1: Agent catalog module

**Files:**
- Create: `src/bot/agent-catalog.ts`
- Test: `test/bot/agent-catalog.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { stripFrontmatter, listAgents, readAgentPersona } from '../../src/bot/agent-catalog';

const dirs: string[] = [];
afterEach(() => { while (dirs.length) { const d = dirs.pop(); if (d) rmSync(d, { recursive: true, force: true }); } });
function tmp(): string { const d = mkdtempSync(join(tmpdir(), 'agents-')); dirs.push(d); return d; }

describe('stripFrontmatter', () => {
  it('removes a leading YAML frontmatter block', () => {
    const md = '---\nname: x\ndescription: y\n---\n\nBODY line 1\nBODY line 2\n';
    expect(stripFrontmatter(md)).toBe('BODY line 1\nBODY line 2');
  });
  it('returns the input trimmed when there is no frontmatter', () => {
    expect(stripFrontmatter('no front\nmatter\n')).toBe('no front\nmatter');
  });
});

describe('listAgents / readAgentPersona', () => {
  it('lists agent names from a directory and reads a stripped persona', async () => {
    const d = tmp();
    writeFileSync(join(d, 'orchestrator.md'), '---\nname: orchestrator\n---\nYou conduct.\n');
    writeFileSync(join(d, 'backend-architect.md'), '---\nname: backend-architect\n---\nYou build APIs.\n');
    writeFileSync(join(d, 'notes.txt'), 'ignore me');
    expect((await listAgents(d)).sort()).toEqual(['backend-architect', 'orchestrator']);
    expect(await readAgentPersona('orchestrator', d)).toBe('You conduct.');
  });
  it('degrades gracefully when the directory is absent', async () => {
    expect(await listAgents(join(tmp(), 'nope'))).toEqual([]);
    expect(await readAgentPersona('x', join(tmp(), 'nope'))).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test test/bot/agent-catalog.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Default location of the standard-team agent definitions. */
export function agentsDir(): string {
  return join(homedir(), '.claude', 'agents');
}

/** Strip a leading YAML frontmatter block (--- ... ---); trim the rest. */
export function stripFrontmatter(md: string): string {
  const m = /^---\n[\s\S]*?\n---\n?/.exec(md);
  return (m ? md.slice(m[0].length) : md).trim();
}

/** Agent names (filenames without .md). Empty array if the dir is absent. */
export async function listAgents(dir: string = agentsDir()): Promise<string[]> {
  try {
    const files = await readdir(dir);
    return files.filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

/** Read <name>.md, strip frontmatter, return the persona body. undefined if missing. */
export async function readAgentPersona(
  name: string,
  dir: string = agentsDir(),
): Promise<string | undefined> {
  try {
    const text = await readFile(join(dir, `${name}.md`), 'utf8');
    return stripFrontmatter(text);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test test/bot/agent-catalog.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/bot/agent-catalog.ts test/bot/agent-catalog.test.ts
git commit -m "feat(role): agent catalog (list/read/strip ~/.claude/agents)"
```

---

### Task 2: BotRole schema + getRoleSystemPrompt

**Files:**
- Modify: `src/config/schema.ts`
- Test: `test/config/role-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { getRoleSystemPrompt, type AppConfig } from '../../src/config/schema';

const base: AppConfig = {
  accounts: { app: { id: 'cli_x', secret: 's', tenant: 'feishu' } },
};

describe('getRoleSystemPrompt', () => {
  it('returns empty string when no role is set', () => {
    expect(getRoleSystemPrompt(base)).toBe('');
  });
  it('includes the persona and skill hints when a role is set', () => {
    const out = getRoleSystemPrompt({
      ...base,
      role: { agent: 'backend-architect', systemPrompt: 'You build APIs.', skills: ['code-review', 'lark-base'], boundAt: '2026-05-31T00:00:00.000Z' },
    });
    expect(out).toContain('You build APIs.');
    expect(out).toContain('code-review');
    expect(out).toContain('lark-base');
  });
  it('omits the skills section when skills is empty/absent', () => {
    const out = getRoleSystemPrompt({
      ...base,
      role: { agent: 'a', systemPrompt: 'Persona only.', boundAt: '2026-05-31T00:00:00.000Z' },
    });
    expect(out).toContain('Persona only.');
    expect(out).not.toContain('应优先使用');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test test/config/role-prompt.test.ts`
Expected: FAIL — `getRoleSystemPrompt` / `role` not defined.

- [ ] **Step 3: Write minimal implementation**

In `src/config/schema.ts`, add the interface near `AppPreferences`:

```ts
/**
 * A bot's bound role: a snapshot of a standard-team agent persona plus a list
 * of preferred Claude Code skill names. Snapshotted at bind time so runtime
 * never depends on ~/.claude/agents existing. See bot-agent-role-binding spec.
 */
export interface BotRole {
  /** Source agent name — provenance only, used by `role --refresh`. */
  agent: string;
  /** Snapshot of the agent .md body (frontmatter stripped) at bind time. */
  systemPrompt: string;
  /** Preferred Claude Code skill names, injected as prompt-level guidance. */
  skills?: string[];
  /** ISO timestamp of the bind. */
  boundAt: string;
}
```

Add `role` to `AppConfig`:

```ts
export interface AppConfig {
  accounts: {
    app: AppCredentials;
  };
  secrets?: SecretsConfig;
  preferences?: AppPreferences;
  /** Optional bound role (persona + skill hints). See BotRole. */
  role?: BotRole;
}
```

Add the formatter at the end of the file:

```ts
/**
 * Format the bound role into a system-prompt section appended after the base
 * BRIDGE_SYSTEM_PROMPT. Returns '' when no role is set (→ no injection,
 * current behavior).
 */
export function getRoleSystemPrompt(cfg: AppConfig): string {
  const role = cfg.role;
  if (!role || !role.systemPrompt.trim()) return '';
  const skills = role.skills?.filter((s) => s.trim()) ?? [];
  const skillBlock =
    skills.length > 0
      ? `\n\n## 你具备并应优先使用的技能\n${skills.map((s) => `- ${s}`).join('\n')}`
      : '';
  return `# 你的角色\n\n${role.systemPrompt.trim()}${skillBlock}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test test/config/role-prompt.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts test/config/role-prompt.test.ts
git commit -m "feat(role): BotRole schema + getRoleSystemPrompt formatter"
```

---

### Task 3: Preserve `role` across config rewrites

**Files:**
- Modify: `src/config/store.ts`
- Test: `test/config/store-role.test.ts`

**Context:** `buildEncryptedAccountConfig` rebuilds a fresh config on `/account` change and first-run encryption. It currently preserves only `preferences`. Without preserving `role`, a credential change drops the binding.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { buildEncryptedAccountConfig } from '../../src/config/store';
import type { BotRole } from '../../src/config/schema';

const role: BotRole = { agent: 'backend-architect', systemPrompt: 'You build APIs.', skills: ['code-review'], boundAt: '2026-05-31T00:00:00.000Z' };

describe('buildEncryptedAccountConfig role preservation', () => {
  it('carries an existing role through a rebuild', async () => {
    const next = await buildEncryptedAccountConfig('cli_x', 'feishu', undefined, role);
    expect(next.role).toEqual(role);
  });
  it('leaves role undefined when none is passed', async () => {
    const next = await buildEncryptedAccountConfig('cli_x', 'feishu');
    expect(next.role).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test test/config/store-role.test.ts`
Expected: FAIL — `buildEncryptedAccountConfig` takes only 3 args.

- [ ] **Step 3: Write minimal implementation**

In `src/config/store.ts`, change the signature and return. Add `BotRole` to the type import (`import type { AppConfig, AppPreferences, BotRole, TenantBrand } from './schema';`):

```ts
export async function buildEncryptedAccountConfig(
  appId: string,
  tenant: TenantBrand,
  preferences?: AppPreferences,
  role?: BotRole,
): Promise<AppConfig> {
  const wrapperPath = await ensureSecretsGetterWrapper();
  return {
    accounts: {
      app: {
        id: appId,
        secret: { source: 'exec', provider: 'bridge', id: secretKeyForApp(appId) },
        tenant,
      },
    },
    secrets: {
      providers: {
        bridge: { source: 'exec', command: wrapperPath, args: [] },
      },
    },
    ...(preferences ? { preferences } : {}),
    ...(role ? { role } : {}),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test test/config/store-role.test.ts`
Expected: PASS

- [ ] **Step 5: Thread `role` through the callers**

Update every `buildEncryptedAccountConfig(...)` call to pass the existing role. Find them:

Run: `pnpm exec grep -rn "buildEncryptedAccountConfig(" src` (or use editor search)

Expected callers and the change (pass the source cfg's role):
- `src/cli/commands/start.ts` — `maybeMigratePlaintextSecret` Path A and Path C, and `persistEncrypted`: add `, cfg.role` as the 4th argument (Path A/C have `cfg` in scope; `persistEncrypted` has `cfg`).
- `src/commands/index.ts` — the `/account` change handler (search `buildEncryptedAccountConfig`): pass the current config's `role` (`ctx.controls.cfg.role`).

For each: append `cfg.role` (or `ctx.controls.cfg.role`) as the final argument. Example (start.ts Path A):

```ts
const next = await buildEncryptedAccountConfig(
  cfg.accounts.app.id,
  cfg.accounts.app.tenant,
  cfg.preferences,
  cfg.role,
);
```

- [ ] **Step 6: Run typecheck + targeted tests**

Run: `pnpm typecheck`
Expected: PASS (all callers updated)
Run: `pnpm test test/config/store-role.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/config/store.ts src/cli/commands/start.ts src/commands/index.ts test/config/store-role.test.ts
git commit -m "fix(role): preserve role across config rewrites (/account, secret migration)"
```

---

### Task 4: Adapter system-prompt injection

**Files:**
- Modify: `src/agent/claude/adapter.ts`
- Test: `test/agent/claude/adapter.test.ts` (extend existing file)

- [ ] **Step 1: Write the failing test (append to the existing describe block)**

```ts
import { buildAppendSystemPrompt } from '../../../src/agent/claude/adapter';

describe('buildAppendSystemPrompt', () => {
  it('returns the base prompt unchanged when no role is given', () => {
    const base = buildAppendSystemPrompt();
    expect(base).toContain('lark-channel-bridge 运行约定');
    expect(buildAppendSystemPrompt('')).toBe(base);
    expect(buildAppendSystemPrompt('   ')).toBe(base);
  });
  it('appends the role section after the base prompt', () => {
    const base = buildAppendSystemPrompt();
    const withRole = buildAppendSystemPrompt('# 你的角色\n\nYou build APIs.');
    expect(withRole.startsWith(base)).toBe(true);
    expect(withRole).toContain('You build APIs.');
    expect(withRole.length).toBeGreaterThan(base.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test test/agent/claude/adapter.test.ts`
Expected: FAIL — `buildAppendSystemPrompt` not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/agent/claude/adapter.ts`:

Add to `ClaudeAdapterOptions`:

```ts
export interface ClaudeAdapterOptions {
  binary?: string;
  /** Per-bot role persona + skill hints, appended after BRIDGE_SYSTEM_PROMPT. */
  extraSystemPrompt?: string;
}
```

Add the exported pure helper (after `BRIDGE_SYSTEM_PROMPT` is defined):

```ts
/** Compose the --append-system-prompt value: base bridge prompt, then the
 * optional per-bot role section. Pure — unit tested. */
export function buildAppendSystemPrompt(extra?: string): string {
  return extra && extra.trim()
    ? `${BRIDGE_SYSTEM_PROMPT}\n\n${extra}`
    : BRIDGE_SYSTEM_PROMPT;
}
```

Store the option and use it in `run()`:

```ts
  private readonly binary: string;
  private readonly resolvedBinary: string;
  private readonly extraSystemPrompt?: string;

  constructor(opts: ClaudeAdapterOptions = {}) {
    this.binary = opts.binary ?? 'claude';
    this.resolvedBinary = resolveClaudeBinaryForSpawn(this.binary);
    this.extraSystemPrompt = opts.extraSystemPrompt;
  }
```

In `run()`, replace the literal `BRIDGE_SYSTEM_PROMPT` arg:

```ts
      '--append-system-prompt',
      buildAppendSystemPrompt(this.extraSystemPrompt),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test test/agent/claude/adapter.test.ts`
Expected: PASS (existing 5 tests + 2 new)

- [ ] **Step 5: Commit**

```bash
git add src/agent/claude/adapter.ts test/agent/claude/adapter.test.ts
git commit -m "feat(role): adapter injects per-bot role into --append-system-prompt"
```

---

### Task 5: Wire role into adapter construction at startup

**Files:**
- Modify: `src/cli/commands/start.ts`

**Context:** `agent` is constructed once in `runStart` (currently `const agent = new ClaudeAdapter();`, ~line 109) and flows to `channel.ts` / `comments.ts` / `commands/index.ts`. Injecting at construction covers every run callsite.

- [ ] **Step 1: Update imports**

Add to the existing schema import in `start.ts`:

```ts
import { isComplete, secretKeyForApp, getRoleSystemPrompt } from '../../config/schema';
```

- [ ] **Step 2: Construct the adapter with the role prompt**

Replace `const agent = new ClaudeAdapter();` with:

```ts
  const agent = new ClaudeAdapter({ extraSystemPrompt: getRoleSystemPrompt(cfg) });
```

(At this point `cfg` is finalized. `getRoleSystemPrompt` returns '' when `cfg.role` is unset → identical to today.)

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Build sanity**

Run: `pnpm build`
Expected: Build success

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/start.ts
git commit -m "feat(role): inject bound role into the bot's claude adapter at startup"
```

---

### Task 6: Default bot auto-binds orchestrator (5-A)

**Files:**
- Modify: `src/cli/commands/start.ts`
- Create: `src/bot/default-role.ts`
- Test: `test/bot/default-role.test.ts`

**Context:** On first run of the default bot (configPath === paths.configFile) with no role set, snapshot `orchestrator` if `~/.claude/agents/orchestrator.md` resolves. Idempotent.

- [ ] **Step 1: Write the failing test (pure decision core)**

```ts
import { describe, expect, it } from 'vitest';
import { shouldAutoBindOrchestrator } from '../../src/bot/default-role';
import type { AppConfig } from '../../src/config/schema';

const cfg: AppConfig = { accounts: { app: { id: 'cli_x', secret: 's', tenant: 'feishu' } } };

describe('shouldAutoBindOrchestrator', () => {
  it('binds for the default bot when no role and persona available', () => {
    expect(shouldAutoBindOrchestrator({ isDefaultBot: true, hasRole: false, personaAvailable: true })).toBe(true);
  });
  it('does not bind a named bot', () => {
    expect(shouldAutoBindOrchestrator({ isDefaultBot: false, hasRole: false, personaAvailable: true })).toBe(false);
  });
  it('does not overwrite an existing role', () => {
    expect(shouldAutoBindOrchestrator({ isDefaultBot: true, hasRole: true, personaAvailable: true })).toBe(false);
  });
  it('does not bind when orchestrator.md is absent', () => {
    expect(shouldAutoBindOrchestrator({ isDefaultBot: true, hasRole: false, personaAvailable: false })).toBe(false);
  });
  it('references cfg type to avoid unused import', () => {
    expect(cfg.role).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test test/bot/default-role.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation (`src/bot/default-role.ts`)**

```ts
import { readAgentPersona } from './agent-catalog';
import type { AppConfig } from '../config/schema';

export const ORCHESTRATOR_AGENT = 'orchestrator';

/** Pure gate: bind orchestrator only for the default bot, only when it has no
 * role yet, only when the orchestrator persona is actually available. */
export function shouldAutoBindOrchestrator(input: {
  isDefaultBot: boolean;
  hasRole: boolean;
  personaAvailable: boolean;
}): boolean {
  return input.isDefaultBot && !input.hasRole && input.personaAvailable;
}

/** Returns the cfg unchanged, or a copy with an orchestrator role attached
 * (and the caller should persist it). Pure except for the persona read. */
export async function maybeAttachDefaultRole(
  cfg: AppConfig,
  isDefaultBot: boolean,
  now: string,
): Promise<{ cfg: AppConfig; bound: boolean }> {
  const persona = isDefaultBot && !cfg.role ? await readAgentPersona(ORCHESTRATOR_AGENT) : undefined;
  if (!shouldAutoBindOrchestrator({ isDefaultBot, hasRole: Boolean(cfg.role), personaAvailable: Boolean(persona) })) {
    return { cfg, bound: false };
  }
  return {
    cfg: { ...cfg, role: { agent: ORCHESTRATOR_AGENT, systemPrompt: persona as string, boundAt: now } },
    bound: true,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test test/bot/default-role.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into `start.ts` before adapter construction**

In `runStart`, after `cfg` is finalized (after the `maybeMigratePlaintextSecret` / wizard block, before `const agent = new ClaudeAdapter(...)` from Task 5), insert:

```ts
  // 5-A: the default bot adopts the orchestrator persona on first run, when
  // available. Idempotent — never overwrites an existing role.
  const isDefaultBot = configPath === paths.configFile;
  const attached = await maybeAttachDefaultRole(cfg, isDefaultBot, new Date().toISOString());
  if (attached.bound) {
    cfg = attached.cfg;
    await saveConfig(
      await buildEncryptedAccountConfig(cfg.accounts.app.id, cfg.accounts.app.tenant, cfg.preferences, cfg.role),
      configPath,
    );
    console.log('🎭 默认 bot 已绑定 orchestrator 角色');
  }
```

Add the import:

```ts
import { maybeAttachDefaultRole } from '../../bot/default-role';
```

(`cfg` must be a `let` — it already is in `runStart`. `saveConfig` and `buildEncryptedAccountConfig` are already imported. The Task 5 `new ClaudeAdapter({ extraSystemPrompt: getRoleSystemPrompt(cfg) })` now sees the attached role.)

- [ ] **Step 6: Run typecheck + tests**

Run: `pnpm typecheck`
Expected: PASS
Run: `pnpm test test/bot/default-role.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/bot/default-role.ts test/bot/default-role.test.ts src/cli/commands/start.ts
git commit -m "feat(role): default bot auto-binds orchestrator persona on first run"
```

---

### Task 7: `add` optional agent selection

**Files:**
- Modify: `src/cli/commands/add.ts`
- Modify: `src/cli/index.ts`

**Context:** `runAdd` currently: wizard → resolveBotId → buildEncryptedAccountConfig → setSecret → saveConfig → registerBot. Add an optional role-binding step before building the config. Support non-interactive `--agent` / `--skills` flags and an interactive `@clack/prompts` picker.

- [ ] **Step 1: Extend the CLI command flags in `src/cli/index.ts`**

Replace the `add` command block:

```ts
program
  .command('add')
  .description('Add a new bot — scan QR code, create named config, optionally bind a team role')
  .option('--name <id>', 'bot id (auto-generated if omitted)')
  .option('--agent <name>', 'bind a standard-team agent role (snapshot persona)')
  .option('--skills <list>', 'comma-separated preferred skill names')
  .action(async (opts: { name?: string; agent?: string; skills?: string }) => {
    await runAdd(opts);
  });
```

- [ ] **Step 2: Implement role resolution in `src/cli/commands/add.ts`**

Add imports:

```ts
import * as p from '@clack/prompts';
import { listAgents, readAgentPersona } from '../../bot/agent-catalog';
import type { BotRole } from '../../config/schema';
```

Extend `AddOptions`:

```ts
export interface AddOptions {
  name?: string;
  agent?: string;
  skills?: string;
}
```

Add a resolver (parses flags, else interactive picker, else skip → undefined):

```ts
function parseSkills(list?: string): string[] | undefined {
  if (!list) return undefined;
  const skills = list.split(',').map((s) => s.trim()).filter(Boolean);
  return skills.length ? skills : undefined;
}

async function resolveRole(opts: AddOptions, now: string): Promise<BotRole | undefined> {
  // Non-interactive: explicit --agent.
  if (opts.agent) {
    const persona = await readAgentPersona(opts.agent);
    if (!persona) throw new Error(`未找到 agent "${opts.agent}"（~/.claude/agents/${opts.agent}.md 不存在）`);
    return { agent: opts.agent, systemPrompt: persona, skills: parseSkills(opts.skills), boundAt: now };
  }
  // Interactive picker (terminal only). No agents → skip silently.
  const agents = await listAgents();
  if (agents.length === 0) {
    console.log('未检测到团队 agent（~/.claude/agents 为空或不存在），跳过角色绑定。');
    return undefined;
  }
  const picked = await p.select({
    message: '为这个 bot 绑定一个团队角色？',
    options: [
      { value: '', label: '跳过（用默认 BRIDGE 角色）' },
      ...agents.map((a) => ({ value: a, label: a })),
    ],
  });
  if (p.isCancel(picked) || !picked) return undefined;
  const persona = await readAgentPersona(picked as string);
  if (!persona) return undefined;
  return { agent: picked as string, systemPrompt: persona, skills: parseSkills(opts.skills), boundAt: now };
}
```

Wire it into `runAdd` — resolve the role, then pass it to `buildEncryptedAccountConfig`:

```ts
export async function runAdd(opts: AddOptions): Promise<void> {
  const cfg = await runRegistrationWizard();

  const botId = await resolveBotId(opts.name?.trim());
  const configPath = configPathFor(botId);

  const role = await resolveRole(opts, new Date().toISOString());

  const encrypted = await buildEncryptedAccountConfig(
    cfg.accounts.app.id,
    cfg.accounts.app.tenant,
    cfg.preferences,
    role,
  );
  await setSecret(secretKeyForApp(cfg.accounts.app.id), cfg.accounts.app.secret as string);
  await saveConfig(encrypted, configPath);

  await registerBot({
    id: botId,
    appId: cfg.accounts.app.id,
    tenant: cfg.accounts.app.tenant,
    configPath,
    createdAt: new Date().toISOString(),
  });

  console.log(`\n✓ Bot "${botId}" 已创建`);
  console.log(`  App ID: ${cfg.accounts.app.id}`);
  console.log(`  Tenant: ${cfg.accounts.app.tenant}`);
  if (role) console.log(`  Role:   ${role.agent}${role.skills?.length ? ` (skills: ${role.skills.join(', ')})` : ''}`);
  console.log(`  Config: ${configPath}`);
  console.log('');
  console.log(`启动: lark-channel-bridge run --bot ${botId}`);
  console.log(`后台: lark-channel-bridge start --bot ${botId}`);
}
```

- [ ] **Step 3: Run typecheck + build**

Run: `pnpm typecheck`
Expected: PASS
Run: `pnpm build`
Expected: Build success

- [ ] **Step 4: Manual smoke (optional, terminal only)**

Run: `node bin/lark-channel-bridge.mjs add --help`
Expected: help shows `--agent` and `--skills`.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/add.ts src/cli/index.ts
git commit -m "feat(role): add --agent/--skills + interactive role picker to `add`"
```

---

### Task 8: `role` command (set / show / refresh / clear)

**Files:**
- Create: `src/cli/commands/role.ts`
- Modify: `src/cli/index.ts`
- Test: `test/cli/role.test.ts`

- [ ] **Step 1: Write the failing test (pure transition core)**

```ts
import { describe, expect, it } from 'vitest';
import { nextRole } from '../../src/cli/commands/role';
import type { BotRole } from '../../src/config/schema';

const NOW = '2026-05-31T00:00:00.000Z';
const current: BotRole = { agent: 'a', systemPrompt: 'A persona', skills: ['s1'], boundAt: '2026-01-01T00:00:00.000Z' };

describe('nextRole', () => {
  it('clears the role', () => {
    expect(nextRole(current, { clear: true, now: NOW })).toBeUndefined();
  });
  it('binds a new agent with a fresh persona snapshot', () => {
    const r = nextRole(undefined, { agent: 'b', persona: 'B persona', now: NOW });
    expect(r).toEqual({ agent: 'b', systemPrompt: 'B persona', skills: undefined, boundAt: NOW });
  });
  it('replacing an agent carries skills only when none are given', () => {
    const r = nextRole(current, { agent: 'b', persona: 'B persona', now: NOW });
    expect(r?.skills).toEqual(['s1']);
  });
  it('sets skills on an existing role without changing persona', () => {
    const r = nextRole(current, { skills: ['x', 'y'], now: NOW });
    expect(r).toMatchObject({ agent: 'a', systemPrompt: 'A persona', skills: ['x', 'y'] });
  });
  it('returns current unchanged when setting skills with no existing role', () => {
    expect(nextRole(undefined, { skills: ['x'], now: NOW })).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test test/cli/role.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation (`src/cli/commands/role.ts`)**

```ts
import { getBot } from '../../bot/bot-registry';
import { paths } from '../../config/paths';
import { loadConfig, saveConfig, buildEncryptedAccountConfig } from '../../config/store';
import { isComplete, type AppConfig, type BotRole } from '../../config/schema';
import { readAgentPersona } from '../../bot/agent-catalog';

export interface RoleOptions {
  agent?: string;
  skills?: string;
  clear?: boolean;
  refresh?: boolean;
}

export interface RoleChange {
  clear?: boolean;
  agent?: string;
  persona?: string;   // resolved snapshot when (re)binding
  skills?: string[];
  now: string;
}

/** Pure role-state transition. Unit tested. */
export function nextRole(current: BotRole | undefined, change: RoleChange): BotRole | undefined {
  if (change.clear) return undefined;
  if (change.agent && change.persona !== undefined) {
    return {
      agent: change.agent,
      systemPrompt: change.persona,
      skills: change.skills ?? current?.skills,
      boundAt: change.now,
    };
  }
  if (change.skills) {
    if (!current) return undefined; // no role to attach skills to
    return { ...current, skills: change.skills };
  }
  return current;
}

function parseSkills(list?: string): string[] | undefined {
  if (!list) return undefined;
  const skills = list.split(',').map((s) => s.trim()).filter(Boolean);
  return skills.length ? skills : undefined;
}

async function resolveConfigPath(botId: string): Promise<string> {
  if (botId === 'default') return paths.configFile;
  const bot = await getBot(botId);
  if (!bot) throw new Error(`未找到 bot "${botId}"。用 \`lark-channel-bridge ps\` 查看。`);
  return bot.configPath;
}

export async function runRole(botId: string, opts: RoleOptions): Promise<void> {
  const configPath = await resolveConfigPath(botId);
  const loaded = await loadConfig(configPath);
  if (!isComplete(loaded)) throw new Error(`bot "${botId}" 还没配置完成。`);
  const cfg = loaded as AppConfig;

  // Show mode: no mutating flags.
  if (!opts.agent && !opts.skills && !opts.clear && !opts.refresh) {
    if (!cfg.role) { console.log(`bot "${botId}" 未绑定角色（使用默认 BRIDGE 角色）。`); return; }
    console.log(`bot "${botId}" 角色: ${cfg.role.agent}`);
    if (cfg.role.skills?.length) console.log(`  技能: ${cfg.role.skills.join(', ')}`);
    console.log(`  绑定于: ${cfg.role.boundAt}`);
    return;
  }

  // Resolve persona when (re)binding.
  let change: RoleChange = { clear: opts.clear, skills: parseSkills(opts.skills), now: new Date().toISOString() };
  if (opts.refresh) {
    const agent = cfg.role?.agent;
    if (!agent) throw new Error(`bot "${botId}" 未绑定角色，无法 --refresh。`);
    const persona = await readAgentPersona(agent);
    if (!persona) throw new Error(`未找到 agent "${agent}" 的定义，无法刷新。`);
    change = { ...change, agent, persona };
  } else if (opts.agent) {
    const persona = await readAgentPersona(opts.agent);
    if (!persona) throw new Error(`未找到 agent "${opts.agent}"（~/.claude/agents/${opts.agent}.md 不存在）`);
    change = { ...change, agent: opts.agent, persona };
  } else if (opts.skills && !cfg.role) {
    throw new Error(`bot "${botId}" 未绑定角色，请先 \`role ${botId} --agent <name>\` 再设技能。`);
  }

  const updated = nextRole(cfg.role, change);
  const nextCfg = await buildEncryptedAccountConfig(
    cfg.accounts.app.id,
    cfg.accounts.app.tenant,
    cfg.preferences,
    updated,
  );
  await saveConfig(nextCfg, configPath);

  if (!updated) console.log(`✓ 已解绑 bot "${botId}" 的角色。`);
  else console.log(`✓ bot "${botId}" 角色 → ${updated.agent}${updated.skills?.length ? ` (skills: ${updated.skills.join(', ')})` : ''}`);
  console.log(`  重启生效: lark-channel-bridge restart --bot ${botId}`);
}
```

- [ ] **Step 4: Register the command in `src/cli/index.ts`**

Add the import and command (after the `add` block):

```ts
import { runRole } from './commands/role';
```

```ts
program
  .command('role <botId>')
  .description('Show or set a bot\'s bound team role (persona + preferred skills)')
  .option('--agent <name>', 'bind/replace with this agent (snapshot persona)')
  .option('--skills <list>', 'comma-separated preferred skill names')
  .option('--refresh', 're-snapshot persona from the currently bound agent')
  .option('--clear', 'remove the bound role (back to default BRIDGE role)')
  .action(async (botId: string, opts: { agent?: string; skills?: string; refresh?: boolean; clear?: boolean }) => {
    await runRole(botId, opts);
  });
```

- [ ] **Step 5: Run test + typecheck + build**

Run: `pnpm test test/cli/role.test.ts`
Expected: PASS
Run: `pnpm typecheck`
Expected: PASS
Run: `pnpm build`
Expected: Build success

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/role.ts src/cli/index.ts test/cli/role.test.ts
git commit -m "feat(role): `role` command — show/bind/refresh/clear a bot's team role"
```

---

### Task 9: Full verification

**Files:** None

- [ ] **Step 1: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 2: Full test suite**

Run: `pnpm test`
Expected: PASS — existing 25 + new (agent-catalog 4, role-prompt 3, store-role 2, adapter +2, default-role 5, role 5) ≈ 46 tests, all green.

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: Build success.

- [ ] **Step 4: Smoke the new surface (terminal)**

Run: `node bin/lark-channel-bridge.mjs role --help`
Expected: shows `--agent`, `--skills`, `--refresh`, `--clear`.

- [ ] **Step 5: Final commit (if any tidy-ups)**

```bash
git add -A
git commit -m "test(role): full-suite green for bot-agent role binding"
```

---

## Notes for the implementer

- **Don't read `~/.claude/agents` at runtime.** Only `add` / `role` (CLI-time) touch it; the snapshot lives in config.
- **Role changes need a bot restart** — the persona is read at adapter construction (`start.ts`). The `role` command prints the restart hint; don't try to hot-reload.
- **`_pull_out.txt`** is a pre-existing untracked file — never `git add -A` it; stage explicit paths.
- **Phase B (cross-bot orchestration) is out of scope** — do not build inter-bot messaging here.
- Honest boundary: orchestrator persona injection works anywhere, but `Task`-dispatching the 13 subagents needs `~/.claude/agents` present on the run machine.
