# 03-流式输出与交互式 REPL

![](https://neptune-ipc.oss-cn-shenzhen.aliyuncs.com/img/20260422134424581.png)

**Hello Agent CLI** 是一个生产级 Agent CLI 搭建的系列教程，这个系列教程基于 [Claude Code](https://github.com/ricoNext/claude-code) 的源码，从零开始手把手教你如何搭建一个生产级可用的 Agent CLI 工具，并对比 Claude Code 的实现方式，帮助你理解 Agent CLI 工具的实现原理。

喜欢的话，可以关注一下这个合集，我会持续更新这个系列教程。

本节我们看**流式输出与交互式 REPL**：把「问一句、打一行、进程结束」升级成「终端里多轮聊、模型边想边打字」。

本节代码仓库：[实战仓库](https://github.com/ricoNext/hello-agent-cli/tree/chapter-03)， 你可以先克隆下来，跟着本节教程一起学习。

第 2 章已经具备管道模式与 Commander 入口。本章在此基础上增加：

- 无参数启动时进入 **Ink 驱动的 REPL**（而不是只打印 `--help`）；
- 使用 OpenAI SDK 的 **`stream: true`**，把 token 增量拼接到当前助手输入框里；
- 维护 **`messages[]` 会话历史**，实现多轮对话；
- 最基础的 **斜杠命令**：`/exit`、`/clear`、`/help`。

最终结果如下：

```bash
bun run src/index.ts
> 什么是闭包？
JavaScript 中的闭包……   ← 逐字出现（流式）
[完成，约 120 tokens，2.1s]
> /exit
```

---

## 1. 依赖与 TypeScript 配置

本章需要 **React** 与 **Ink**（终端里的 React 渲染层）。在项目根目录执行：

```bash
bun add ink react
bun add -d @types/react
```

确保 `package.json` 里仍是 `"type": "module"`。在 `tsconfig.json` 中开启 JSX（若尚未配置）：

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ES2022",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["bun-types"]
  },
  "include": ["src/**/*"]
}
```

### Ink 是什么

**Ink** 是用 **React** 编写终端用户界面（TUI）的库：你写的是 JSX（例如 `<Box>`、`<Text>`），渲染目标不是浏览器的 DOM，而是 **标准输出上的 ANSI 转义序列**（光标移动、颜色、清除行等）。在 npm 生态里 Ink 很常见，Claude Code 等大型 CLI 也采用「React + 终端 reconciler」这一类思路，把复杂交互当成组件树来维护。

可以粗略理解成：**把终端当成一块没有 `<div>` 的黑底画布**，用 Flex 子集做纵向/横向布局，用 `<Text>` 控制颜色、加粗；键盘事件交给 `useInput`，应用生命周期交给 `useApp`。如果你已经会 `useState`、拆组件，上手成本主要是熟悉 Ink 提供的少量原语，而不是再学一套完全不同的范式。

## 2. 定义终端消息类型

第 1 章的 `Message` 结构：`role` + `content` 用来描述对话的上下文，现在再单独定义 `ChatRow` 来存放对话的渲染信息


```typescript
// src/types/chatRow.ts
import type { Role } from './message.js'
```

再写消息行结构：`streaming` 为 `true` 时在界面上画一个 `▋` 光标，表示模型还在输出，为 `false` 时表示模型输出完成。

```typescript
// src/types/chatRow.ts
/** 终端里展示的一行（含用户与助手） */
export interface ChatRow {
  id: string
  role: Role
  content: string
  /** 在流式生成未结束时为 true */
  streaming?: boolean
}
```

`id` 作为 React 列表渲染时的 `key`，在流式更新时也能找到「当前正在变长的那一行」，用 `id` 比用数组下标更安全。

`Role` 在 `src/types/message.ts` 中定义，这里直接导入即可。

## 3. REPL 功能实现

### 3.1 第一步：先让 REPL 跑起来

先实现一个能显示标题、能输入字符、能回车提交的空界面，但不接 LLM。

先准备最小组件骨架：

```tsx
// src/ui/REPL.tsx
import React, { useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';

export function REPLApp({ model }: { model: string }) {
  const { exit } = useApp();
  const [input, setInput] = useState('');

  // useInput 钩子函数，用于处理用户输入
  useInput((ch, key) => {
    // 回车提交
    if (key.return) {
      setInput('')
      return
    }
    // 删除字符
    if (key.backspace || key.delete) {
      setInput((s) => s.slice(0, -1))
      return
    }
    // 退出
    if (key.ctrl && (ch === 'c' || ch === 'C')) {
      exit()
      return
    }
    // 输入字符
    if (ch && !key.ctrl && !key.meta) setInput((s) => s + ch)
  })

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">hello-agent-cli REPL · 模型 {model}</Text>
      <Text>{`> ${input}`}</Text>
    </Box>
  )
}
```

再补一个入口函数，供 Commander 动态加载调用：

```tsx
// src/ui/REPL.tsx（片段 2）
export async function runRepl(opts: { model: string }): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    console.error('错误：请设置 OPENAI_API_KEY')
    process.exit(1)
  }
  const { render } = await import('ink')
  const app = render(<REPLApp model={opts.model} />)
  await app.waitUntilExit()
}
```

到这里已经有一个**可进入、可退出、可输入**的终端 UI 外壳。

我们需要将 `runRepl` 在 `src/cli.ts` 中调用，并确保在无参数且非 `-p` 时调用。

在 `src/cli.ts` 中的 `runCli` 函数中找到 `.action(async (promptParts, opts) => { ... })` 这段代码，并在其内部调用 `runRepl`。

```typescript
// src/cli.ts（片段 1）
.action(async (promptParts, opts) => {
  const prompt = await resolvePrompt(promptParts, opts.pipe)

  // 无参数且非 `-p` 时调用 `runRepl`
  if (!prompt && !opts.pipe) {
    // 动态导入 `runRepl` 避免入口阻塞
    const { runRepl } = await import('./ui/REPL.js')
    await runRepl({ model: opts.model })
  }

  await runQuery({ prompt, model: opts.model });
})
```
执行命令：

```bash
# 1) 启动 REPL
bun run src/index.ts
```

效果如下：
![](https://neptune-ipc.oss-cn-shenzhen.aliyuncs.com/img/20260421183728647.png)


继续测试键盘行为：

```bash
# 2) 输入任意字符，例如 abc，按 Backspace
# 预期：输入内容逐字符删除

# 3) 直接按 Enter
# 预期：当前输入被清空（空壳阶段不请求 LLM）

# 4) 按 Ctrl+C
# 预期：REPL 正常退出并返回 shell
```

### 3.2 第二步：接入流式 API

下面把“模型如何流式输出文本”独立封装，不让 REPL 组件关心网络协议细节。

```typescript
// src/agent/streamQuery.ts
import OpenAI from 'openai'
import type { Message } from '../types/message.js'

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
})

export interface StreamQueryOptions {
  model: string
  messages: Message[]
  onDelta: (text: string) => void
}
```

定义流式请求的函数 `streamChatCompletion`， 这个函数会调用 OpenAI SDK 的 `chat.completions.create` 方法来流式请求模型，并调用 `onDelta` 回调函数来处理每次收到的增量文本。

```typescript
// src/agent/streamQuery.ts
export async function streamChatCompletion(opts: StreamQueryOptions): Promise<void> {
  const stream = await client.chat.completions.create({
    model: opts.model,
    messages: opts.messages,
    max_tokens: 2048,
    stream: true,
  })

  for await (const chunk of stream) {
    const piece = chunk.choices[0]?.delta?.content ?? ''
    if (piece) opts.onDelta(piece)
  }
}
```

这一步完成后，REPL 只要传一个 `onDelta`，就能得到增量文本，不需要知道 SSE 事件细节。

### 3.3 第三步：让“回车提交”真正发请求并流式更新

这一步开始打通最小闭环，用户输入 -> 模型流式输出 -> 屏幕持续增长。

先补 UI 状态与类型分工：

```tsx
// src/ui/REPL.tsx
import { streamChatCompletion } from '../agent/streamQuery.js'
import type { ChatRow } from '../types/chatRow.js'
import type { Message } from '../types/message.js'

// 生成唯一 ID
function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

// 估算文本长度（每 4 个字符算 1 token）
function roughTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / 4))
}

// 在 REPLApp 组件内 加入状态与类型分工定义
const [rows, setRows] = useState<ChatRow[]>([]) // 终端消息列表
const [history, setHistory] = useState<Message[]>([]) // 对话历史
const [busy, setBusy] = useState(false) // 是否正在请求
```

再写提交请求的 `submit` 核心逻辑， 这个函数会在用户回车时调用 `streamChatCompletion` 函数来流式请求模型，并更新终端消息列表和对话历史。

1. 首先判断输入是否为空或正在请求，如果满足条件则返回。
2. 然后创建用户消息行，助手消息行，更新终端消息列表和对话历史，更新是否正在请求。
3. 然后记录开始时间，累加文本。
4. 然后尝试流式请求模型，如果请求成功，则累加文本，更新终端消息列表和对话历史。
5. 如果请求失败，也更新终端消息列表和对话历史。
6. 最后计算请求时间，创建完成提示，更新终端消息列表和对话历史。

代码如下：

```tsx
// src/ui/REPL.tsx  REPLApp 组件内部
const submit = async (line: string) => {
  const trimmed = line.trim()
  // 如果输入为空或正在请求，则返回
  if (!trimmed || busy) return

  // 创建用户消息行
  const userRow: ChatRow = { id: uid(), role: 'user', content: trimmed }

  // 创建助手消息行
  const botId = uid()

  // 更新终端消息列表
  setRows((r) => [...r, userRow, { id: botId, role: 'assistant', content: '', streaming: true }])
  // 更新对话历史
  const nextHistory: Message[] = [...history, { role: 'user', content: trimmed }]
  // 更新对话历史
  setHistory(nextHistory)
  // 更新是否正在请求
  setBusy(true)

  // 记录开始时间
  const t0 = performance.now()
  // 累加文本
  let acc = ''

  // 尝试流式请求
  try {
    await streamChatCompletion({
      model,
      messages: nextHistory,
      onDelta: (t) => {
        // 累加文本
        acc += t
        setRows((prev) =>
          // 更新助手消息行
          prev.map((row) => (row.id === botId ? { ...row, content: row.content + t } : row)),
        )
      },
    })


    // 流式请求完成之后的逻辑

    // 计算请求时间
    const sec = ((performance.now() - t0) / 1000).toFixed(1)
    // 创建完成提示
    const footer = `[完成，约 ${roughTokens(acc)} tokens，${sec}s]`
    // 更新助手消息行
    setRows((prev) =>
      prev.map((row) =>
        row.id === botId ? { ...row, content: `${row.content}\n${footer}`, streaming: false } : row,
      ),
    )
    // 更新对话历史
    setHistory((h) => [...h, { role: 'assistant', content: acc }])
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    setRows((prev) =>
      prev.map((row) => (row.id === botId ? { ...row, content: `错误：${msg}`, streaming: false } : row)),
    )
  } finally {
    setBusy(false)
  }
}
```

定义了 `submit` 函数之后，我们就可以在用户回车时调用这个函数来流式请求模型，并更新终端消息列表和对话历史。

另外我们需要在 `useInput` 回车事件中调用 `submit`：

```tsx
// src/ui/REPL.tsx
  useInput((ch, key) => {
    if (busy) {
      return;
    }
    if (key.return) {
      submit(input); // 提交输入
      setInput(""); // 清空输入
      return;
    }
    // ...
  });
```

### 3.4 第四步：定义渲染消息列表

上面我们已经定义了进入交互的提示模块和输入模块， 现在我们将消息列表 `rows` 渲染到终端。

代码如下：

```tsx
// src/ui/REPL.tsx
return (
  <Box flexDirection="column">
      <Text bold color="cyan">
        hello-agent-cli REPL · 模型 {model}
      </Text>
      {rows.map((row) => (
        <Text dimColor={row.role === "user"} key={row.id}>
          {row.role === "user" ? "> " : "◆ "}
          {row.content}
          {row.streaming ? "▋" : ""}
        </Text>
      ))}
      <Text>{`> ${input}`}</Text>
    </Box>
)
```

到此为止，我们已经实现了流式输出与交互式 REPL 的基本功能。

![](https://neptune-ipc.oss-cn-shenzhen.aliyuncs.com/img/Kapture%202026-04-22%20at%2011.23.29.gif)


### 3.5 第五步：补齐可用性（斜杠命令 + 键盘映射）

我们先实现本地斜杠命令（不经过模型）， 这些命令不会影响对话历史，只是一些辅助功能。

```tsx
// src/ui/REPL.tsx 在 REPLApp 组件内部

// 用来执行斜杠命令的函数
const runSlash = (line: string): boolean => {
  const cmd = line.slice(1).trim().split(/\s+/)[0]?.toLowerCase() // 获取命令
  if (cmd === 'exit' || cmd === 'quit') { // /exit 命令 或 /quit 命令
    exit() // 退出 REPL
    return true
  }
  if (cmd === 'clear') { // /clear 命令
    setRows([])
    setHistory([])
    return true
  }
  if (cmd === 'help') { // /help 命令
    setRows((r) => [...r, { id: uid(), role: 'assistant', content: '命令：/exit /clear /help' }])
    return true
  }
  return false
}
```

再把 `useInput` 接到 `submit`：

```tsx
// src/ui/REPL.tsx（片段 6）
useInput((ch, key) => {
  if (busy) return
  if (key.return) {
    const line = input
    if (line.trim().startsWith('/')) { // 如果输入以 / 开头，则认为是斜杠命令
      if (!runSlash(line)) {
        // 如果斜杠命令不存在，则创建一个助手消息行，提示未知命令
        setRows((r) => [...r, { id: uid(), role: 'assistant', content: `未知命令：${line}` }])
      }
    } else {
       submit(line)
    }
    setInput('')
    return
  }
  // ...
})
```

这一步完成后，REPL 具备了“能聊、能清屏、能退出、能看状态”的基础可用性。

效果如下：

![](https://neptune-ipc.oss-cn-shenzhen.aliyuncs.com/img/Kapture%202026-04-22%20at%2011.33.37.gif)

### 3.6 第六步：补齐 Commander 入口

上面已经在 Commander 入口无参数并且非管道模式时，进入交互 REPL。 现在我们再补齐管道模式时，明确报错。

```typescript
// src/cli.ts（默认 command 的 action 片段）
.action(async (promptParts, opts) => {
  const prompt = await resolvePrompt(promptParts, opts.pipe)

  // 无参数且非管道：进入交互 REPL
  if (!prompt && !opts.pipe) {
    const { runRepl } = await import('./ui/REPL.js')
    await runRepl({ model: opts.model })
    return
  }

  // 管道但没有输入：明确报错
  if (!prompt && opts.pipe) {
    console.error('管道模式需要 stdin 或参数提供问题')
    process.exit(1)
  }

  // 其余情况保持第 2 章行为
  const { runQuery } = await import('./agent/query.js')
  await runQuery({ prompt, model: opts.model })
})
```

本章最终目录：

```plaintext
src/
├── index.ts
├── cli.ts
├── agent/
│   ├── query.ts
│   └── streamQuery.ts
├── types/
│   ├── message.ts
│   └── chatRow.ts
└── ui/
    └── REPL.tsx
```

---

## 4. 验证环节

确保环境变量已配置（与第 2 章相同）：

```bash
export OPENAI_API_KEY='sk-...'
export OPENAI_BASE_URL='https://dashscope.aliyuncs.com/compatible-mode/v1'  # 可选
export OPENAI_MODEL='qwen-max'  # 可选
```

交互 REPL：

```bash
bun run src/index.ts
> 用一句话解释闭包
# 观察助手行逐字增长，末尾有 [完成，约 … tokens，…s]
> /clear
> /help
> /exit
```

管道与单次问答仍应可用（第 2 章行为保留）：

```bash
echo "1+1等于几" | bun run src/index.ts -p
bun run src/index.ts "仅回答：OK"
```

---

## 5. 代码总结

下面总结了前面代码里「容易踩坑」的几件事，方便你对照自己的实现排查问题。

### 流式与「假流式」

`stream: true` 只表示**协议形态**是流式；服务端仍可能把答案切成少量大块推送。对 UI 来说没有区别：只要是 **增量**，就一段段拼到当前气泡即可。若上游一次只推一整段，你会看到「停顿一下然后一大段出现」，这仍然是合法流式。

### 为什么 REPL 里不要用 `console.log`

Ink 接管了 stdout 的绘制。中间插入 `console.log` 往往会 **打乱光标与布局**，出现「字叠在一起」或残影。调试请用 `process.stderr.write` 写日志，或单独开 `--debug` 分支（后续章节可加）。

### `history` 与 `rows` 的职责分离

- **`history`（Message[]）**：是发给模型的消息列表，只含 `user` / `assistant` 的纯对话内容。  
- **`rows`（ChatRow[]）**：终端展示，可含 footer、系统提示样式行等。本章把 `[完成，…]` 拼在助手 `content` 末尾，属于**偷懒但直观**的写法；生产里可拆成单独 UI 行，避免污染回灌给模型的文本。

### 斜杠命令与「工具调用」无关

这里的 `/` 前缀由 **本地** 解析，不经过模型。Claude Code 里还有大量斜杠命令会走另一套路由；我们第 4 章以后再接 Agentic Loop 与工具。

### `busy` 与并发

`busy` 为 `true` 时，`useInput` 与 `submit` 入口都应短路，否则用户可能在上一轮流式尚未结束时再次回车，导致**两个并发流**写同一行或交错写 `history`。本章用布尔锁是最小方案；更完整可做「请求序号」或取消令牌（AbortController）。

---

## 6 Claude Code 怎么做

> [Claude Code 代码仓库](https://github.com/ricoNext/claude-code)

- **主界面**：`src/screens/REPL.tsx`（体量极大，约五千行量级）。除对话列表外，还叠了权限弹窗、工具时间线、压缩提示、多模式切换等，全部挤在同一个 Ink 树里，靠状态机与子组件拆分维护。
- **流式**：上游在 `query.ts` / API 层解析 SSE，把 `text_delta` 等事件推到 UI；REPL 只负责「订阅事件 → 更新虚拟列表最后一项」。
- **性能**：外部资料与其内部优化方向包括 **React Compiler** 减轻重渲染、**虚拟列表** 支撑超长会话。我们本章用 `map` 全量渲染，在对话轮数少时完全够用， 多轮对话的优化方案后续章节再介绍。
- **三种交互模式**：对话（REPL）、管道（`-p`）、以及被 IDE/脚本调用的非交互/SDK 模式——与第 2 章入口分发路由的设计是一脉的。

---

**现在我们有什么，缺什么：**

| 能力 | 我们 | Claude Code |
| --- | --- | --- |
| 流式输出 | ✓（OpenAI `stream`） | ✓（SSE + 多事件类型） |
| 多轮对话 | ✓（本地 history） | ✓（含压缩、恢复会话） |
| REPL UI | ✓（Ink 基础版） | ✓（大型状态机 + 虚拟滚动） |
| 斜杠命令 | 仅 /exit /clear /help | 数十条，接权限与内部模式 |
| 工具调用 | ✗ | ✓（下一章核心） |

---

本章完成了：

1. **依赖与 JSX**：`ink`、`react`，`tsconfig` 开启 `jsx`。
2. **流式 API 封装**：`streamQuery.ts` 中 `for await` + `onDelta`。
3. **Ink REPL**：`REPL.tsx` 中消息列表、手写输入、`useApp` 退出。
4. **入口衔接**：无参数且无 `-p` 时进入 REPL；管道与单次问答仍走 `runQuery`。

下一章进入 **Agentic Loop**：让模型真正调用本地工具（例如 `bash`），循环直到任务结束。

```bash
# 第 4 章完成后的效果（预告）
bun run src/index.ts -p "当前目录有多少个 .ts 文件？"
# 模型将调用 bash 并汇总结果
```

## 7. 完整代码 

本章完整代码：
[实战仓库](https://github.com/ricoNext/hello-agent-cli/tree/chapter-03)
