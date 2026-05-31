# Phase B (step A) Glass-Room Team Rendering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render `Task`/`Agent` subagent dispatches in the run card as per-agent role cards (who, doing what, delivered what) instead of generic tool panels.

**Architecture:** Pure render-layer change. A new `team-render.ts` maps a dispatch's `subagent_type` to a friendly role label and formats header/body. `run-renderer.ts` gains a `team` block group so dispatches interleave in order and skip the generic ≥3-tool collapse. No change to stream parsing, the adapter, run-state reduction, or orchestration.

**Tech Stack:** TypeScript, vitest. Commands: `pnpm typecheck`, `pnpm test <path>`, `pnpm build`. Windows + pnpm; use Bash for pnpm/git. NEVER `git add -A` (a `_pull_out.txt` is untracked) — stage explicit files.

**Spec:** `docs/plans/2026-05-31-phase-b-glass-room-design.md`

---

### Task 1: team-render module

**Files:**
- Create: `src/card/team-render.ts`
- Test: `test/card/team-render.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { isTeamDispatch, roleLabel, teamCardHeader, teamCardBody } from '../../src/card/team-render';
import type { ToolEntry } from '../../src/card/run-state';

function tool(over: Partial<ToolEntry>): ToolEntry {
  return { id: 't1', name: 'Task', input: {}, status: 'running', ...over };
}

describe('isTeamDispatch', () => {
  it('is true for Task and Agent, false otherwise', () => {
    expect(isTeamDispatch(tool({ name: 'Task' }))).toBe(true);
    expect(isTeamDispatch(tool({ name: 'Agent' }))).toBe(true);
    expect(isTeamDispatch(tool({ name: 'Bash' }))).toBe(false);
    expect(isTeamDispatch(tool({ name: 'Read' }))).toBe(false);
  });
});

describe('roleLabel', () => {
  it('maps known agents to emoji + 中文', () => {
    expect(roleLabel('product-manager')).toBe('🧑‍💼 产品经理');
    expect(roleLabel('backend-architect')).toBe('⚙️ 后端工程师');
  });
  it('falls back for unknown / empty', () => {
    expect(roleLabel('mystery-bot')).toBe('🤖 mystery-bot');
    expect(roleLabel('')).toBe('🤖 subagent');
  });
});

describe('teamCardHeader', () => {
  it('shows status icon + role label + description', () => {
    const h = teamCardHeader(tool({ status: 'running', input: { subagent_type: 'qa-automator', description: '写集成测试' } }));
    expect(h).toContain('⏳');
    expect(h).toContain('🧪 QA 工程师');
    expect(h).toContain('写集成测试');
  });
  it('uses the done icon when finished', () => {
    expect(teamCardHeader(tool({ status: 'done', input: { subagent_type: 'code-reviewer' } }))).toContain('✅');
  });
});

describe('teamCardBody', () => {
  it('shows the task and the deliverable once output arrives', () => {
    const b = teamCardBody(tool({ status: 'done', input: { subagent_type: 'product-manager', prompt: '产出 PRD' }, output: 'PRD: 用户故事 1..3' }));
    expect(b).toContain('**任务**');
    expect(b).toContain('产出 PRD');
    expect(b).toContain('**产出**');
    expect(b).toContain('PRD: 用户故事 1..3');
  });
  it('shows a running placeholder before output', () => {
    expect(teamCardBody(tool({ status: 'running', input: { description: 'x' } }))).toContain('派发中');
  });
  it('labels errors as 失败', () => {
    const b = teamCardBody(tool({ status: 'error', input: { description: 'x' }, output: 'boom' }));
    expect(b).toContain('**失败**');
    expect(b).toContain('boom');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test test/card/team-render.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { ToolEntry } from './run-state';

/** subagent_type → emoji + 中文 role label, for the standard team. */
const ROLE_LABELS: Record<string, string> = {
  orchestrator: '🎭 总指挥',
  'product-manager': '🧑‍💼 产品经理',
  'software-architect': '🏛️ 架构师',
  'backend-architect': '⚙️ 后端工程师',
  'frontend-developer': '🎨 前端工程师',
  'database-optimizer': '🗄️ 数据库工程师',
  'qa-automator': '🧪 QA 工程师',
  'code-reviewer': '🔎 代码评审',
  'security-engineer': '🛡️ 安全工程师',
  'reality-checker': '✅ 验收官',
  'devops-automator': '🚀 DevOps',
  'technical-writer': '📝 技术文档',
  'ui-designer': '🎯 UI 设计',
  'testing-evidence-collector': '📸 测试取证',
  'kb-curator': '📚 知识库',
};

const HEADER_DESC_MAX = 80;
const BODY_TASK_MAX = 400;
const BODY_OUTPUT_MAX = 1000;

/** Whether a tool entry is a subagent dispatch (rendered as a team role card). */
export function isTeamDispatch(tool: ToolEntry): boolean {
  return tool.name === 'Task' || tool.name === 'Agent';
}

/** Friendly role label for a subagent_type; falls back to `🤖 <type>`. */
export function roleLabel(subagentType: string): string {
  const key = subagentType.trim();
  if (!key) return '🤖 subagent';
  return ROLE_LABELS[key] ?? `🤖 ${key}`;
}

function field(input: unknown, key: string): string {
  if (!input || typeof input !== 'object') return '';
  const v = (input as Record<string, unknown>)[key];
  return typeof v === 'string' ? v : '';
}

function statusIcon(status: ToolEntry['status']): string {
  return status === 'done' ? '✅' : status === 'error' ? '❌' : '⏳';
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function oneLine(s: string, max: number): string {
  return truncate(s.replace(/\s+/g, ' ').trim(), max);
}

/** `<icon> **<role>** — <description>` for the collapsible panel title. */
export function teamCardHeader(tool: ToolEntry): string {
  const label = roleLabel(field(tool.input, 'subagent_type'));
  const desc = oneLine(field(tool.input, 'description'), HEADER_DESC_MAX);
  const icon = statusIcon(tool.status);
  return desc ? `${icon} **${label}** — ${desc}` : `${icon} **${label}**`;
}

/** Panel body: the task, then the deliverable (or a running placeholder). */
export function teamCardBody(tool: ToolEntry): string {
  const task = field(tool.input, 'prompt') || field(tool.input, 'description');
  const parts: string[] = [];
  if (task) parts.push(`**任务**\n${truncate(task, BODY_TASK_MAX)}`);
  if (tool.output) {
    const label = tool.status === 'error' ? '**失败**' : '**产出**';
    parts.push(`${label}\n${truncate(tool.output, BODY_OUTPUT_MAX)}`);
  } else if (tool.status === 'running') {
    parts.push('_派发中…_');
  }
  return parts.join('\n\n') || '_无内容_';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test test/card/team-render.test.ts`
Expected: PASS
Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/card/team-render.ts test/card/team-render.test.ts
git commit -m "feat(glass-room): team-render role labels + header/body formatters"
```
Append trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 2: run-renderer team group

**Files:**
- Modify: `src/card/run-renderer.ts`
- Test: `test/card/run-renderer.test.ts`

**Context:** `run-renderer.ts` has a private generator `groupBlocks(blocks: Block[])` that yields `{kind:'text'}` and `{kind:'tools'}` groups, and `renderCard` consumes them. `Block` is `{kind:'text';content;streaming}` | `{kind:'tool';tool}` (from `run-state.ts`). We add a `team` group for dispatch tool blocks. We must EXPORT `groupBlocks` so it can be unit-tested.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { groupBlocks } from '../../src/card/run-renderer';
import type { Block, ToolEntry } from '../../src/card/run-state';

function toolBlock(name: string, id: string): Block {
  const tool: ToolEntry = { id, name, input: { subagent_type: 'qa-automator' }, status: 'running' };
  return { kind: 'tool', tool };
}
function textBlock(content: string): Block {
  return { kind: 'text', content, streaming: false };
}

describe('groupBlocks', () => {
  it('emits a team group per dispatch, preserving order with text and tools', () => {
    const blocks: Block[] = [
      textBlock('开始'),
      toolBlock('Task', 'a'),
      toolBlock('Bash', 'b'),
      toolBlock('Read', 'c'),
      toolBlock('Agent', 'd'),
    ];
    const groups = [...groupBlocks(blocks)];
    expect(groups.map((g) => g.kind)).toEqual(['text', 'team', 'tools', 'team']);
    // the generic tools (Bash + Read) stay grouped together
    const toolsGroup = groups[2];
    expect(toolsGroup.kind === 'tools' && toolsGroup.tools.map((t) => t.id)).toEqual(['b', 'c']);
    // the team groups carry the dispatch tool
    expect(groups[1].kind === 'team' && groups[1].tool.id).toBe('a');
    expect(groups[3].kind === 'team' && groups[3].tool.id).toBe('d');
  });

  it('keeps a run of >=3 generic tools in a single tools group', () => {
    const blocks: Block[] = [toolBlock('Bash', '1'), toolBlock('Read', '2'), toolBlock('Edit', '3')];
    const groups = [...groupBlocks(blocks)];
    expect(groups).toHaveLength(1);
    expect(groups[0].kind === 'tools' && groups[0].tools).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test test/card/run-renderer.test.ts`
Expected: FAIL — `groupBlocks` not exported.

- [ ] **Step 3: Implement**

In `src/card/run-renderer.ts`:

Add the import at the top (after the existing tool-render import):

```ts
import { isTeamDispatch, teamCardHeader, teamCardBody } from './team-render';
```

Extend the group types (the `Group` union near the top of the file):

```ts
interface ToolGroup {
  kind: 'tools';
  tools: ToolEntry[];
}
interface TextGroup {
  kind: 'text';
  content: string;
}
interface TeamGroup {
  kind: 'team';
  tool: ToolEntry;
}
type Group = ToolGroup | TextGroup | TeamGroup;
```

Replace `function* groupBlocks` with this exported version:

```ts
export function* groupBlocks(blocks: Block[]): Generator<Group> {
  let toolBuf: ToolEntry[] = [];
  for (const b of blocks) {
    if (b.kind === 'tool' && !isTeamDispatch(b.tool)) {
      toolBuf.push(b.tool);
      continue;
    }
    if (toolBuf.length > 0) {
      yield { kind: 'tools', tools: toolBuf };
      toolBuf = [];
    }
    if (b.kind === 'tool') {
      yield { kind: 'team', tool: b.tool };
    } else {
      yield { kind: 'text', content: b.content };
    }
  }
  if (toolBuf.length > 0) yield { kind: 'tools', tools: toolBuf };
}
```

In `renderCard`, handle the `team` group in the loop. Replace:

```ts
  for (const group of groupBlocks(state.blocks)) {
    if (group.kind === 'text') {
      if (group.content.trim()) {
        elements.push(markdown(group.content));
      }
    } else {
      elements.push(...renderToolGroup(group.tools, state.terminal !== 'running'));
    }
  }
```

with:

```ts
  for (const group of groupBlocks(state.blocks)) {
    if (group.kind === 'text') {
      if (group.content.trim()) {
        elements.push(markdown(group.content));
      }
    } else if (group.kind === 'team') {
      elements.push(teamRoleCard(group.tool, state.terminal === 'running'));
    } else {
      elements.push(...renderToolGroup(group.tools, state.terminal !== 'running'));
    }
  }
```

Add the `teamRoleCard` helper (next to `toolPanel`):

```ts
function teamRoleCard(tool: ToolEntry, runActive: boolean): object {
  return collapsiblePanel({
    title: teamCardHeader(tool),
    expanded: runActive && tool.status === 'running',
    border: tool.status === 'error' ? 'red' : 'blue',
    body: teamCardBody(tool),
  });
}
```

(`collapsiblePanel` already accepts border `'grey' | 'red' | 'blue'`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test test/card/run-renderer.test.ts`
Expected: PASS
Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/card/run-renderer.ts test/card/run-renderer.test.ts
git commit -m "feat(glass-room): render Task/Agent dispatches as team role cards"
```
Append trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 3: Full verification

**Files:** None

- [ ] **Step 1: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 2: Full test suite**

Run: `pnpm test`
Expected: PASS — existing 48 + team-render (8) + run-renderer (2) ≈ 58 tests green.

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: Build success.

- [ ] **Step 4: Commit (if any tidy-ups were needed)**

```bash
git add src test
git commit -m "test(glass-room): full-suite green for team rendering"
```

---

## Notes for the implementer

- Render-only: do NOT touch `run-state.ts`, `stream-json.ts`, the adapter, or any orchestration. Team detection is a pure render-time concern.
- `groupBlocks` must be exported (it was private) so the test can drive it directly.
- Team role cards must never be folded into the ≥3-tool collapse — that's why dispatches become their own `team` group instead of joining `toolBuf`.
- Honest boundary: only agent-level granularity is visible (dispatch + final result); a subagent's internal tool calls don't reach this stream.
- `_pull_out.txt` is pre-existing untracked — never `git add -A`.
