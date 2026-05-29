# Ask User Question Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a bridge-managed `ask` flow so a Feishu card button click can return to the same waiting Claude run instead of becoming a new follow-up message.

**Architecture:** Persist each pending question as a small JSON file under `~/.lark-channel/asks`, send a CardKit 2.0 button card from a new `lark-channel-bridge ask` command, and let `cardAction` resolve matching callbacks by writing the answer back into that file. Keep the existing `__claude_cb` path intact for next-turn callbacks.

**Tech Stack:** TypeScript, Node.js, Commander, `@larksuiteoapi/node-sdk`, Vitest

---

### Task 1: Add failing tests for ask store state transitions

**Files:**
- Create: `test/ask/store.test.ts`
- Create: `src/ask/store.ts`

**Step 1: Write the failing test**

Cover:
- creating a pending ask writes a file with `status: "pending"`
- answering with the expected operator and option moves it to `answered`
- answering with the wrong operator is rejected
- answering with an unknown option is rejected

**Step 2: Run test to verify it fails**

Run: `pnpm test test/ask/store.test.ts`

Expected: FAIL because `src/ask/store.ts` does not exist yet.

**Step 3: Write minimal implementation**

Implement:
- ask id generation
- atomic file writes
- `createPendingAsk`
- `readAsk`
- `answerAsk`
- `waitForAnswer`
- `deleteAsk`

**Step 4: Run test to verify it passes**

Run: `pnpm test test/ask/store.test.ts`

Expected: PASS

### Task 2: Add failing dispatcher tests for ask callback routing

**Files:**
- Create: `test/card/dispatcher.test.ts`
- Modify: `src/card/dispatcher.ts`

**Step 1: Write the failing test**

Cover:
- a callback with `__bridge_ask` resolves the ask and does not call `pending.push`
- a callback with `__claude_cb` still calls `pending.push`

**Step 2: Run test to verify it fails**

Run: `pnpm test test/card/dispatcher.test.ts`

Expected: FAIL because dispatcher has no ask-routing logic.

**Step 3: Write minimal implementation**

Add:
- `BRIDGE_ASK_MARKER`
- a small helper that checks ask payloads before `__claude_cb`
- answer persistence through `src/ask/store.ts`

**Step 4: Run test to verify it passes**

Run: `pnpm test test/card/dispatcher.test.ts`

Expected: PASS

### Task 3: Add failing CLI test for the blocking ask command

**Files:**
- Create: `test/cli/ask.test.ts`
- Create: `src/cli/commands/ask.ts`
- Modify: `src/cli/index.ts`
- Create: `src/card/ask-card.ts`

**Step 1: Write the failing test**

Cover:
- `runAsk` validates input
- `runAsk` sends one interactive message
- `runAsk` waits for an answered ask and writes JSON to stdout

Use dependency injection for:
- config loading
- secret resolution
- raw client creation
- stdout write
- wait function

**Step 2: Run test to verify it fails**

Run: `pnpm test test/cli/ask.test.ts`

Expected: FAIL because the command and card builder do not exist yet.

**Step 3: Write minimal implementation**

Implement:
- option JSON parsing
- client creation with current config
- CardKit 2.0 button card builder
- blocking wait loop
- JSON stdout response

**Step 4: Run test to verify it passes**

Run: `pnpm test test/cli/ask.test.ts`

Expected: PASS

### Task 4: Wire config-path propagation and Claude guidance

**Files:**
- Modify: `src/cli/commands/start.ts`
- Modify: `src/agent/claude/adapter.ts`

**Step 1: Add environment propagation**

Set `process.env.LARK_CHANNEL_CONFIG` from the resolved config path during `runStart`.

**Step 2: Update the system prompt**

Add a short bridge rule telling Claude:
- when it needs a user choice in Feishu, use `lark-channel-bridge ask`
- pass `chat_id` and `sender_id` from `<bridge_context>`
- expect JSON on stdout

**Step 3: Keep behavior surgical**

Do not change stream parsing, permission mode, session logic, or normal card rendering.

### Task 5: Run focused verification, then full verification

**Files:**
- None

**Step 1: Run focused tests**

Run:
- `pnpm test test/ask/store.test.ts`
- `pnpm test test/card/dispatcher.test.ts`
- `pnpm test test/cli/ask.test.ts`

Expected: PASS

**Step 2: Run full test suite**

Run: `pnpm test`

Expected: PASS

**Step 3: Run typecheck**

Run: `pnpm typecheck`

Expected: PASS

**Step 4: Run build**

Run: `pnpm build`

Expected: PASS

**Step 5: Report actual status**

If local dependency or Windows permission issues block any command, record the exact failing command and stop short of claiming success.
