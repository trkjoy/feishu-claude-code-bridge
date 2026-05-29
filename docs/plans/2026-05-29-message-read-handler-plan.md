# Message Read Handler Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `im.message.message_read_v1` handling so the bridge logs who read a bot message in terminal and JSON logs instead of emitting an SDK warning.

**Architecture:** Keep the existing `createLarkChannel` flow and add one small raw-event registration after channel creation. Parse the Feishu read-receipt payload into a narrow internal shape, log it through the existing structured logger, and cover the behavior with a focused test so the raw handler stays wired.

**Tech Stack:** TypeScript, Node.js, `@larksuiteoapi/node-sdk`, Vitest

---

### Task 1: Add a failing regression test for message-read raw event handling

**Files:**
- Create: `test/bot/channel.test.ts`
- Modify: `src/bot/channel.ts`

**Step 1: Write the failing test**

Add a focused test that:
- Creates a fake channel-like object with a `dispatcher.register()` spy.
- Invokes a new exported helper that wires raw handlers onto the channel.
- Captures logger calls.
- Dispatches a fake `im.message.message_read_v1` payload.
- Asserts the handler logs the reader identity and message id.

**Step 2: Run test to verify it fails**

Run: `pnpm test test/bot/channel.test.ts`

Expected: FAIL because the raw handler helper does not exist yet.

### Task 2: Implement minimal raw message-read registration and logging

**Files:**
- Modify: `src/bot/channel.ts`

**Step 1: Add a narrow raw-channel type and parser**

Add a small helper layer that:
- Detects whether the SDK channel exposes an internal `dispatcher.register()` function.
- Registers `im.message.message_read_v1` only when available.
- Extracts `reader`, `message`, and `chat` identifiers from the raw payload.

**Step 2: Log the read receipt**

Use the existing structured logger to emit one info event such as:
- phase: `read`
- event: `message-read`
- fields: `messageId`, `openChatId` or `chatId`, `readerOpenId`, `readerUserId`, `eventId`

**Step 3: Keep behavior surgical**

Do not change message processing, command handling, or card logic. The only user-visible change should be:
- the SDK warning disappears for this event
- a bridge log line appears when a read receipt arrives

### Task 3: Verify with targeted tests

**Files:**
- None

**Step 1: Run the targeted test**

Run: `pnpm test test/bot/channel.test.ts`

Expected: PASS

**Step 2: Run any adjacent regression test if needed**

Run: `pnpm test test/agent/claude/adapter.test.ts`

Expected: PASS

**Step 3: Report actual verification status**

If the local Vitest environment is still broken, record the exact failing command and verify the helper with a smaller direct execution path instead of claiming full test success.
