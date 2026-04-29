# 04-Agentic Loop，让模型开始干活

![](https://neptune-ipc.oss-cn-shenzhen.aliyuncs.com/img/20260429133504093.png)

前面三章，我们已经把命令行壳子搭好了：有入口、有管道模式、有流式输出。

但是，模型本质上还在「聊天」。它不知道你磁盘里有什么，也没法自己跑命令。

这章要补上最关键的一段能力：**让模型调用工具，并在循环里自己推进任务**。也就是常说的 Agentic Loop。

> Agentic Loop = 模型思考一次 + 需要就调工具 + 把结果塞回上下文 + 再思考，直到得到最终回答。

本章配套代码：[`chapter-04`](https://github.com/ricoNext/hello-agent-cli/tree/chapter-04)

---

第 3 章结束时，`-p` 还是纯对话路径（`runQuery`）。所以像下面这种问题，模型其实答不准：

```tsx
// src/cli.ts
// 无参数且非管道：进入交互 REPL
if (!(prompt || opts.pipe)) {
  // 动态导入 `runRepl` 避免入口阻塞
  const { runRepl } = await import("./ui/REPL.js");
  await runRepl({ model: opts.model });
  return;
}

// -p 场景直接调用 runQuery
await runQuery({ prompt, model: opts.model });
```

- 当前目录有多少个 `.ts` 文件？
- 最近 `git` 改了哪些文件？
- 这段脚本跑完有没有报错？

原因很简单：它没看到真实环境，只能猜。

这章做五件事：

1. 定义最小 Tool 抽象，先实现 `bash`。
2. 把 `bash` 挂到 OpenAI `tools`。
3. 写一个 `runAgentPipe` 循环，支持多轮和并行 `tool_calls`。
4. 失败信息回灌给模型，让它自我修正。
5. 接入 CLI，给循环加 `--max-turns` 兜底。

最终的结果是：

```bash
bun run src/index.ts -p "当前目录有多少个 .ts 文件？"
# Agent 自动调用 bash("find . -name '*.ts' | wc -l") 并回复
xx 个 TypeScript 文件。
```

**首先让我们先看整体流程**

![](https://neptune-ipc.oss-cn-shenzhen.aliyuncs.com/img/20260423174215080.png)

这是Agentic Loop 的「最小闭环」。

有几个关键点需要理解： 

1. **上下文是累加的**：每一轮 `callLLM` 用的都是到目前为止的整条 `messages` 数组（用户、助手、`tool` 结果都会陆续 `push` 进去）。所以循环里最常见的操作就是：`callLLM` → 视情况追加消息 → 再 `callLLM`。
2. **工具调用不是凭空出现的**：模型返回的是一条 `role: 'assistant'` 的消息；若它想调工具，这条消息里会带上 `tool_calls` 字段（里面是若干条「我要调哪个函数、参数是什么」）。**`tool_calls` 挂在 assistant 上**，后面写调用工具时必须先入栈这条 assistant，再写 `tool` 消息，协议才成立。
3. **「否」分支就是普通聊天**：没有 `tool_calls` 时，说明模型认为不需要查环境，直接输出 `content` , 这和第 3 章的纯对话其实是同一条路，只是前面多绕了几圈工具而已。




这就是 Agentic Loop 的核心：**工具分支和普通回答分支走同一条管道，只是在中间加了一段执行工具的环节**。

说了那么多， 开始进入代码实现阶段。

**1. 实现 `bash` 工具**

首先实现一个 `bash` 工具，它需要查文件、跑命令时，可以真的去执行，而不是靠语言模型想象， 这里使用 `Bun.spawn` 来执行命令。

新建 `src/tools/bash.ts`：

```typescript
// src/tools/bash.ts
// 最大输出长度
const MAX_OUT = 8000

// bash 工具返回结果类型
// 包括 stdout、stderr、exitCode
export interface BashResult {
  stdout: string
  stderr: string
  exitCode: number
}

// 执行 bash 命令
export async function executeBash(command: string): Promise<string> {
  // 使用 Bun.spawn 执行命令
  const proc = Bun.spawn(['sh', '-c', command], {
    cwd: process.cwd(),
    stdout: 'pipe', // 管道模式，流式输出
    stderr: 'pipe', // 管道模式，流式输出
  })

  // 等待命令执行完成
  const exitCode = await proc.exited
  // 获取 stdout 输出， 需要使用 Response 来读取流式输出
  const stdout = await new Response(proc.stdout).text()
  // 获取 stderr 输出
  const stderr = await new Response(proc.stderr).text()

  // 截断输出
  const out = truncate(stdout, MAX_OUT)
  // 截断 stderr 输出
  const err = truncate(stderr, MAX_OUT)
  const payload: BashResult = { stdout: out, stderr: err, exitCode }
  // 返回 JSON 字符串
  return JSON.stringify(payload, null, 2)
}

// 截断输出
function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max)}\n…(truncated, ${s.length} chars)`
}
```

这个工具很简单，就是执行一条命令，并返回结果。下面看如何告诉模型这个工具的存在。

**2. 注册 `tools`**

模型要用工具， 就需要告诉模型这个工具的存在。 在 OpenAI 中， 工具是通过 `tools` 字段来注册的。

新建 `src/tools/openaiTools.ts`用来注册工具：后续工具都往这里注册。

每个工具是一个对象，包含 `name`、`description`、`parameters` 三个字段。 这些参数是模型用来识别和调用工具的。

```typescript
import type { ChatCompletionTool } from 'openai/resources/chat/completions'

export const openaiTools: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'bash',
      description:
        '在项目当前工作目录执行一条 shell 命令，返回 stdout、stderr、exitCode 的 JSON。适合统计文件、运行测试、查看 git 状态等。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要执行的 shell 命令，一条字符串' },
        },
        required: ['command'],
      },
    },
  },
]
```

`description` 和 `parameters` 它们会直接进上模型上下文。写得清楚，大模型调用成功率会明显更高。

然后就是最重要的一环：写 `runAgentPipe` 循环。 来编排整个 Agentic Loop 流程。

**3. 写 `runAgentPipe` 循环**

这一步是整章核心。

先定义系统提示，告诉模型：什么场景调用什么工具。这里很关键， 模型不会自己知道要调用哪个工具， 需要我们告诉它。

```typescript
// src/agent/loop.ts
import type {
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";

const SYSTEM: ChatCompletionMessageParam = {
  role: 'system',
  content:
    '你是命令行里的编码助手。需要列文件、统计数量、跑测试时，优先用 bash 工具获取真实输出；不要编造命令结果。',
}
```

**4. 定义单次请求函数 `callModel`**

作为整个循环的入口。 它负责调用模型， 并返回模型响应。

```typescript
// src/agent/loop.ts
import { openaiTools } from "../tools/openai-tools.js";

export function callModel(
  model: string,
  messages: ChatCompletionMessageParam[]
) {
  return client.chat.completions.create({
    model,
    messages: [SYSTEM, ...messages],
    // 注册工具
    tools: openaiTools,
    // 自动选择工具
    tool_choice: "auto",
  });
}
```

**5. 定义对外入口 `runAgentPipe` 函数**

 `runAgentPipe` 函数作为对接 `Commander` 的入口， 它负责调用 `callModel` 函数， 并处理模型响应。 循环调用 `callModel` 函数， 直到模型返回没有 `tool_calls` 为止。

 `handleToolCalls` 函数负责处理模型返回的 `tool_calls` 字段， 它负责调用工具， 并返回工具调用结果。 我们在先明白整个 `runAgentPipe` 函数的流程后再实现

 `maxTurns` 参数是用来限制最大轮次， 防止模型在失败命令上死磕。 如果模型在某个命令上反复失败， 那么就停止循环， 并退出程序。 `Commander` 入口中会传递这个参数。

```typescript
// src/agent/loop.ts
export async function runAgentPipe(opts: {
  prompt: string
  model: string
  maxTurns: number;
}): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    console.error('错误：请设置 OPENAI_API_KEY')
    process.exit(1)
  }

  for (let turn = 0; turn < opts.maxTurns; turn++) {
    const res = await callModel(opts.model, messages);
    const choice = res.choices[0];
    const msg = choice?.message;
    if (!msg) {
      console.error("模型未返回 message");
      process.exit(1);
    }

    if (msg.tool_calls?.length) {
      const chunk = await handleToolCalls(msg);
      messages.push(...chunk);
      continue;
    }

    console.log(msg.content ?? "");
    return;
  }

  console.error(`已达到最大轮次 ${opts.maxTurns}，停止以防死循环。`);
  process.exit(1);
}
```

当模型认为“先调工具比直接回答更可靠”时，它就会在 assistant 消息里带 tool_calls；否则就直接给 content。

上面的代码核心逻辑就是通过 大模型是否返回 `tool_calls` 字段来判断是否需要调用工具。 只要大模型判定还需要继续调用工具，那就继续循环调用 `callModel` 函数，直到模型返回没有 `tool_calls` 为止。

工具调则使用 `handleToolCalls` 函数来将工具调用结果写回 `messages` 数组， 来保持上下文的连贯性。

**6. 定义 `handleToolCalls` 函数处理 `tool_calls`**

首先看一下 `assistant` 消息的结构：

```json
{
  "id": "chatcmpl_xxx",
  "object": "chat.completion",
  "created": 1710000000,
  "model": "gpt-4o-mini",
  "choices": [
    {
      "index": 0,
      "finish_reason": "tool_calls",
      "message": {
        "role": "assistant",
        "content": null,
        "tool_calls": [
          {
            "id": "call_abc123",
            "type": "function",
            "function": {
              "name": "bash",
              "arguments": "{\"command\":\"find . -name '*.ts' | wc -l\"}"
            }
          }
        ]
      }
    }
  ]
}
```

`tool_calls` 它是一个数组， 每个元素是一个对象， 包含 `id`、`type`、`function`、`arguments` 等字段。

处理 `tool_calls` 的顺序是：

1. 先把这条带 `tool_calls` 的 `assistant` 消息入栈。
2. 并行执行这些 `tool_calls`（`Promise.all`）。例如一个 assistant 需要同时查文件、查 git、跑命令）。这些调用通常彼此独立，并行最划算和效率最高。
3. 再按原始顺序写回 `role: 'tool'` 消息，并带对应的 `tool_call_id`。 这里写回的 `tool` 消息是给大模型看的， 大模型会根据 `tool_call_id` 找到对应工具的调用结果。

实现片段：

```typescript
// src/agent/loop.ts
async function handleToolCalls(msg: ChatCompletionMessage): Promise<ChatCompletionMessageParam[]> {
  // 获取工具调用请求
  const calls = msg.tool_calls ?? []
  // 创建一个空数组，用于存储追加的消息
  const appended: ChatCompletionMessageParam[] = []

  // 并行执行工具调用请求
  const results = await Promise.all(
    // 遍历工具调用请求
    calls.map(async (tc) => {
      // 如果工具调用请求的类型不是 function，则返回错误
      if (tc.type !== 'function') return { id: tc.id, body: '不支持的 tool_calls.type' }

      const name = tc.function.name
      // 解析工具调用请求的参数
      let args: { command?: string }
      try {
        args = JSON.parse(tc.function.arguments || '{}') as { command?: string }
      } catch {
        return { id: tc.id, body: 'tool 参数 JSON 解析失败' }
      }

      try {
        // 根据工具名称执行不同的工具， 真实的场景会使用策略模式来执行不同的工具。
        if (name === 'bash') {
          // 获取需要执行的命令
          const cmd = args.command ?? ''
          if (!cmd.trim()) return { id: tc.id, body: '错误：command 为空' }
          // 执行 bash 命令，并返回结果
          const body = await executeBash(cmd)
          return { id: tc.id, body }
        }
        return { id: tc.id, body: `未知工具: ${name}` }
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e)
        return { id: tc.id, body: `工具执行错误: ${m}` }
      }
    }),
  )

  appended.push(msg)
  // 遍历工具调用结果
  for (const r of results) {
    appended.push({ role: 'tool', tool_call_id: r.id, content: r.body })
  }
  return appended
}
```

看着很多， 其实逻辑很简单， 就是遍历 `tool_calls` 数组， 并行执行工具调用请求， 然后按原始顺序写回 `role: 'tool'` 消息， 并带对应的 `tool_call_id`。

这里有点需要说明一下， 执行错误的信息也要写入到 `messages` 数组， 这样大模型在下一轮会看到失败原因，通常会自动修正命令， 然后继续返回 `tool_calls` 字段， 继续循环调用工具，直到工具调用成功为止。

**7. 接入 Commander**

`src/cli.ts` 里，把 `-p` 模式下的执行路径换成 `runAgentPipe`，并新增参数 `maxTurns`：

```typescript
// src/cli.ts

.action(async (promptParts: string[], opts) => {
  const prompt = await resolvePrompt(promptParts, opts.pipe);

  // 无参数且非管道：进入交互 REPL
  if (!(prompt || opts.pipe)) {
    // 动态导入 `runRepl` 避免入口阻塞
    const { runRepl } = await import("./ui/repl-app.js");
    await runRepl({ model: opts.model });
    return;
  }

  // 显式指定 -p 才走 Agent 管道
  if (opts.pipe) {
    if (!prompt) {
      console.error("错误：-p 模式下未读取到输入内容");
      return;
    }
    const { runAgentPipe } = await import("./agent/loop.js");
    await runAgentPipe({
      prompt,
      model: opts.model,
      maxTurns: Number(opts.maxTurns ?? 16),
    });
    return;
  }

  // 非 -p 模式：走普通单轮查询
  await runQuery({
    prompt,
    model: opts.model,
  });
});

```

这章先只改 `-p` 走 Agent 模式。REPL 仍可以保持第 3 章的流式对话，后面再统一升级「流式 + 工具」。


## 验证

```bash
bun run src/index.ts -p "当前目录有多少个 .ts 文件？请用工具统计后回答。"
bun run src/index.ts -p --max-turns 8 "列出当前目录前 5 个 .ts 文件名"
```

预期现象：

- 模型会触发 `bash` 调用。
- 最终输出自然语言总结。
- 不会卡死；超过 `--max-turns` 会退出报错。

安全提醒：`bash` 本质上就是本机命令执行能力，只在可信目录使用。



## Claude Code 的 Agentic Loop 实现方式

> 参考仓库：[Claude Code](https://github.com/ricoNext/claude-code)

- `src/query.ts`：偏单次查询和事件流处理（SSE、增量文本、工具触发等）。
- `src/QueryEngine.ts`：偏会话状态机（多轮、恢复、UI、权限等横切逻辑）。
- 这两个模块拆开，本质是为了可测试性和可演进性。

我们这章先用一个 `runAgentPipe` 把闭环做小、做清楚。后续再拆分，不晚。



## 小结

这一章完成了 Agent CLI 的第一条「会干活」链路：

1. 有了 `bash` 工具和输出截断。
2. 有了 OpenAI `tools` 声明。
3. 有了多轮循环、并行执行和错误回灌。
4. 管道模式接入 Agent，支持 `--max-turns`。

相对于 Claude Code 的核心功能， hello-agent-cli 项目的能力也慢慢开始丰富起来了。

| 能力 | 我们 | Claude Code |
| --- | --- | --- |
| 单工具 bash | ✓ | ✓（BashTool 更完整） |
| Agentic Loop | ✓（管道非流式） | ✓（流式 + 多事件） |
| 并行 tool_calls | ✓ | ✓ |
| 权限 / 确认 | ✗ | ✓（PreToolUse Hook） |
| 工具注册表 / 数十工具 | ✗ | ✓（`src/tools.ts` 等） |
| REPL 内 Agent | ✗（可扩展） | ✓ |

从这一章开始，模型不再只是回答问题，而是可以自己去环境里取证据、再给结论。

我认为这是 Agent CLI 和普通聊天程序的分水岭。

下一章我们做上下文构建：在进模型前自动注入 Git 状态、项目信息，让 Agent 少问废话。

```bash
# 第 5 章预告
bun run src/index.ts -p "我们现在在哪个分支？最近有什么改动？"
```

[实战仓库](https://github.com/ricoNext/hello-agent-cli/tree/chapter-04)
