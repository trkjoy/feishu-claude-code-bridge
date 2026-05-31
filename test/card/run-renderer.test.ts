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
    const toolsGroup = groups[2];
    expect(toolsGroup?.kind === 'tools' && toolsGroup.tools.map((t) => t.id)).toEqual(['b', 'c']);
    expect(groups[1]?.kind === 'team' && groups[1].tool.id).toBe('a');
    expect(groups[3]?.kind === 'team' && groups[3].tool.id).toBe('d');
  });

  it('keeps a run of >=3 generic tools in a single tools group', () => {
    const blocks: Block[] = [toolBlock('Bash', '1'), toolBlock('Read', '2'), toolBlock('Edit', '3')];
    const groups = [...groupBlocks(blocks)];
    expect(groups).toHaveLength(1);
    expect(groups[0]?.kind === 'tools' && groups[0].tools).toHaveLength(3);
  });
});
