# Phase B (step A): Glass-Room Team Rendering — Design Spec

**Date:** 2026-05-31
**Status:** Approved (design), pending implementation plan
**Scope:** Phase B is "C overall" (A first, true cross-bot relay B later). THIS spec covers only **step A**: a render-only glass-room layer. No orchestration logic, no cross-bot messaging.

## Background

Each bot runs as its own `claude` process. The default bot carries the
orchestrator persona (Phase A). When you DM it, **claude itself** runs the
standard team by calling the `Task` tool to dispatch subagents in-process —
the bridge does not orchestrate. The bridge spawns claude and renders its
stream-json output into a streaming Feishu card (`src/card/run-renderer.ts` +
`tool-render.ts`, fed by `run-state.ts`).

Today a `Task` dispatch renders as a generic tool panel (`⏳ Task — <desc>`).
We want it to read like watching a team work: each dispatch shown as a role
card (who, doing what, what they delivered).

## Goal (step A)

Render `Task` / `Agent` tool calls in the run card as **per-agent role cards**
instead of generic tool panels:
- A friendly role label (emoji + 中文 name) derived from `subagent_type`.
- What the agent is doing (`description`).
- Status (running / done / error).
- A summary of the agent's deliverable (the `tool_result` output).

Independent, in chronological order, never collapsed away by the
≥3-tools collapse rule. Regular (non-dispatch) tools keep their current
behavior unchanged.

## Non-goals

- No orchestration logic in the bridge — claude drives the team via `Task`.
- No cross-bot / multi-process relay (that is the deferred true-B).
- No aggregated timeline / roster dashboard (that is future **step C**).
- No change to stream parsing, the adapter, run-state reduction, or Phase A
  role injection.

## Honest boundaries

- **Agent-level granularity only.** A subagent's *internal* tool calls
  (its own Read/Edit/Bash) never appear in the orchestrator's stream — only
  the `Task` dispatch (`tool_use` with `subagent_type`/`description`/`prompt`)
  and its final `tool_result`. The glass room shows "dispatched → running →
  delivered: <summary>", not the subagent's step-by-step internals.
- The card quality depends on the subagent's final message; long deliverables
  are truncated (full text via `/doctor` / logs).
- For the orchestrator to actually dispatch, the run machine needs
  `~/.claude/agents/` present (same boundary as Phase A).

## Architecture

Everything stays in the **rendering layer**. Two files change; one is new.

### New: `src/card/team-render.ts` (pure functions, unit-tested)

```ts
import type { ToolEntry } from './run-state';

export function isTeamDispatch(tool: ToolEntry): boolean;
//   true when tool.name is 'Task' or 'Agent'

export function roleLabel(subagentType: string): string;
//   emoji + 中文 role name for the 13 known agents; falls back to the raw
//   subagentType (prefixed with a neutral 🤖) when unknown/empty.

export function teamCardHeader(tool: ToolEntry): string;
//   `<statusIcon> <roleLabel> — <description>` (description trimmed/one-lined)

export function teamCardBody(tool: ToolEntry): string;
//   "**任务**\n<description or prompt summary>" + when output present:
//   "**产出**\n<truncated tool_result>"; "_派发中…_" while running.
```

Role map (subagent_type → label), covering the standard team; extend freely:

| subagent_type | label |
|---|---|
| orchestrator | 🎭 总指挥 |
| product-manager | 🧑‍💼 产品经理 |
| software-architect | 🏛️ 架构师 |
| backend-architect | ⚙️ 后端工程师 |
| frontend-developer | 🎨 前端工程师 |
| database-optimizer | 🗄️ 数据库工程师 |
| qa-automator | 🧪 QA 工程师 |
| code-reviewer | 🔎 代码评审 |
| security-engineer | 🛡️ 安全工程师 |
| reality-checker | ✅ 验收官 |
| devops-automator | 🚀 DevOps |
| technical-writer | 📝 技术文档 |
| ui-designer | 🎯 UI 设计 |
| testing-evidence-collector | 📸 测试取证 |
| kb-curator | 📚 知识库 |
| (unknown) | 🤖 `<subagentType>` |

Status icons reuse the existing convention: running `⏳`, done `✅`, error `❌`.

### Modified: `src/card/run-renderer.ts`

Add a third group kind so dispatches interleave with text/tools in order and
escape the generic-tool collapse:

```ts
type Group = ToolGroup | TextGroup | TeamGroup;
interface TeamGroup { kind: 'team'; tool: ToolEntry }
```

- `groupBlocks`: when a tool block satisfies `isTeamDispatch`, flush the
  pending generic `toolBuf`, then `yield { kind: 'team', tool }`. Otherwise
  buffer into `toolBuf` exactly as today.
- `renderCard`: for a `team` group, render a role card via a new
  `teamRoleCard(tool)` — a `collapsiblePanel` whose title is
  `teamCardHeader(tool)`, body is `teamCardBody(tool)`, expanded while the
  dispatch is running, border `blue` (done) / `red` (error).

`renderToolGroup`, the collapse threshold, text rendering, reasoning, footer,
and stop button are all untouched.

### Unchanged

`run-state.ts` still produces only `text` / `tool` blocks — team detection is a
pure render-time concern. `stream-json.ts`, the adapter, and orchestration are
untouched. Future true-B feeds the same (role, task, deliverable) triples into
`team-render`, reusing this presentation.

## Testing

- `test/card/team-render.test.ts`:
  - `isTeamDispatch` true for Task/Agent, false for Bash/Read/etc.
  - `roleLabel` maps known agents; unknown falls back to `🤖 <type>`; empty safe.
  - `teamCardHeader` shows status icon + label + description.
  - `teamCardBody` shows task; adds 产出 when output present; running placeholder;
    truncates long output.
- `test/card/run-renderer.test.ts` (new): `groupBlocks` emits a `team` group
  per dispatch, preserves chronological order with text/tools, and a run of ≥3
  generic tools still collapses (team cards never folded in).

## Files touched

| File | Change |
|---|---|
| `src/card/team-render.ts` | NEW — role map + header/body formatters |
| `src/card/run-renderer.ts` | `team` group kind + `teamRoleCard` rendering |
| `test/card/team-render.test.ts` | NEW |
| `test/card/run-renderer.test.ts` | NEW |

## Deferred

- **Step C**: aggregated team-progress timeline / roster panel.
- **True B**: cross-process / multi-bot relay (separate spec).
