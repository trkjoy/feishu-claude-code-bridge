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
  it('handles CRLF line endings', () => {
    const md = '---\r\nname: x\r\n---\r\n\r\nBODY 1\r\nBODY 2\r\n';
    expect(stripFrontmatter(md)).toBe('BODY 1\r\nBODY 2');
  });
  it('strips frontmatter even with no trailing newline after the closing fence', () => {
    expect(stripFrontmatter('---\nname: x\n---')).toBe('');
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
