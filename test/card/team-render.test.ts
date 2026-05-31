import { describe, expect, it } from 'vitest';
import { isTeamDispatch, roleLabel, teamCardHeader, teamCardBody, teamTimeline } from '../../src/card/team-render';
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
    const h = teamCardHeader(
      tool({ status: 'running', input: { subagent_type: 'qa-automator', description: '写集成测试' } }),
    );
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
    const b = teamCardBody(
      tool({ status: 'done', input: { subagent_type: 'product-manager', prompt: '产出 PRD' }, output: 'PRD: 用户故事 1..3' }),
    );
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

describe('teamTimeline', () => {
  it('returns empty string for no dispatches', () => {
    expect(teamTimeline([])).toBe('');
  });
  it('lists one line per agent with status icon and role', () => {
    const out = teamTimeline([
      tool({ id: '1', status: 'done', input: { subagent_type: 'product-manager' } }),
      tool({ id: '2', status: 'running', input: { subagent_type: 'backend-architect', description: '实现登录接口' } }),
    ]);
    expect(out).toContain('🏗️ 团队进度');
    expect(out).toContain('✅ 🧑‍💼 产品经理');
    expect(out).toContain('⏳ ⚙️ 后端工程师 — 实现登录接口');
  });
  it('omits the description for non-running agents', () => {
    const out = teamTimeline([tool({ id: '1', status: 'done', input: { subagent_type: 'qa-automator', description: '写测试' } })]);
    expect(out).toContain('✅ 🧪 QA 工程师');
    expect(out).not.toContain('写测试');
  });
});
