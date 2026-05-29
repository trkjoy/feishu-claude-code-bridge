# Ask User Question Card Bridge Design

**Date:** 2026-05-29

## Background

当前 bridge 只能处理两类来自飞书的“继续输入”：

- 普通消息
- 带 `__claude_cb` 的卡片点击，被包装成下一轮 `[card-click] {...}`

这不满足“同一个正在等待中的 run 内继续”的要求。根因有两点：

1. `ClaudeAdapter` 启动 `claude` 时 `stdin` 为 `ignore`，bridge 不能把选择直接回填给同一个进程。
2. 现有卡片回调只会进入 `PendingQueue`，语义是“下一轮消息”，不是“唤醒一个当前阻塞中的本地命令”。

因此这次不改 Claude 协议本身，而是在 bridge 内新增一个“本地阻塞 ask 命令 + 本地状态文件 + 卡片回调分流”。

## Goal

让 Claude 在需要用户选择时，能够：

1. 发一张飞书卡片按钮给当前会话用户
2. 在本地阻塞等待选择
3. 用户点击后，把结果返回给同一个等待中的命令
4. 让当前 run 继续，而不是开启下一轮新消息

## Non-goals

- 不处理自由文本回答，本次只支持按钮/选项列表
- 不实现跨重启恢复；bridge 或 ask 进程退出后，未完成问题按失效处理
- 不实现卡片原地更新/禁用按钮，先保证回填链路可用
- 不兼容 Claude 内部未知的原生 `AskUserQuestion` 协议；通过 system prompt 引导 Claude 改用 bridge 自己的 `ask` 命令

## High-Level Flow

1. Claude 需要用户选择时，执行：
   - `lark-channel-bridge ask --chat-id ... --operator-open-id ... --question ... --options ...`
2. `ask` 命令：
   - 读取与当前 bridge 一致的配置
   - 用飞书 OpenAPI 发一张 CardKit 2.0 按钮卡
   - 在 `~/.lark-channel/asks/<askId>.json` 写入 `pending` 状态
   - 轮询等待该文件从 `pending` 变成 `answered`
3. 用户点击按钮，bridge 收到 `cardAction`
4. `src/card/dispatcher.ts` 先识别这是不是一个 ask 回调：
   - 是：写回 `asks/<askId>.json`，不进入 `PendingQueue`
   - 否：保持原有 `__claude_cb` / 命令卡片逻辑
5. `ask` 命令读到结果后输出 JSON 到 stdout 并退出 0
6. Claude 从工具输出读取结果，继续当前 run

## Local State Model

每个 ask 使用一个独立 JSON 文件，避免多进程共享大 JSON 带来的冲突面。

路径：

- `~/.lark-channel/asks/<askId>.json`

结构：

```json
{
  "id": "ask_xxx",
  "status": "pending",
  "chatId": "oc_xxx",
  "operatorOpenId": "ou_xxx",
  "question": "请选择环境",
  "options": [
    { "value": "staging", "label": "预发" },
    { "value": "prod", "label": "生产" }
  ],
  "createdAt": "2026-05-29T12:00:00.000Z",
  "expiresAt": "2026-05-29T12:10:00.000Z",
  "messageId": "om_xxx",
  "answer": {
    "value": "prod",
    "label": "生产",
    "operatorOpenId": "ou_xxx",
    "operatorName": "Alice",
    "answeredAt": "2026-05-29T12:00:20.000Z"
  }
}
```

状态机：

- `pending` -> `answered`
- `pending` -> 删除文件（超时/失败清理）

本次不引入 `cancelled`、`expired` 持久状态，避免额外分支；超时直接由 `ask` 命令清理文件并退出非 0。

## Card Callback Contract

新增 marker：

- `__bridge_ask: true`

按钮 `value` 形态：

```json
{
  "__bridge_ask": true,
  "ask_id": "ask_xxx",
  "option_value": "prod",
  "option_label": "生产"
}
```

分流优先级：

1. 先处理 `__bridge_ask`
2. 再处理已有 `__claude_cb`
3. 最后处理 `cmd`

这样 ask 回调不会被错误地塞进 `[card-click] {...}` 下一轮消息。

## CLI Contract

新增内部命令：

```bash
lark-channel-bridge ask \
  --chat-id oc_xxx \
  --operator-open-id ou_xxx \
  --question "请选择环境" \
  --options '[{"value":"staging","label":"预发"},{"value":"prod","label":"生产"}]'
```

约束：

- `--chat-id` 必填
- `--operator-open-id` 必填，用于限制只有原操作者可以回答
- `--question` 必填
- `--options` 必填，JSON 数组，至少 2 个选项
- `--timeout-seconds` 选填，默认 600
- `--config` 选填，默认来自 `LARK_CHANNEL_CONFIG`，再回退到 `paths.configFile`

stdout 成功输出：

```json
{
  "id": "ask_xxx",
  "value": "prod",
  "label": "生产",
  "operatorOpenId": "ou_xxx",
  "operatorName": "Alice"
}
```

失败行为：

- 超时：stderr 输出原因，退出码非 0
- 配置无效 / 发卡失败：stderr 输出原因，退出码非 0

## Config Propagation

为了兼容 `lark-channel-bridge run --config <path>`，bridge 需要在启动后把当前配置路径暴露给子进程：

- 设置环境变量 `LARK_CHANNEL_CONFIG=<resolved-config-path>`

这样 Claude 在当前 run 内执行 `lark-channel-bridge ask` 时，会自动读取与 bridge 主进程一致的配置。

## Security Rules

1. ask 文件必须记录 `operatorOpenId`
2. 只有同一个 `operatorOpenId` 的卡片点击才允许回答
3. 选项值必须命中原始 `options`
4. 不存在 / 已清理 / 已回答的 ask 点击一律忽略，不转成普通消息
5. 只记录必要日志，不在日志里展开全部问题内容和全部卡片 JSON

## Logging

新增结构化日志：

- `ask.created`
- `ask.answered`
- `ask.timeout`
- `cardAction.ask-answered`
- `cardAction.ask-skip-*`

用于排查“为什么点击后没继续”。

## Files To Change

- `src/config/paths.ts`
  - 新增 `asksDir`
- `src/ask/store.ts`
  - ask 状态文件读写、校验、轮询
- `src/card/ask-card.ts`
  - 生成 CardKit 2.0 选择卡
- `src/cli/commands/ask.ts`
  - 发卡并阻塞等待
- `src/cli/index.ts`
  - 注册 `ask` 命令
- `src/card/dispatcher.ts`
  - 回调分流到 ask store
- `src/cli/commands/start.ts`
  - 设置 `LARK_CHANNEL_CONFIG`
- `src/agent/claude/adapter.ts`
  - 在 system prompt 里教 Claude 使用 `lark-channel-bridge ask`
- `test/ask/store.test.ts`
- `test/card/dispatcher.test.ts`
- `test/cli/ask.test.ts`

## Verification Strategy

1. store 级测试
   - pending ask 能写入
   - 回答后能读出结果
   - 非法操作者/非法选项被拒绝
2. dispatcher 级测试
   - ask 回调不会进入 `PendingQueue`
   - 普通 `__claude_cb` 不受影响
3. CLI 级测试
   - `ask` 命令能发送卡并等待结果
   - 回答后 stdout 输出期望 JSON
4. `pnpm test`
5. `pnpm typecheck`
6. `pnpm build`
