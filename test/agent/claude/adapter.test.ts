import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveClaudeBinaryForSpawn, buildAppendSystemPrompt } from '../../../src/agent/claude/adapter';

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

interface ShimFixture {
  root: string;
  shimCmd: string;
  shimBare: string;
  exe: string;
}

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('resolveClaudeBinaryForSpawn', () => {
  it('resolves a Windows PATH shim to the real claude.exe', () => {
    const fixture = createShimFixture();

    const resolved = resolveClaudeBinaryForSpawn('claude', {
      platform: 'win32',
      envPath: fixture.root,
    });

    expect(resolved).toBe(fixture.exe);
  });

  it('resolves an explicit .cmd shim path to the real claude.exe', () => {
    const fixture = createShimFixture();

    const resolved = resolveClaudeBinaryForSpawn(fixture.shimCmd, {
      platform: 'win32',
      envPath: '',
    });

    expect(resolved).toBe(fixture.exe);
  });

  it('keeps an explicit exe path unchanged', () => {
    const fixture = createShimFixture();

    const resolved = resolveClaudeBinaryForSpawn(fixture.exe, {
      platform: 'win32',
      envPath: '',
    });

    expect(resolved).toBe(fixture.exe);
  });

  it('leaves non-Windows binaries untouched', () => {
    const resolved = resolveClaudeBinaryForSpawn('claude', {
      platform: 'linux',
      envPath: '/usr/local/bin',
    });

    expect(resolved).toBe('claude');
  });

  it('falls back to the original binary when no Windows candidate exists', () => {
    const resolved = resolveClaudeBinaryForSpawn('claude', {
      platform: 'win32',
      envPath: join(tmpdir(), 'missing-claude-path'),
    });

    expect(resolved).toBe('claude');
  });
});

function createShimFixture(): ShimFixture {
  const root = mkdtempSync(join(tmpdir(), 'claude-shim-'));
  tempDirs.push(root);

  const shimCmd = join(root, 'claude.cmd');
  const shimBare = join(root, 'claude');
  const exe = join(root, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');

  mkdirSync(join(root, 'node_modules', '@anthropic-ai', 'claude-code', 'bin'), {
    recursive: true,
  });
  writeFileSync(shimCmd, '@echo off\r\n');
  writeFileSync(shimBare, '#!/bin/sh\n');
  writeFileSync(exe, '');

  return { root, shimCmd, shimBare, exe };
}
