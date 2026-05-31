# Bot ↔ Team-Agent Role Binding — Design Spec

**Date:** 2026-05-31
**Status:** Approved (design), pending implementation plan
**Scope:** Phase A only (persona injection). Phase B (cross-bot orchestration) is explicitly out of scope here.

## Background

`lark-channel-bridge` runs each bot as an independent `claude` process (its own
Feishu app + WS connection + `claude -p` invocation). Today every bot is given
the same fixed `BRIDGE_SYSTEM_PROMPT` via `--append-system-prompt`
(`src/agent/claude/adapter.ts`). There is no per-bot persona.

The standard AI dev team ships 13 agent definitions under `~/.claude/agents/*.md`
(frontmatter + a Markdown body that IS the agent's system prompt / persona).

We want: when creating a bot with `add`, optionally bind it to one of those
agents, snapshotting that agent's persona + a list of preferred skills onto the
bot so the bot behaves as that specialist in Feishu. The default bot acts as the
orchestrator. A new `role` command sets/changes the binding later.

## Goals (Phase A)

1. A bot can carry an optional **role**: a snapshot of an agent persona plus a
   list of preferred Claude Code skill names.
2. `add` offers an **optional** agent-selection step. Skipping it leaves the bot
   on the current fixed `BRIDGE_SYSTEM_PROMPT` (unchanged behavior).
3. A new `role` command sets / replaces / refreshes / clears / shows a bot's role
   after creation.
4. The default bot (config.json) defaults to the **orchestrator** persona
   (auto-snapshot on first run when available — see §5).
5. At runtime the bound persona + skill hints are injected into that bot's claude
   process as additional system prompt. Bots stay independent (no cross-bot
   dispatch in Phase A).

## Non-goals

- **Phase B**: the orchestrator bot delegating work to other role-bots across
  processes (inter-bot messaging / shared queue). Not in this spec.
- Hard skill/tool isolation per run. "Skills" here is **prompt-level guidance**
  only — `claude -p` has no clean per-invocation skill gate. (A future Phase
  could add `--allowedTools` boundaries.)
- Auto-updating an already-bound bot when the source agent `.md` changes (use
  `role --refresh` to re-snapshot).

## Key constraint: packaging independence

The bridge is compiled / packaged / installed. The runtime must NOT depend on
`~/.claude/agents/*.md` existing on the machine. Therefore:

- The agent persona is **snapshotted into the bot's own config at bind time**.
- Runtime reads only the bot's `config-<id>.json` (or `config.json`).
- `~/.claude/agents/` is consulted ONLY at `add` / `role` time, to *list* and
  *read* selectable agents — and only on machines that have the team installed.
  If absent, binding degrades gracefully (skip / explicit prompt path).

## Data model

Add an optional `role` block to `AppConfig` (`src/config/schema.ts`):

```ts
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

export interface AppConfig {
  accounts: { app: AppCredentials };
  secrets?: SecretsConfig;
  preferences?: AppPreferences;
  role?: BotRole;            // NEW — top-level, optional
}
```

Helper (also in `schema.ts`):

```ts
/** Format the bound role into a system-prompt section, or '' when no role. */
export function getRoleSystemPrompt(cfg: AppConfig): string;
```

Output shape (roughly):

```
# 你的角色

<role.systemPrompt>

## 你具备并应优先使用的技能
- code-review
- lark-base
```

Returns `''` when `cfg.role` is absent (→ no injection, current behavior).

### Config-rewrite preservation (critical)

`buildEncryptedAccountConfig(appId, tenant, preferences)` rebuilds a fresh
config and is used by `/account` change + first-run encryption migration. It
currently preserves `preferences` only. It MUST also preserve `role`, or a
credential change would silently drop the binding. Plan:

- Add a `role?: BotRole` parameter (or accept a `carryOver` object) to
  `buildEncryptedAccountConfig`, and thread the existing `cfg.role` through every
  caller (`maybeMigratePlaintextSecret`, `persistEncrypted`, `/account` handler,
  `add`). Round-trip covered by a test.

## Runtime injection

- `src/agent/types.ts`: add `extraSystemPrompt?: string` to `AgentRunOptions`.
- `src/agent/claude/adapter.ts`: when `opts.extraSystemPrompt` is set, pass the
  `--append-system-prompt` value as `${BRIDGE_SYSTEM_PROMPT}\n\n${opts.extraSystemPrompt}`
  (single flag, bridge mechanics first, role persona after). When unset, behavior
  is byte-for-byte unchanged.
- `src/bot/channel.ts`: where per-message run options are built, read the bot's
  `cfg.role` via `getRoleSystemPrompt(cfg)` and pass it as `extraSystemPrompt`.
  (Exact callsite to be located during implementation; `cfg` is already in
  scope there.)

## `add` — optional agent selection

`runAdd` (`src/cli/commands/add.ts`), after the wizard yields credentials and
before writing config:

1. Probe `~/.claude/agents/*.md` via the new catalog module.
   - Present → interactive picker listing agent names + a "跳过(不绑定)" option.
   - Absent → print "未检测到团队 agent，跳过角色绑定" and proceed with no role.
2. On selection: read + strip frontmatter → snapshot body into `role.systemPrompt`;
   optionally prompt for / accept `--skills a,b,c`.
3. On skip: no `role` written.

`add` also gains non-interactive flags for scripted use:
`--agent <name>` and `--skills a,b,c` (skip the prompt when provided).

## New module: agent catalog

`src/bot/agent-catalog.ts` — single home for reading `~/.claude/agents`:

```ts
export function agentsDir(): string;               // ~/.claude/agents
export async function listAgents(): Promise<string[]>;          // names, [] if dir absent
export async function readAgentPersona(name: string): Promise<string | undefined>;
//   reads <name>.md, strips YAML frontmatter, returns the body; undefined if missing
export function stripFrontmatter(md: string): string;           // pure, unit-tested
```

Used by both `add` and `role`.

## New command: `role`

Registered in `src/cli/index.ts`, implemented in `src/cli/commands/role.ts`:

```
lark-channel-bridge role <botId>                 # show current role (or "未绑定")
lark-channel-bridge role <botId> --agent <name>  # bind / replace (snapshot)
lark-channel-bridge role <botId> --skills a,b,c  # set the skill list
lark-channel-bridge role <botId> --refresh       # re-snapshot from role.agent's .md
lark-channel-bridge role <botId> --clear         # remove role → back to fixed prompt
```

- `<botId>` resolves via the bot registry (`getBot`); `default` allowed for the
  default bot (config.json). Mutates that bot's config via the
  preservation-aware save path (so secrets/preferences survive).
- `--agent` / `--refresh` require `~/.claude/agents/<name>.md` to exist; clear,
  actionable error otherwise.
- A running bot must be restarted to pick up a role change (the role is read at
  run spawn). The command prints a reminder: `重启该 bot 生效: restart --bot <id>`.

## Default bot = orchestrator (5-A, chosen)

On first run of the default bot, if it has **no** `role` AND
`~/.claude/agents/orchestrator.md` resolves, auto-snapshot orchestrator into
`config.json`'s `role` (logged: `bot-registry`/`config` info event). Machines
with the team get an orchestrator default out of the box; machines without keep
the base prompt (the project `CLAUDE.md` still nudges orchestrator behavior).

- Hook point: alongside `ensureDefaultBotEntry` in the `runStart` path
  (`src/cli/commands/start.ts`), gated on "default bot only + role unset +
  orchestrator.md present". Idempotent — never overwrites an existing role.
- **Honest boundary**: persona injection works anywhere, but for the orchestrator
  bot to actually *dispatch* the 13 subagents via `Task`, the run machine needs
  `~/.claude/agents/` present. On a packaged machine without the team, the
  orchestrator persona is injected but `Task` dispatch will fail. Phase B
  addresses real cross-process coordination.

## Testing (pure-function-first, matching existing style)

- `stripFrontmatter` — frontmatter removal, no-frontmatter passthrough, edge cases.
- `listAgents` — names from a temp dir; `[]` when dir absent.
- `getRoleSystemPrompt` — persona + skills formatting; `''` when no role; skills
  omitted when empty.
- config round-trip — `buildEncryptedAccountConfig` preserves `role` across a
  credential change.
- `role` command decision core (pure) — set / clear / refresh transitions on an
  in-memory config.

## Files touched (Phase A)

| File | Change |
|------|--------|
| `src/config/schema.ts` | `BotRole` interface, `role?` on `AppConfig`, `getRoleSystemPrompt` |
| `src/config/store.ts` | `buildEncryptedAccountConfig` preserves `role`; save helpers |
| `src/agent/types.ts` | `extraSystemPrompt?` on `AgentRunOptions` |
| `src/agent/claude/adapter.ts` | append role section to system prompt when present |
| `src/bot/channel.ts` | build `extraSystemPrompt` from `cfg.role` per run |
| `src/bot/agent-catalog.ts` | NEW — list/read/strip agents from `~/.claude/agents` |
| `src/cli/commands/add.ts` | optional agent-selection + `--agent`/`--skills` flags |
| `src/cli/commands/role.ts` | NEW — `role` command |
| `src/cli/index.ts` | register `role` |
| `src/cli/commands/start.ts` | 5-A: auto-bind orchestrator to default bot (first run) |
| `test/...` | unit tests above |

## Open questions / deferred

- Skill source for an agent: agent `.md` frontmatter doesn't list "skills", so the
  skills list is user-supplied (flag / prompt), default empty. Acceptable for A.
- Phase B (cross-bot orchestration) — separate spec when we get there.
