# 01 Hello Agent CLI - 50 行实现最小 Agent CLI

![](https://neptune-ipc.oss-cn-shenzhen.aliyuncs.com/img/20260420171836146.png)

**Hello Agent CLI** 是一个生产级 Agent CLI 搭建的系列教程， 这个系列教程基于 [Claude Code](https://github.com/ricoNext/claude-code) 的源码，从零开始手把手教你如何搭建一个生产级可用的 Agent CLI 工具，并对比 Claude Code 的实现方式，帮助你理解 Agent CLI 工具的实现原理。

喜欢的话， 可以关注一下这个合集， 我会持续更新这个系列教程。

---

在上个章节介绍了这个教程的定位，规划了这个教程的大纲， 在这个章节， 我们会实现一个能从命令行接受问题、调用 LLM、打印回复的最小程序。它是后续所有功能的地基，也是你第一次看到 Agent 的骨架。

最终结果如下：

```bash
echo "用一句话解释闭包" | bun run src/index.ts -p
# 闭包是函数访问其定义时词法作用域中变量的能力。
```

---

## 1.1 初始化项目

```bash
mkdir hello-agent-cli && cd hello-agent-cli

# 初始化项目
bun init -y
```

`bun init` 会生成 `package.json`、`tsconfig.json` 和一个 `index.ts`。我们先修改 `package.json`，加上 ESM 声明和启动脚本：

```json
{
  "name": "hello-agent-cli",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "bun run src/index.ts"
  }
}
```

然后安装本章唯一需要的依赖, 用来支持大模型调用

```bash
bun add openai
```

> Anthropic SDK 的订购策略对国内用户不友好，所以本教程选择 OpenAI SDK。OpenAI SDK 支持 `baseURL` 参数，一行配置就能切换到任意 OpenAI 兼容接口——国内的通义千问、豆包、DeepSeek，或者本地的 Ollama，都走同一套代码。

创建源码目录：

```bash
#  创建 类型定义 目录
mkdir -p src/types
```

并将 `index.ts` 文件移动到 `src` 目录

---

## 1.2 类型定义

先定义两个基础类型，整个系列教程都会用到：

```typescript
// src/types/message.ts
// 定义消息角色
export type Role = 'user' | 'assistant' | 'system'

// 定义消息接口
export interface Message {
  role: Role
  content: string
}
```

这两个类型非常简单，但它们代表了 LLM 对话的核心数据结构。后续我们会在这里加入工具调用结果、图片内容、token 计数等字段，但核心始终是 `role` + `content` 这对组合。

关于角色的概念， 不熟悉的可以看 xx 这篇文章。

---

## 1.3 实现 index.ts

现在写核心文件：

```typescript
// src/index.ts
import OpenAI from 'openai'
import type { Message } from './types/message.js'

// 从环境变量读取配置，支持自定义端点（国内代理、本地 Ollama 等）
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL, // 不设置则使用 OpenAI 官方
})

const MODEL = process.env.MODEL ?? 'gpt-4o'

// 核心：调用 LLM 获取回复
async function query(messages: Message[]): Promise<string> {
  const response = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 1024,
    messages,
  })
  return response.choices[0]?.message?.content ?? ''
}

async function main() {
  // 检查 API Key
  if (!process.env.OPENAI_API_KEY) {
    console.error('错误：请设置 OPENAI_API_KEY 环境变量')
    console.error('  export OPENAI_API_KEY=sk-...')
    process.exit(1)
  }

  const args = process.argv.slice(2)
  const isPipe = args.includes('-p') || args.includes('--pipe')
  const prompt = args.filter(a => !a.startsWith('-')).join(' ')

  // 获取用户输入：命令行参数 或 stdin 管道
  let userInput = prompt
  if (!userInput && isPipe) {
    userInput = await Bun.stdin.text()
  }

  if (!userInput.trim()) {
    console.error('用法：')
    console.error('  bun run src/index.ts "你的问题"')
    console.error('  echo "你的问题" | bun run src/index.ts -p')
    process.exit(1)
  }

  try {
    const reply = await query([{ role: 'user', content: userInput.trim() }])
    console.log(reply)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`API 错误：${message}`)
    process.exit(1)
  }
}

main()
```

共 50 行左右的代码，是整个 `hello-agent-cli` 的雏形。

---

## 1.4 验证里程碑

配置 API Key 后运行：

```bash
# 方式一：使用 OpenAI
export OPENAI_API_KEY=sk-...
echo "用一句话解释闭包" | bun run src/index.ts -p

# 方式二：使用国内兼容服务（以通义千问为例）
export OPENAI_API_KEY=sk-...
export OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
export MODEL=qwen-max
echo "用一句话解释闭包" | bun run src/index.ts -p

# 方式三：使用 DeepSeek
export OPENAI_API_KEY=sk-...
export OPENAI_BASE_URL=https://api.deepseek.com
export MODEL=deepseek-chat
echo "用一句话解释闭包" | bun run src/index.ts -p

# 直接传参也可以
export OPENAI_API_KEY=sk-...
bun run src/index.ts "TypeScript 和 JavaScript 的核心区别是什么"
```

你应该能看到 LLM 的回复直接打印到终端。如果看到 `API 错误`，检查 API Key 是否正确、网络是否能访问对应服务。

---

## 1.5 代码解析


**`baseURL` 的灵活性**

```typescript
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
})
```

`baseURL` 不设置时默认是 `https://api.openai.com/v1`。只要把它换成任何兼容 OpenAI 格式的地址，代码完全不用改。这一行配置贯穿整本教程——以后每加一个功能，都在这套基础上扩展，不需要为不同服务商写不同的代码。

**两种输入模式**

```typescript
const isPipe = args.includes('-p') || args.includes('--pipe')
const prompt = args.filter(a => !a.startsWith('-')).join(' ')

let userInput = prompt
if (!userInput && isPipe) {
  userInput = await Bun.stdin.text()
}
```

管道模式（`-p`）从 stdin 读取，适合 `echo "..." | myagent -p` 这样的脚本用法。直接传参则读 `process.argv`。这两种模式在 Claude Code 中对应 `--pipe` 和 `--print` 标志，我们后续也会加进来。

**错误处理的分层**

```typescript
if (!process.env.OPENAI_API_KEY) {
  // 配置错误：在调用 API 之前提前拦截，给出明确提示
}

try {
  const reply = await query(...)
} catch (err) {
  // 运行时错误：网络超时、API 限流、模型不存在等
}
```

两类错误用不同方式处理：配置缺失在启动时就报错退出，而 API 调用失败则在 `catch` 里捕获。这个分层在后续会继续细化——不同类型的错误有不同的恢复策略。

---

## 1.6 Claude Code 怎么做

> [Claude Code 代码仓库](https://github.com/ricoNext/claude-code)

我们写了 50 行完成了 API 调用。Claude Code 这块的实现就复杂的多了，有 3420 行左右。这间接的反映了生产环境里 LLM API 调用的真实复杂度。

让我们看一下 Claude Code 在 调用 LLM API 外还实现了哪些功能。在后续的章节中我们也会逐步实现这些功能。

**重试系统**

Claude Code 把重试逻辑单独抽成一个模块。它处理的不是简单的"失败了再试一次"，而是有更复杂的逻辑：

- **错误分类**：哪些错误值得重试（网络超时、5xx），哪些不值得（4xx 配置错误、余额不足）
- **指数退避 + 抖动**：避免多个并发请求同时重试打垮服务器
- **最大重试次数因场景不同**：正常请求 `maxRetries: 3`，验证 API Key 的请求 `maxRetries: 2`（因为快速失败更重要）

**流式中断恢复**

Claude Code 默认走流式 API（Streaming），边生成边显示。但流式连接可能在中途断开。当流式失败时，它会自动降级到非流式请求重试：

**多 Provider 适配**

Claude Code 内部根据配置走不同的请求路径：Anthropic 直连、AWS Bedrock、Google Vertex、Azure。每条路径的认证方式、请求格式、响应处理都不同，但对上层暴露的接口完全一致。我们在后面章节中会尝试实现同样的抽象。

**Prompt Cache 控制**

Claude Code 对系统提示词做了精细的缓存控制（`CacheScope`），避免重复发送相同的上下文。这在长对话场景下能节省 40-60% 的 Token 费用。

---

**现在我们有什么，缺什么：**

| 能力 | 我们 | Claude Code |
| --- | --- | --- |
| 调用 LLM API | ✓ | ✓ |
| 错误处理 | 基础 | 分类重试 + 自动降级 |
| 流式输出 | ✗ | ✓（边生成边显示） |
| 多模型支持 | 通过 `baseURL` | 通过 Provider 抽象 |
| 重试机制 | ✗ | 指数退避 + 错误分类 |
| Token 统计 | ✗ | 完整计费追踪 |

这些"缺失"的能力我们会在后续章节逐步加入。第 3 章加流式输出，第 4 章加多轮对话，重试和 Token 统计在第 19 章（监控）里完善。

---

## 小结

本章完成了：

1. **项目初始化**：`bun init` + 安装 `openai`
2. **基础类型**：`Message`、`Role`
3. **最小 Agent**：50 行左右，支持命令行传参和管道模式，兼容任何 OpenAI 兼容服务
4. **Claude Code 对照**：理解为什么生产级 API 层是 3420 行而不是 50 行左右

现在这个工具能接受问题、得到回复——但每次只能单轮对话，没有流式输出，也没有工具调用能力。**后面的章节**：我们会逐步实现流式输出、工具调用、多轮对话、重试机制、Token 统计等功能。

```bash
# 第 2 章完成后的效果
bun run src/index.ts --version   # 输出 1.0.0，< 10ms
bun run src/index.ts --help      # 完整帮助文档
bun run src/index.ts -p "问题"   # 管道模式
```

[实战仓库](https://github.com/ricoNext/hello-agent-cli/tree/chapter-01)
