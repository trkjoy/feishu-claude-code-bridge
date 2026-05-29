# Claude Windows Resolution Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `lark-channel-bridge` reliably find and launch Claude Code on Windows when the install exposes `claude.cmd`/shim files instead of a directly spawnable `claude.exe`.

**Architecture:** Keep the fix inside the Claude adapter. Add a small synchronous resolver that maps the configured binary name to a spawnable executable on Windows, preferring the real `claude.exe` behind npm/nvm shims. Use the same resolver for both availability checks and real runs so startup and execution paths stay consistent.

**Tech Stack:** TypeScript, Node.js child process APIs, Vitest

---

### Task 1: Add regression tests for Windows Claude resolution

**Files:**
- Create: `test/agent/claude/adapter.test.ts`

**Step 1: Write the failing test**

Cover these behaviors:
- Windows PATH containing a `claude.cmd` shim plus sibling `node_modules/@anthropic-ai/claude-code/bin/claude.exe` resolves to the real exe.
- Explicit `.cmd` path resolves to the sibling exe.
- Existing `.exe` path remains unchanged.
- Non-Windows platforms keep the original binary value.

**Step 2: Run test to verify it fails**

Run: `pnpm test test/agent/claude/adapter.test.ts`

Expected: FAIL because the resolver function does not exist yet.

### Task 2: Implement shared Claude executable resolution

**Files:**
- Modify: `src/agent/claude/adapter.ts`

**Step 1: Add a synchronous resolver**

Add a small exported helper that:
- No-ops on non-Windows.
- Searches PATH or explicit paths on Windows.
- Prefers a real `claude.exe`.
- When a `claude.cmd`/shim is found, checks for sibling `node_modules/@anthropic-ai/claude-code/bin/claude.exe` and uses it.

**Step 2: Route both adapter paths through it**

Use the resolved executable for:
- `isAvailable()`
- `run()`

**Step 3: Keep behavior surgical**

Do not change prompt construction, permissions mode, stream handling, or any channel logic.

### Task 3: Verify the fix

**Files:**
- None

**Step 1: Run targeted tests**

Run: `pnpm test test/agent/claude/adapter.test.ts`

Expected: PASS

**Step 2: Run typecheck**

Run: `pnpm typecheck`

Expected: PASS

**Step 3: Reproduce the original failure path**

Run: `lark-channel-bridge run`

Expected: It no longer exits immediately with `✗ 未找到 claude CLI`.
