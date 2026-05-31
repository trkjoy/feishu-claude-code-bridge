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
const TIMELINE_DESC_MAX = 60;

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

/**
 * Top-of-card team roster: one line per dispatched agent (status + role, plus a
 * short description while running). Returns '' when there are no dispatches, so
 * normal runs render no team panel. Only already-dispatched agents appear —
 * future phases aren't knowable from the stream.
 */
export function teamTimeline(tools: ToolEntry[]): string {
  if (tools.length === 0) return '';
  const lines = tools.map((t) => {
    const icon = statusIcon(t.status);
    const label = roleLabel(field(t.input, 'subagent_type'));
    const desc = t.status === 'running' ? oneLine(field(t.input, 'description'), TIMELINE_DESC_MAX) : '';
    return desc ? `${icon} ${label} — ${desc}` : `${icon} ${label}`;
  });
  return `**🏗️ 团队进度**\n${lines.join('\n')}`;
}
