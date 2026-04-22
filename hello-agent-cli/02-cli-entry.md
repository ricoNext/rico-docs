# 02-生产级 CLI 入口的快路径设计

**Hello Agent CLI** 是一个生产级 Agent CLI 搭建的系列教程， 这个系列教程基于 [Claude Code](https://github.com/ricoNext/claude-code) 的源码，从零开始手把手教你如何搭建一个生产级可用的 Agent CLI 工具，并对比 Claude Code 的实现方式，帮助你理解 Agent CLI 工具的实现原理。

喜欢的话， 可以关注一下这个合集， 我会持续更新这个系列教程。

本节我们看**生产级 CLI 入口的快路径设计**

![](https://neptune-ipc.oss-cn-shenzhen.aliyuncs.com/img/20260421110609552.png)

第 1 节我们用 50 行写出了能跑的最小 Agent，但它还谈不上是个"工具"——没有 `--version`、没有 `--help`、参数解析全靠 `args.includes(...)` 硬编码。这一节我们把它升级成一个像样的 CLI 入口，同时学习一个生产级 CLI 在性能上必须做的事：**让 `--version`, `--help` 这种高频命令毫秒响应**。

最终结果如下：

```bash
bun run src/index.ts --version    # < 10ms，不加载任何业务模块
bun run src/index.ts --help       # 完整帮助文档
bun run src/index.ts -p "你好"    # 管道模式（沿用第 1 章）
bun run src/index.ts auth login   # 子命令骨架
```

## 2.1 为什么 CLI 入口需要"高性能"

很多人第一反应是：CLI 工具的入口能有多慢？跑一下 `--version` 不就是几毫秒的事吗？

我们先做个实验。第 1 节的 `src/index.ts` 在文件顶部就 `import OpenAI from 'openai'`，意味着每次执行 `bun run src/index.ts --version`，都会先把整个 `openai` SDK 加载进来，然后才开始判断参数。

```bash
time bun run src/index.ts --version
# 实测：~250ms（其中 200ms 是模块加载）
```

250ms 听起来不长，但有几个场景会被它拖累：

- **Shell 集成**：很多终端插件（zsh prompt、Powerlevel10k）会在每次刷新提示符时调用 `hello-agent-cli --version` 确认工具存在
- **CI 启动检查**：流水线第一步通常是 `hello-agent-cli --version` 确认依赖就位
- **包管理器探测**：`npm`、`brew` 在升级提示时也会查询版本
- **Shell 补全**：Tab 补全需要 CLI 在几毫秒内返回子命令列表

工业级 CLI 工具（git、docker、kubectl）的 `--version` 都在 10ms 以内。我们的目标是同一量级。

## 2.2 核心思路：零模块加载的快速路径

提速的关键只有一句话：**在 import 任何业务模块之前，就把 `--version` 处理掉并退出**。

把 `src/index.ts` 改成这样：

```typescript
// src/index.ts
// 注意：这个文件顶部不能有任何业务 import！

const VERSION = '0.2.0'

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  // 快速路径 1：--version / -v 直接打印退出，零业务模块加载
  if (args.length === 1 && (args[0] === '--version' || args[0] === '-v')) {
    console.log(VERSION)
    return
  }

  // 走到这里说明不是快速路径，才动态加载完整 CLI
  const { runCli } = await import('./cli.js')
  await runCli(args)
}

void main()
```

注意几个关键点：

1. **文件顶部没有 `import OpenAI from 'openai'`**：所有业务 import 都被移到 `cli.ts` 里
2. **`--version` 只用 `console.log` + 字符串常量**：没有触发任何动态 import
3. **`await import('./cli.js')` 是 ESM 动态 import**：只有走完判断、确认需要完整 CLI 时才加载

实测：

```bash
time bun run src/index.ts --version
# ~15ms（剩下的 15ms 主要是 Bun 自身启动）
```

这就是"零成本快速路径"——你为不用的功能付零代价。

## 2.3 完整 CLI 层：动态加载 Commander

接下来在 `src/cli.ts` 里实现完整的命令解析。这次我们用 `commander`，它是 Node.js 生态里最成熟的 CLI 框架。

先安装：

```bash
bun add commander
```

然后创建 `src/cli.ts`：

```typescript
// src/cli.ts
import { Command } from 'commander'
import { runQuery } from './agent/query.js'

export async function runCli(args: string[]): Promise<void> {
  const program = new Command()

  program
    .name('hello-agent-cli')
    .description('一个手把手造出来的 Agent CLI 工具')
    .version('0.2.0', '-v, --version', '显示版本号')

  // 默认命令：直接传问题
  program
    .argument('[prompt...]', '要问的问题')
    .option('-p, --pipe', '从 stdin 读取输入（管道模式）')
    .option('-m, --model <name>', '指定模型', process.env.OPENAI_MODEL ?? 'gpt-4o')
    .action(async (promptParts: string[], opts) => {
      const prompt = await resolvePrompt(promptParts, opts.pipe)
      if (!prompt) {
        program.help()
        return
      }
      await runQuery({ prompt, model: opts.model })
    })

  // 子命令骨架：auth login / auth logout（先 stub，后续章节实现）
  const auth = program.command('auth').description('管理 API 凭据')
  auth
    .command('login')
    .description('登录并保存 API Key')
    .action(() => {
      console.log('[stub] auth login 将在后续章节实现')
    })
  auth
    .command('logout')
    .description('清除已保存的 API Key')
    .action(() => {
      console.log('[stub] auth logout 将在后续章节实现')
    })

  await program.parseAsync(['node', 'hello-agent-cli', ...args])
}

async function resolvePrompt(parts: string[], isPipe?: boolean): Promise<string> {
  const direct = parts.join(' ').trim()
  if (direct) return direct
  if (isPipe) return (await Bun.stdin.text()).trim()
  return ''
}
```

把第 1 节里 `query()` 的逻辑抽到 `src/agent/query.ts`：

```typescript
// src/agent/query.ts
import OpenAI from 'openai'
import type { Message } from '../types/message.js'

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
})

export interface QueryOptions {
  prompt: string
  model: string
}

export async function runQuery(opts: QueryOptions): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    console.error('错误：请设置 OPENAI_API_KEY 环境变量')
    process.exit(1)
  }

  try {
    const response = await client.chat.completions.create({
      model: opts.model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: opts.prompt }] as Message[],
    })
    console.log(response.choices[0]?.message?.content ?? '')
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`API 错误：${message}`)
    process.exit(1)
  }
}
```

整个项目结构变成这样：

```plaintext
src/
├── index.ts           # 30 行，只负责快速路径分发
├── cli.ts             # 50 行，Commander 配置
├── agent/
│   └── query.ts       # 30 行，LLM 调用（从第 1 章迁移）
└── types/
    └── message.ts     # 沿用第 1 章
```

## 2.4 验证结果

在上一节中，我们把 `OPENAI_API_KEY` 和 `OPENAI_BASE_URL` 设置为环境变量， 在运行命令时通过 `export OPENAI_API_KEY='xxx' OPENAI_BASE_URL='xxx'` 设置。但是这种方式每次运行命令时都需要手动设置， 不是很方便。

为了方便验证， 我们可以把依赖的变量写入到全局变量文件中， 以 Mac OS zsh 为例， 在 `~/.zshrc` 文件中， 写入以下内容：

```bash
# 这里设置为通义千问的 API Key 和 Base URL, 你可以根据实际情况设置。
export OPENAI_API_KEY='sk-...'
export OPENAI_BASE_URL='https://dashscope.aliyuncs.com/compatible-mode/v1'
export OPENAI_MODEL='qwen-max'
```

然后执行 `source ~/.zshrc` 使配置生效。

下面进入验证阶段：

```bash
# 1. 快速路径：完全不加载业务模块
time bun run src/index.ts --version
# 0.2.0
# real   0m0.015s

# 2. 帮助文档
bun run src/index.ts --help
# Usage: hello-agent-cli [options] [command] [prompt...]
#
# 一个手把手造出来的 Agent CLI 工具
#
# Arguments:
#   prompt              要问的问题
#
# Options:
#   -v, --version       显示版本号
#   -p, --pipe          从 stdin 读取输入（管道模式）
#   -m, --model <name>  指定模型 (default: "gpt-4o")
#   -h, --help          display help for command
#
# Commands:
#   auth                管理 API 凭据


# 3. 沿用第 1 章的功能
echo "用一句话解释闭包" | bun run src/index.ts -p
bun run src/index.ts "TypeScript 和 JavaScript 的区别"
bun run src/index.ts -m qwen3.6-flash "写一个快排"

# 4. 子命令骨架
bun run src/index.ts auth login
# [stub] auth login 将在后续章节实现
```

如果 `--version` 的耗时还在 100ms 以上，最常见的原因是 `src/index.ts` 顶部偷偷 import 了业务模块——再检查一遍。


## 2.5 代码解析

### 动态 import vs 静态 import

```typescript
// 静态 import：解析模块时就加载（哪怕你不用）
import { runCli } from './cli.js'

// 动态 import：执行到这一行才加载
const { runCli } = await import('./cli.js')
```

这两种写法的运行效果一致，但**加载时机**完全不同。静态 import 在 ES Module 解析阶段就会把整个依赖图拉起来，动态 import 是真正的"按需加载"。

我们要把这个区别用对地方：**入口文件只用动态 import，其它文件继续用静态 import**。原因是动态 import 写起来啰嗦、编辑器跳转和类型推断也稍弱，没必要全代码库铺开。

### Commander 的 `parseAsync`

```typescript
await program.parseAsync(['node', 'hello-agent-cli', ...args])
```

为什么不直接 `program.parse()`？因为我们的 `action` 是 async 函数。`parse()` 不会等待 async action 完成，进程可能在 LLM 还没回复时就退出了。`parseAsync()` 会一直等到 action 的 Promise resolve。

第一个参数 `['node', 'hello-agent-cli', ...args]` 是模拟 `process.argv`。这样写的好处是：将来在测试里我们可以直接传 `runCli(['--version'])`，不用动 `process.argv`。

### 子命令的设计

`commander` 的子命令本质是**一棵树**：

```plaintext
hello-agent-cli
├── (default)              # 直接对话
├── auth
│   ├── login
│   └── logout
├── config (后续章节)
│   ├── get
│   └── set
└── skill (后续章节)
    └── install
```

每个子命令都是一个 `Command` 实例，可以独立配置 `--help`、`option`、`action`。这种树形结构让我们能在不破坏现有命令的前提下，持续往里加新功能。

## 2.6 Claude Code 怎么做

> [Claude Code 代码仓库](https://github.com/ricoNext/claude-code)

Claude Code 的入口文件是 `src/entrypoints/cli.tsx`，约 320 行。它的设计思路和我们这一章是同一个方向，但走得更极致。

### 不是"入口"，是"分发路由器"

打开 Claude Code 的 `cli.tsx` 你会发现，在加载真正的主程序（`src/main.tsx`，4683 行）之前，它已经处理了**十多种**特殊模式：

```typescript
// 简化后的伪代码，对应 cli.tsx 的实际结构
async function main() {
  const args = process.argv.slice(2)

  // 快速路径 1：--version（零模块加载，和我们一样）
  if (args.length === 1 && (args[0] === '--version' || args[0] === '-v')) {
    console.log(`${MACRO.VERSION} (Claude Code)`)
    return
  }

  // 快速路径 2：--dump-system-prompt（Anthropic 内部 eval 用）
  if (feature('DUMP_SYSTEM_PROMPT') && args[0] === '--dump-system-prompt') { ... }

  // 快速路径 3：claude-in-chrome MCP server
  if (process.argv[2] === '--claude-in-chrome-mcp') { ... }

  // 快速路径 4：daemon worker（supervisor 派生的子进程）
  if (feature('DAEMON') && args[0] === '--daemon-worker') { ... }

  // 快速路径 5：bridge / remote-control
  if (feature('BRIDGE_MODE') && (args[0] === 'remote-control' || ...)) { ... }

  // 快速路径 6：后台会话（claude ps / logs / attach / kill）
  if (feature('BG_SESSIONS') && (args[0] === 'ps' || ...)) { ... }

  // 快速路径 7：tmux + worktree（exec 进 tmux 后再加载）
  if (hasTmuxFlag && hasWorktreeFlag) { ... }

  // 都不是？这才加载 4683 行的 main.tsx
  const { main: cliMain } = await import('../main.jsx')
  await cliMain()
}
```

每条快速路径都遵循同一个模式：**判断 → 动态 import 该模式专属的处理函数 → 执行 → 退出**。daemon worker 不需要 React，bridge 模式不需要 REPL，dump-system-prompt 不需要工具系统——它们都只加载自己需要的那一小撮模块。

这种设计带来的好处是：每个模式都是独立优化的入口，谁的需求小谁就跑得快。

### `feature()` 与外部版本的代码消除

注意上面伪代码里大量出现的 `feature("XXX")`。这是 Bun 提供的**编译时常量**，在打包外部发布版时会被替换成 `false`，让整个 `if` 块连同后面的 `import` 一起被打包器 DCE（Dead Code Elimination）掉。

```typescript
// 源码里有 daemon、bridge、bg-sessions 等内部功能
if (feature('DAEMON') && args[0] === 'daemon') {
  await import('../daemon/main.js')
  ...
}

// 外部版打包后，feature('DAEMON') 被替换为 false，
// 整段代码被消除，连带 daemon/main.js 的依赖图都不会进 bundle
```

这是大型 CLI 工具维护"一套源码、多种发行版"的标准做法。我们在后续的章节中会讨论这种 build-time 优化。

### 性能优化彩蛋

Claude Code 的 `main.tsx` 顶部有这样几行**模块顶层的副作用调用**：

```typescript
// src/main.tsx 顶部的真实代码（节选）
startMdmRawRead()           // 立刻 spawn plutil/reg query 子进程读取 MDM 配置
startKeychainPrefetch()     // 立刻并行读取 macOS keychain（OAuth + API Key）
```

它们的作用是：**在后续 ~135ms 的模块加载期间，让操作系统把这些 I/O 操作并行做完**。等模块加载完准备用 keychain 时，结果已经在内存里了。这个技巧能省掉首屏 ~65ms。

到了 `init()` 函数里还有：

```typescript
preconnectAnthropicApi()    // 提前完成 TCP + TLS 握手到 api.anthropic.com
```

模型还没开始推理之前，连接就已经建好了。首次 API 调用能省掉 100-200ms（取决于网络延迟）。

这些都是"在你以为的入口之前，悄悄做事"的典型套路——值得我们在后续的章节中回头再看，到时候我们会用 `performance.mark()` 自己测一遍这些优化的实际收益。

### 防调试保护

```typescript
// cli.tsx 中的简化版逻辑
if (process.execArgv.some(a => a.startsWith('--inspect'))) {
  if (BUILD_TARGET === 'external') {
    process.exit(1)  // 外部版禁止调试器附加
  }
}
```

外部发布版本检测到 `--inspect` 直接退出，是为了保护混淆后的代码不被轻易反向。这个细节我们就不在自己的工具里加了，但作为产品化时的安全考虑，值得知道。

**现在我们有什么，缺什么：**

| 能力 | 我们 | Claude Code |
| --- | --- | --- |
| `--version` 快速路径 | ✓（< 15ms） | ✓（< 10ms） |
| 子命令架构 | ✓（commander） | ✓（commander + 自定义分发） |
| 动态 import | ✓（入口层） | ✓（每条快速路径） |
| Feature Flag DCE | ✗ | ✓（一套源码多种发行版） |
| 启动期并行 I/O | ✗ | ✓（keychain / MDM 预读） |
| API 预热 | ✗ | ✓（preconnect TCP+TLS） |
| 防调试保护 | ✗ | ✓（外部版检测 --inspect） |

并行 I/O 和 API 预热这些性能技巧，我们会在后续的章节中再回头加。Feature Flag 的话题留给后续的章节讨论。


## 小结

本章完成了：

1. **快速路径**：`--version` 在零业务模块加载的情况下毫秒响应
2. **入口分层**：`src/index.ts`（30 行分发）+ `src/cli.ts`（Commander 配置）+ `src/agent/query.ts`（业务逻辑）
3. **子命令骨架**：`auth login` / `auth logout` 占位，为后续章节预留扩展点
4. **Claude Code 对照**：理解了为什么生产级 CLI 入口要做成"分发路由器"，而不是一上来就加载主程序

下一章我们会把单次问答升级为**流式输出 + 多轮对话的交互式 REPL**——引入 React Ink，看 LLM 的回复一字一字蹦出来。

```bash
# 第 3 章完成后的效果
bun run src/index.ts
> 什么是闭包？
J▋avaScript 中的闭包...   ← 流式输出
> /clear
> /exit
```

[实战仓库](https://github.com/ricoNext/hello-agent-cli/tree/chapter-02)
