import { describe, expect, it } from 'vitest';
import { combineEndDisable, type SchtasksResult } from '../../src/daemon/schtasks';

const ok = (): SchtasksResult => ({ ok: true, stdout: 'OK', stderr: '' });
const fail = (msg: string): SchtasksResult => ({ ok: false, stdout: '', stderr: msg });

describe('combineEndDisable', () => {
  it('reports ok when both /End and /Disable succeed', () => {
    expect(combineEndDisable(ok(), ok()).ok).toBe(true);
  });

  it('surfaces a /Disable failure even though /End succeeded', () => {
    const r = combineEndDisable(ok(), fail('disable boom'));
    expect(r.ok).toBe(false);
    expect(r.stderr).toBe('disable boom');
  });

  it('reports failure (not a false ok) when /End fails but /Disable succeeds', () => {
    // The regression we fixed: the old ternary returned the ok `disabled`
    // here, claiming stop succeeded while the daemon was still running.
    const r = combineEndDisable(fail('end boom'), ok());
    expect(r.ok).toBe(false);
    expect(r.stderr).toBe('end boom');
  });

  it('prefers the /End failure message when both fail', () => {
    const r = combineEndDisable(fail('end boom'), fail('disable boom'));
    expect(r.ok).toBe(false);
    expect(r.stderr).toBe('end boom');
  });
});
