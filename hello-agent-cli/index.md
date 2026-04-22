# 0-从零开始打造 Agent CLI 工具

> **最终产物**：一个名为 `hello-agent-cli` 的完整 Agent CLI，约 5000 行 TypeScript 代码
>
> **参考蓝图**：Claude Code（Anthropic，51 万行生产代码）——每章附对应源码路径与设计解析

## 这本教程要做什么？

```bash
# 完成教程后，你将拥有这样一个工具：

$ hello-agent-cli "帮我给这个项目写单元测试"

◆ 分析项目结构...
  ✓ bash: find . -name "*.ts" | head -20
  ✓ read_file: src/utils/parser.ts (128 行)
  ✓ bash: bun test (2 个失败)

◆ 生成测试...
  ✓ write_file: src/utils/parser.test.ts
  ✓ bash: bun test (12/12 通过)

完成！共 6 次工具调用，耗时 43 秒，花费 $0.03

$ hello-agent-cli              # 启动交互式 REPL
╭──────────────────────────╮
│  hello-agent-cli  v1.0  claude-3 │
│  /help  /memory  /plan   │
╰──────────────────────────╯
> █
```

---

## 教程定位

本教程有两条并行主线：

**主线：动手造工具**
每章写代码，每章末有可运行的里程碑。从 50 行开始，逐步扩展到 5000 行。

**副线：参考 Claude Code**
每章附对应的 Claude Code 实现分析。Claude Code 是一个经过数百万次使用验证的生产系统，它解决了你在实现中会遇到的每一个边界问题。

| | 主线 | 副线 |
| --- | --- | --- |
| **视角** | 我们要实现 X | Claude Code 是这样实现 X 的 |
| **目的** | 动手、理解、能用 | 借鉴生产经验、理解设计决策 |
| **产物** | 可运行的 `hello-agent-cli` | 对工业级实现的判断力 |

---

## 读者准备

**需要具备**：TypeScript 基础（接口、泛型、async/await）、命令行使用经验、Anthropic 或 OpenAI API Key

**安装环境**：

```bash
curl -fsSL https://bun.sh/install | bash  # 安装 Bun >= 1.2.0
mkdir hello-agent-cli && cd hello-agent-cli
bun init -y
bun add @anthropic-ai/sdk ink react commander lodash-es
bun add -d typescript @types/react @types/node
```

---

## 教程结构（共 25 章）

```plaintext
第 0 部分：准备         (序章)       → 教程定位 + 环境
第 1 部分：核心骨架     (第 1-5 章)  → 可运行的基础 Agent
第 2 部分：工具系统     (第 6-12 章) → 30+ 生产级工具
第 3 部分：高级特性     (第 13-17 章)→ 记忆、权限、压缩
第 4 部分：工程化       (第 18-21 章)→ 测试、监控、配置、打包
第 5 部分：扩展生态     (第 22-24 章)→ 插件、编排、多云
第 6 部分：综合实战     (第 25 章)   → 完整项目
```

---

## 第零部分：准备

### 第 0 章：开始之前

**0.1 这本教程适合谁**

适合：正在用 Claude Code/Cursor 并想理解底层实现的开发者、想造自己的 AI 编码工具的技术创业者、需要定制内部开发工具的企业团队。

不适合：只想开箱即用（直接用 Claude Code）、没有 TypeScript 基础、只需要代码补全功能。

**0.2 为什么用 Claude Code 作为蓝图**

Claude Code 是目前工程质量最高的 Agent CLI 实现之一。它解决了你在实现中必然会遇到的问题：

- 如何处理 LLM API 的不稳定性（重试、降级）
- 如何在上下文窗口有限时维持长对话
- 如何设计权限系统防止 Agent 做破坏性操作
- 如何让工具调用在终端中优雅渲染

我们不照抄它，而是把它当成一份经过验证的参考答案。

**0.3 项目结构约定**

```plaintext
hello-agent-cli/
├── src/
│   ├── index.ts              # CLI 入口
│   ├── agent/
│   │   ├── loop.ts           # Agentic Loop
│   │   ├── engine.ts         # 会话引擎（QueryEngine）
│   │   └── context.ts        # 上下文构建
│   ├── tools/
│   │   ├── registry.ts       # 工具注册表
│   │   ├── executor.ts       # 工具执行器
│   │   └── [ToolName]/       # 每个工具独立目录
│   ├── ui/
│   │   ├── REPL.tsx          # 主界面
│   │   └── components/       # UI 组件
│   ├── memory/               # 记忆系统
│   ├── permissions/          # 权限系统
│   ├── hooks/                # Hook 系统
│   └── config/               # 配置管理
├── tests/
├── hello-agent-cli.md                # 项目配置文件
└── package.json
```

**0.4 每章约定**

每章包含：

- **本章造什么**：一句话说明本章产出
- **里程碑**：可 `bun run` 验证的命令
- **实现要点**：核心代码思路（含代码片段）
- **Claude Code 怎么做**：对应源码路径、行数、关键设计决策
- **代码仓库**：本章的代码仓库地址，可以直接 `git clone` 下来运行。 仓库地址： https://github.com/ricoNext/hello-agent-cli， 每章的代码按照分支存放在仓库中， 分支名称为 `chapter-xxx`。

---

## 第一部分：核心骨架

### 第 1 章：50 行的最小 Agent

**本章造什么**：一个能接受问题、调用 LLM、打印回复的最小程序——不是玩具，是后续所有功能的地基。

**里程碑**：

```bash
echo "用一句话解释闭包" | bun run src/index.ts -p
# 输出：闭包是函数访问其词法作用域中变量的能力。
```

**实现要点**：

- openai SDK 最简调用（`messages.create`）
- 管道模式（stdin → API → stdout）：不需要 UI，适合脚本
- 错误处理：API Key 缺失、网络超时的友好提示
- 类型定义：`Message`、`Role`、`ApiConfig`

```typescript
// src/index.ts 核心结构
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function query(prompt: string): Promise<string> {
  const response = await client.messages.create({
    model: "gpt-4o-mini",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });
  return response.content[0].type === "text" ? response.content[0].text : "";
}
```

**Claude Code 怎么做**：

- 文件：`src/services/api/claude.ts`（3,420 行）
- 关键设计：Claude Code 的 API 调用封装了重试（`withRetry`）、流式事件解析、多 Provider 适配、prompt cache 控制等
- 设计决策：为什么把 API 调用独立成一个 3420 行的文件？因为生产环境的 LLM API 调用远比 `messages.create` 复杂——有速率限制、模型降级、账单追踪、流式中断恢复等

**实战代码**：约 50 行

---

### 第 2 章：高性能 CLI 入口

**本章造什么**：一个生产级 CLI 入口——`--version` 毫秒响应、动态加载、参数解析、子命令架构。

**里程碑**：

```bash
bun run src/index.ts --version    # < 10ms，不加载任何模块
bun run src/index.ts --help       # 完整帮助
bun run src/index.ts -p "问题"    # 管道模式
bun run src/index.ts auth login   # 子命令（stub）
```

**实现要点**：

- **零成本快速路径**：`--version` 在任何 import 之前处理并退出
- **动态 import 策略**：把 Commander.js、Ink 等大模块推迟到真正需要时加载
- **全局注入**：在进程最早期注入 VERSION、CONFIG 等全局常量
- **并行初始化**：在模块加载期间并行触发配置读取（I/O overlap）

```typescript
// src/index.ts 核心结构
(globalThis as any).VERSION = "1.0.0";

async function main() {
  const args = process.argv.slice(2);

  // 快速路径：零模块加载
  if (args[0] === "--version" || args[0] === "-v") {
    console.log((globalThis as any).VERSION);
    return;
  }

  // 并行触发配置读取（与后续模块加载并行）
  const configPromise = loadConfig();

  // 延迟加载完整 CLI
  const { runCli } = await import("./cli.js");
  const config = await configPromise;
  await runCli({ args, config });
}
```

**Claude Code 怎么做**：

- 文件：`src/entrypoints/cli.tsx`（320 行）
- 关键设计：`cli.tsx` 是一个**分发路由器**，在加载 4683 行的 `main.tsx` 之前，已处理十余种内部模式（daemon、bridge、bg sessions、worktree 等）
- 关键优化 1：`startKeychainPrefetch()` 在模块加载的第一行就触发，与后续 135ms 模块加载并行，节省 ~65ms
- 关键优化 2：`preconnectAnthropicApi()` 在初始化时预热 TCP+TLS 连接，节省首次 API 调用 100-200ms
- 防调试保护：检测 `--inspect` 参数，外部构建版本遇到调试器直接 `process.exit(1)`

**实战代码**：约 120 行

---

### 第 3 章：流式输出与交互式 REPL

**本章造什么**：把"打印一次退出"升级为"流式输出 + 多轮对话的交互终端"。

**里程碑**：

```bash
bun run src/index.ts
> 什么是闭包？
J▋avaScript 中的闭包...   ← 逐字流式输出
[完成，127 tokens，2.1s]
> /exit
```

**实现要点**：

- **SSE 流式处理**：逐个处理 `text_delta`、`message_stop` 事件
- **React Ink 核心概念**：`<Box>`（布局）、`<Text>`（文字）、`useInput()`（键盘）、`useStdout()`
- **Ink 工作原理**：自定义 React Reconciler，把虚拟 DOM 映射到 ANSI 转义码而非浏览器 DOM
- **消息列表组件**：用 `useState` 维护 `messages[]`，流式追加到最后一条
- **基础斜杠命令**：`/exit`、`/clear`、`/help`

```tsx
// src/ui/REPL.tsx 核心结构
import { Box, Text, useInput } from "ink";

function REPL() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);

  useInput((inputChar, key) => {
    if (key.return && input.trim()) {
      handleSubmit(input);
      setInput("");
    }
  });

  return (
    <Box flexDirection="column">
      <MessageList messages={messages} />
      <InputBox value={input} onChange={setInput} disabled={streaming} />
    </Box>
  );
}
```

**Claude Code 怎么做**：

- 文件：`src/screens/REPL.tsx`（5,009 行）
- 关键设计：Claude Code 的 REPL 使用 React Compiler（`_c()` 缓存）优化重渲染，消息列表用虚拟滚动处理超长历史
- 交互模式：三种——对话模式（REPL）、管道模式（`-p`）、非交互模式（SDK 调用）
- 性能：避免 `console.log`（会打破 Ink 的渲染层），所有输出必须通过 React 组件

**实战代码**：约 300 行

---

### 第 4 章：Agentic Loop——让 Agent 真正"干活"

**本章造什么**：实现真正的 Agentic Loop——LLM 循环调用工具，直到任务完成。这是整个 Agent 系统最核心的一章。

**里程碑**：

```bash
bun run src/index.ts -p "当前目录有多少个 .ts 文件？"
# Agent 自动调用 bash("find . -name '*.ts' | wc -l") 并回复
42 个 TypeScript 文件。
```

**实现要点**：

```typescript
// src/agent/loop.ts 核心逻辑
async function* agenticLoop(
  messages: Message[],
  tools: Tool[]
): AsyncGenerator<StreamEvent> {
  while (true) {
    const stream = await callLLM(messages, tools);

    for await (const event of stream) {
      yield event; // 把流式事件传给 UI 层渲染

      if (event.type === "message_stop") {
        const lastMessage = extractAssistantMessage(stream);

        // 没有工具调用 → 任务完成
        if (lastMessage.stop_reason === "end_turn") return;

        // 有工具调用 → 执行并继续
        if (lastMessage.stop_reason === "tool_use") {
          const toolResults = await executeTools(lastMessage.content, tools);
          messages.push(assistantMessage(lastMessage.content));
          messages.push(userMessage(toolResults));
        }
      }
    }
  }
}
```

- **并行工具调用**：`Promise.all(toolCalls.map(executeOne))`，多个工具同时执行
- **错误恢复**：工具执行失败时，把错误信息作为 `tool_result` 注入，让 LLM 自行决策
- **最大轮次**：`--max-turns` 参数防止无限循环
- **会话状态管理**：`QueryEngine` 模式——把 loop 和状态分离

**Claude Code 怎么做**：

- 文件：`src/query.ts`（1,732 行）+ `src/QueryEngine.ts`（1,320 行）
- 关键设计：`query.ts` 是纯函数式的流处理，`QueryEngine.ts` 是有状态的会话封装；前者处理单轮，后者处理多轮
- 五步流水线：用户输入 → 上下文构建 → LLM 推理 → 工具调用 → 结果处理 → 回到步骤 1
- 关键细节：并行工具调用（`Promise.all`）但按顺序注入结果（保证 `tool_use_id` 对应）
- 会话恢复：`/resume` 命令通过 `recordTranscript` 持久化会话，`loadConversationForResume` 恢复

**实战代码**：约 500 行（含 QueryEngine 封装）

---

### 第 5 章：上下文构建——让 Agent 了解它在哪

**本章造什么**：每次对话前，自动收集环境信息（Git 状态、项目配置），注入系统提示词，让 Agent 无需用户重复解释项目背景。

**里程碑**：

```bash
cd ~/my-project && bun run src/index.ts -p "我们现在在哪个分支？最近有什么改动？"
# 直接回答（从注入的上下文读取，不调用工具）
当前分支：feature/login，最近 3 次提交：fix auth error, add OAuth, update deps
```

**实现要点**：

```typescript
// src/agent/context.ts 核心结构
export async function buildContext(): Promise<SystemContext> {
  // 并行执行所有上下文收集
  const [gitStatus, claudeMd, date] = await Promise.all([
    getGitStatus(),
    loadhello-agent-cliMd(),
    getCurrentDate(),
  ]);

  return { gitStatus, claudeMd, date };
}

// getGitStatus：并行运行多个 git 命令
async function getGitStatus(): Promise<string | null> {
  if (!(await isGitRepo())) return null;

  const [branch, mainBranch, status, log] = await Promise.all([
    exec("git branch --show-current"),
    exec("git symbolic-ref refs/remotes/origin/HEAD"),
    exec("git status --short"),
    exec("git log --oneline -n 5"),
  ]);

  return formatGitContext({ branch, mainBranch, status, log });
}
```

- **`hello-agent-cli.md` 文件**：从当前目录向上查找（类似 `.gitignore`）
- **Token 预算**：git status 超过 2000 字符时截断（防止挤压对话 Token）
- **Memoize 缓存**：同一会话内，`getGitStatus` 只运行一次（`lodash.memoize`）
- **条件注入**：无 Git 仓库时跳过 git 信息

**Claude Code 怎么做**：

- 文件：`src/context.ts`（189 行，是整个系统最精简的核心文件之一）
- 关键设计：`getSystemContext`（git 状态，每会话缓存）和 `getUserContext`（CLAUDE.md，每会话缓存）两个 memoized 函数
- 真实代码：`MAX_STATUS_CHARS = 2000`，超过就截断并提示"如需更多信息，请用 BashTool 运行 git status"
- `CLAUDE.md` 加载：从 `getAdditionalDirectoriesForClaudeMd()` 配置的目录层级向上查找，支持层级继承

**实战代码**：约 200 行

---

## 第二部分：工具系统

### 第 6 章：工具框架——让 LLM 能调用函数

**本章造什么**：定义 `Tool` 接口、工具注册表、工具执行器——后续所有工具的基础设施。

**里程碑**：

```bash
# 添加一个测试工具后：
bun run src/index.ts -p "把字符串 hello 转为大写"
# LLM 调用 transform_string 工具，返回 HELLO
```

**实现要点**：

```typescript
// src/tools/registry.ts
export interface Tool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  isEnabled(): boolean;
  execute(input: unknown): Promise<ToolResult>;
}

export interface ToolResult {
  content: string | ContentBlock[];
  isError?: boolean;
}

// 工具注册表：按名称查找、按条件过滤
export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  getEnabledTools(): Tool[] {
    return [...this.tools.values()].filter((t) => t.isEnabled());
  }

  find(name: string): Tool | undefined {
    return this.tools.get(name);
  }
}
```

- **工具分类**：核心工具（总是启用）、条件工具（按环境/配置启用）
- **JSON Schema 验证**：工具接收 LLM 传来的参数，需要在执行前验证
- **执行流程**：查找 → 验证参数 → 权限检查 → 执行 → 后处理
- **工具调用日志**：记录每次调用的入参、出参、耗时

**Claude Code 怎么做**：

- 文件：`src/Tool.ts`（接口定义）+ `src/tools.ts`（389 行，注册逻辑）
- 工具数量：56 个工具目录，约 20 个核心工具总是加载，其余按 Feature Flag 或环境变量条件加载
- 关键设计：`getAllBaseTools()` 是真相来源，必须与服务器端 system prompt cache policy 保持一致（注释写明）
- `assembleToolPool()`：合并内置工具和 MCP 工具时，内置工具排序放前，保证 prompt cache 稳定性

**实战代码**：约 200 行

---

### 第 7 章：文件操作工具——读、写、编辑

**本章造什么**：三个最核心的工具——读文件、写文件、精确编辑文件。这三个工具支撑了 80% 的编码任务。

**里程碑**：

```bash
bun run src/index.ts "修改 README.md，把所有 TODO 改为 DONE，告诉我改了几处"
```

**实现要点**：

- **`read_file`**：编码自动检测（`chardet`）、大文件分块（每块 8000 token 以内）、Notebook 格式特殊处理
- **`write_file`**：原子写入（先写 `.tmp` 再 `rename`，防止写失败导致文件损坏）、备份机制
- **`edit_file`（精华）**：Search-Replace 模式而非 Diff Patch

```typescript
// edit_file 的核心设计：必须精确匹配才能写入
async function editFile(params: { path: string; old_str: string; new_str: string }) {
  const content = await fs.readFile(params.path, "utf-8");

  // 严格匹配：old_str 必须精确存在
  if (!content.includes(params.old_str)) {
    throw new Error(
      `找不到要替换的内容。请确保 old_str 与文件内容完全一致（包括空格和换行）`
    );
  }

  const newContent = content.replace(params.old_str, params.new_str);
  await fs.writeFile(params.path, newContent);
  return generateDiff(content, newContent);
}
```

- **Diff 渲染**：在 REPL 中用红/绿颜色显示修改前后的内容
- **NotebookEditTool**：`.ipynb` 是 JSON，单元格级别编辑而非整文件覆写

**Claude Code 怎么做**：

- `src/tools/FileReadTool/`：支持文本、PDF（`pdfjs-dist`）、图片（base64）、Notebook 四种类型
- `src/tools/FileEditTool/`：Search-Replace 模式有一个细节——如果找到多个匹配，报错提示用户提供更多上下文（防止误改错误位置）
- 关键设计：Claude Code 的 FileEdit 不支持正则，只做字符串精确匹配，原因是让 LLM 意识到它需要提供完整的原始内容，而不是模糊描述

**实战代码**：约 500 行（含 Notebook 支持）

---

### 第 8 章：Shell 执行与代码搜索

**本章造什么**：让 Agent 能执行 Shell 命令、搜索代码库。这两个能力让 Agent 从文件编辑器升级为真正的开发者助手。

**里程碑**：

```bash
bun run src/index.ts "运行测试，找出失败原因，给我一份摘要"
```

**实现要点**：

- **`bash` 工具**（核心）：

```typescript
async function executeBash(params: { command: string; timeout?: number }) {
  const { stdout, stderr, exitCode } = await execa("bash", ["-c", params.command], {
    timeout: params.timeout ?? 120_000,
    env: { ...process.env, TERM: "dumb" }, // 关闭颜色输出
  });

  return {
    stdout: truncate(stdout, MAX_OUTPUT_CHARS),
    stderr: truncate(stderr, MAX_OUTPUT_CHARS),
    exitCode,
  };
}
```

- 流式输出：命令执行时实时把 stdout 流到 REPL（用 `spawn` 而非 `exec`）
- 超时：默认 120 秒，`--timeout` 可配置
- **`glob` 工具**：调用 `fast-glob`，自动读取 `.gitignore` 排除规则
- **`grep` 工具**：调用系统 `rg`（ripgrep）而非 JS 实现，大型代码库性能提升 10x+

**Claude Code 怎么做**：

- `src/tools/BashTool/`：Claude Code 的 Bash 工具会跟踪"当前工作目录"——`cd` 命令会更新内部状态，让下一次 bash 调用从正确目录开始（用 `setCwd()` 实现）
- `src/tools/GrepTool/`：Claude Code 内部构建（Ant 版本）嵌入了 `bfs/ugrep`，外部版使用系统 ripgrep；当两者都不可用时降级为 JS 实现
- 关键设计：为什么不用 Node.js `exec` 而用 `spawn`？因为 `exec` 有 buffer 限制（200MB），`spawn` 是流式的

**实战代码**：约 400 行

---

### 第 9 章：网络与交互工具

**本章造什么**：让 Agent 能上网查资料、控制浏览器，以及在需要时向用户提问。

**里程碑**：

```bash
bun run src/index.ts "搜索 Bun 1.2 的 breaking changes，然后问我是否要更新"
```

**实现要点**：

| 工具 | 实现方式 | 关键点 |
| --- | --- | --- |
| `web_fetch` | HTTP + `@mozilla/readability` | HTML → Markdown 正文提取，去除导航栏/广告 |
| `web_search` | Brave Search API / Serper | 结构化结果，返回 title + snippet + url |
| `ask_user` | Ink 渲染问题 + 等待输入 | 阻塞 Agentic Loop，直到用户回答 |

- **WebBrowserTool vs WebFetchTool**：前者是完整的浏览器自动化（Chrome CDP），后者是简单 HTTP；两者设计给 LLM 的 description 要明确区分

**Claude Code 怎么做**：

- `src/tools/WebFetchTool/`：内部有 AI 摘要生成——当页面太长时，用 LLM 先摘要再返回，防止占用大量上下文
- `src/tools/WebBrowserTool/`：通过 Feature Flag `WEB_BROWSER_TOOL` 控制，外部版不可用（是 Anthropic 内部功能）
- `src/tools/AskUserQuestionTool/`：支持多问题批量提问（一次渲染多个输入框），减少打断次数

**实战代码**：约 300 行

---

### 第 10 章：生产力工具——计划、待办、工作区隔离

**本章造什么**：三个让 Agent 更"专业"的工具：任务追踪、计划模式、Git Worktree 隔离。

**里程碑**：

```bash
bun run src/index.ts "把认证系统从 JWT 重构为 Session Cookie，先给我看计划"
# Agent 进入计划模式，列步骤，等待确认后才执行
```

**实现要点**：

- **`todo_write`**：结构化任务列表，状态流转 `pending → in_progress → completed`

```typescript
// REPL 顶部状态栏实时显示任务进度
function StatusBar({ todos }: { todos: Todo[] }) {
  const done = todos.filter((t) => t.status === "completed").length;
  return <Text>步骤 {done}/{todos.length}</Text>;
}
```

- **Plan Mode**：`enter_plan_mode` 进入后，工具系统切换为"只读"——只允许 `read_file`、`bash`（只读命令）、`glob`、`grep`，禁止 `write_file`、`edit_file`、危险 bash 命令
- **Git Worktree**：`enter_worktree` 创建新的 worktree 目录，后续所有操作在隔离目录进行；`exit_worktree` 合并或丢弃

**Claude Code 怎么做**：

- `src/tools/TodoWriteTool/`：最高频调用的工具之一，状态存储在 `AppState` 的 `tasks` 字段
- `src/tools/EnterPlanModeTool/`：进入后改变 `permissionMode`，工具执行器在 pre-hook 阶段拒绝写操作
- `src/tools/EnterWorktreeTool/`：封装 `git worktree add`，创建 tmux 会话与 worktree 绑定

**实战代码**：约 400 行

---

### 第 11 章：子代理系统——并行处理复杂任务

**本章造什么**：让 Agent 能派生子 Agent 并行处理独立子任务，主 Agent 汇总结果。

**里程碑**：

```bash
bun run src/index.ts "为 src/utils/ 下的每个文件分别生成测试，并行处理"
# 派生多个子代理，并行生成，主代理汇总
```

**实现要点**：

```typescript
// src/tools/AgentTool/index.ts 核心逻辑
async function spawnAgent(params: {
  task: string;
  context?: string;
  tools?: string[]; // 子代理可用的工具白名单
}) {
  // 子代理有独立的 messages、tools、权限上下文
  const subEngine = new QueryEngine({
    systemPrompt: buildSubAgentPrompt(params.task, params.context),
    tools: filterToolsForSubAgent(params.tools),
    maxTurns: 20,
  });

  // 执行并返回结果
  const result = await subEngine.run();
  return { output: result.lastMessage, toolCallCount: result.turns };
}
```

- **Fork 模式**：继承父 Agent 的上下文和工具
- **Async 模式**：后台运行，不阻塞父 Agent
- **内置 Agent**：`explore`（快速代码库探索）、`plan`（规划方案）、`verify`（验证结果）

**Claude Code 怎么做**：

- `src/tools/AgentTool/`：支持 Fork / Async / Background / Remote 四种模式
- `src/coordinator/coordinatorMode.ts`：Coordinator 模式——一个主 Agent 专门负责分配任务，多个 Worker Agent 并行执行
- 关键设计：子代理的工具列表是主代理工具列表的**子集**，通过 `ALL_AGENT_DISALLOWED_TOOLS` 常量控制哪些工具不能被子代理使用

**实战代码**：约 500 行

---

### 第 12 章：MCP 协议——接入外部工具生态

**本章造什么**：实现 MCP 客户端，让你的 Agent 一行配置接入任意 MCP Server（GitHub、数据库、Slack……）。

**里程碑**：

```json
// hello-agent-cli.json
{
  "mcpServers": {
    "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] }
  }
}
```

```bash
bun run src/index.ts "列出这个仓库最新的 5 个 PR"
# 通过 MCP 调用 GitHub 工具完成
```

**实现要点**：

- **MCP 协议**：JSON-RPC 2.0 over stdio（或 SSE）
- **Server 生命周期**：`spawn 子进程` → `初始化握手` → `工具列表获取` → `动态注册到 ToolRegistry`
- **Resources 协议**：除了工具，MCP 还支持"资源"（文件、数据库表等静态上下文）
- **认证**：`McpAuthTool` 处理需要 OAuth 的 MCP Server

```typescript
// src/tools/mcp/client.ts 核心
class McpClient {
  async connect(serverConfig: McpServerConfig) {
    const process = spawn(serverConfig.command, serverConfig.args);
    const transport = new StdioTransport(process);

    await transport.initialize();
    const { tools } = await transport.listTools();

    // 把 MCP 工具注册到本地工具系统
    for (const tool of tools) {
      this.registry.register(new McpToolAdapter(tool, transport));
    }
  }
}
```

**Claude Code 怎么做**：

- `src/services/mcp/`（12,242 行）：最大的模块，包含 stdio/SSE/XAA 三种传输协议
- 关键设计：MCP 工具的名称格式为 `mcp__<serverName>__<toolName>`，与内置工具区分，且 deny 规则支持 `mcp__server` 前缀批量屏蔽整个 Server
- prompt cache 策略：`assembleToolPool()` 把内置工具排前（稳定），MCP 工具排后（变化），保证 prompt cache 命中率

**实战代码**：约 500 行

---

## 第三部分：高级特性

### 第 13 章：记忆系统——让 Agent 记住重要信息

**本章造什么**：让 Agent 跨会话记住项目知识（"这个项目用 pnpm"），不用每次都重新告诉它。

**里程碑**：

```bash
# 会话 1
hello-agent-cli > 记住：我们用 pnpm，测试命令是 bun test
# 会话 2（重启后）
hello-agent-cli > 怎么运行测试？
# 直接回答：bun test（从记忆读取）
```

**实现要点**：

- **两层记忆架构**：

```plaintext
层 1：项目记忆（hello-agent-cli.md）
  - 用户手动编辑 / Agent 追加
  - 格式：Markdown，Agent 可直接读写
  - 位置：项目根目录（git 版本控制）

层 2：自动记忆（~/.hello-agent-cli/memory/<project-hash>.md）
  - 会话结束时，用 LLM 提取关键信息
  - 格式：结构化条目
  - 位置：全局，不进 git
```

- **记忆提取时机**：`SessionStop` Hook 触发后，用子 Agent 总结会话
- **提取过滤**：5 重门禁——信息够新？够有价值？非隐私？非临时？跨会话有用？
- **记忆召回**：新会话开始时，读取相关记忆文件，注入系统提示词（Token 预算控制，最多 5 个文件）

**Claude Code 怎么做**：

- `src/memdir/`：记忆目录系统，`findRelevantMemories()` 做相关性排序
- `src/services/extractMemories/`：用专门的子 Agent 做记忆提取
- `src/services/autoDream/`：`autoDream` 功能——定期对记忆做"巩固"（类似人类睡眠时的记忆整理）
- 关键设计：记忆文件按项目 hash 分隔，`teamMemPaths.ts` 处理多代理团队共享记忆

**实战代码**：约 600 行

---

### 第 14 章：权限系统——在自主性与安全性之间取得平衡

**本章造什么**：在 Agent 执行高危操作前拦截并请求确认，同时不让权限弹窗影响正常使用体验。

**里程碑**：

```bash
hello-agent-cli --permission-mode auto "清理 dist 目录并重新构建"
# 危险操作（rm -rf）需要确认，安全操作（ls、read）自动放行
```

**实现要点**：

- **三种权限模式**：

| 模式 | 行为 | 适用场景 |
| --- | --- | --- |
| `manual` | 每次工具调用都询问 | 默认，探索未知项目 |
| `auto` | YOLO 分类器自动判断 | 熟悉项目，提高效率 |
| `bypass` | 跳过所有检查 | CI/沙箱环境 |

- **YOLO 分类器**（Auto 模式核心）：

```typescript
function classifyOperation(tool: string, input: unknown): "safe" | "dangerous" {
  // 文件读取、搜索、git 状态查询 → 安全
  if (["read_file", "glob", "grep", "web_fetch"].includes(tool)) return "safe";

  // 文件删除、系统目录写入、sudo → 危险
  if (tool === "bash") {
    const cmd = (input as any).command as string;
    if (/rm\s+-rf|sudo|>/i.test(cmd)) return "dangerous";
    if (/^(ls|cat|git\s+status|git\s+log)/i.test(cmd)) return "safe";
  }

  return "dangerous"; // 默认：不确定的都需要确认
}
```

- **路径验证**：写操作只允许在项目目录内，防止写入 `~/.ssh/` 等敏感路径
- **规则系统**：在 `hello-agent-cli.md` 中配置白名单/黑名单

**Claude Code 怎么做**：

- `src/hooks/toolPermission/`：权限检查是 Hook 系统的一部分，在 `PreToolUse` 阶段执行
- YOLO 分类器：基于规则匹配，不用 LLM（LLM 太慢且结果不一致）
- 关键设计：`policyLimits`——企业版通过远程配置强制某些权限规则，用户无法在本地覆盖

**实战代码**：约 700 行

---

### 第 15 章：安全沙箱——纵深防御

**本章造什么**：在操作系统级别限制 Agent 的能力，防止最坏情况下的破坏。

**里程碑**：

```bash
# 沙箱模式下，Agent 无法访问项目目录之外的文件
hello-agent-cli --sandbox "删除 /etc/hosts"
# 操作系统级别拒绝（不是权限系统拦截）
```

**实现要点**：

- **四层纵深防御**：

```plaintext
层 1：OS 原生沙箱
  macOS → sandbox-exec（Seatbelt）
  Linux → bubblewrap（命名空间隔离）

层 2：权限系统（第 14 章）
  路径白名单、YOLO 分类器

层 3：资源限制
  CPU 时间、内存上限、磁盘配额

层 4：审计日志
  记录所有工具调用，方便事后审查
```

- **文件系统隔离**：只读（系统目录）、读写（项目目录）、禁止（`~/.ssh`、`/etc`）
- **网络隔离**：域名白名单（允许 API 调用，禁止内网访问）
- **Git Worktree 作为轻量级隔离**：不需要 OS 沙箱也能限制操作范围

**Claude Code 怎么做**：

- `src/utils/sandbox/`：`SandboxManager` 统一管理沙箱状态
- 关键设计：沙箱是**可选的**，通过 `--dangerously-skip-permissions` 可以完全绕过；Anthropic 的官方建议是在 CI 或容器环境中启用沙箱，本地开发不一定需要

**实战代码**：约 600 行（含 OS 沙箱，可选实现）

---

### 第 16 章：上下文压缩——让长任务不崩溃

**本章造什么**：当对话历史太长（超过 Token 限制）时，自动压缩旧消息，让 Agent 能持续处理数小时的长任务。

**里程碑**：

```bash
# 长时间对话，右上角显示：
[Context: 87% ████████░░]
# 达到 95% 自动压缩：
◆ 压缩历史消息...（保留关键信息）
[Context: 23% ██░░░░░░░░]
```

**实现要点**：

```typescript
// src/agent/compact.ts
async function autoCompact(messages: Message[], threshold = 0.95): Promise<Message[]> {
  const usage = estimateTokens(messages);
  if (usage / MAX_CONTEXT < threshold) return messages; // 未触发

  // 用 LLM 压缩旧消息为摘要
  const summary = await summarize(messages.slice(0, -KEEP_RECENT_N));

  return [
    systemMessage(`[对话历史摘要]\n${summary}`),
    ...messages.slice(-KEEP_RECENT_N), // 保留最近 N 条
  ];
}
```

- **三种压缩策略**：Auto-compact（阈值触发）、Micro-compact（每轮增量摘要）、手动 `/compact`
- **压缩边界**：最近 10 条消息不压缩，保证连贯性
- **Token 计数**：调用 Anthropic 的 `countTokens` API，或用 `gpt-3-encoder` 近似

**Claude Code 怎么做**：

- `src/services/compact/autoCompact.ts`：`calculateTokenWarningState()` 计算警告级别（75%/90%/95%）
- `src/services/compact/compact.ts`：`buildPostCompactMessages()` 构建压缩后的消息列表
- 关键设计：压缩本身也消耗 Token（用 LLM 做摘要），所以要确保压缩后节省的 Token 远大于压缩消耗的

**实战代码**：约 300 行

---

### 第 17 章：Hook 系统——让工具调用可拦截、可扩展

**本章造什么**：在工具调用前后插入自定义逻辑（审计、自动 git add、记忆提取），让工具行为可配置。

**里程碑**：

```json
// hello-agent-cli.json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "write_file",
      "command": "git add \"$hello-agent-cli_TOOL_INPUT_PATH\""
    }]
  }
}
```

```bash
hello-agent-cli "修复 parser.ts 中的 bug"
git status  # 文件已自动 git add
```

**实现要点**：

- **三种触发点**：

```typescript
type HookEvent =
  | "PreToolUse"   // 工具调用前：可修改输入、中止调用
  | "PostToolUse"  // 工具调用后：可修改输出、触发副作用
  | "SessionStop"  // 会话结束：触发记忆提取、生成会话摘要
```

- **Hook 类型**：Shell 命令（最灵活）、内置函数（最高效）
- **`PreToolUse` 特权**：可以返回 `{ action: "block", reason: "..." }` 中止工具调用

**Claude Code 怎么做**：

- `src/hooks/`：Hook 系统是权限系统和记忆系统的底层支撑
- 内置 Hooks：记忆提取（`SessionStop`）、权限检查（`PreToolUse`）、性能追踪（所有阶段）
- 关键设计：用户自定义 Hook 通过 Shell 命令实现，而非插件代码，原因是安全性——Shell 命令的能力边界清晰

**实战代码**：约 300 行

---

## 第四部分：工程化

### 第 18 章：测试策略——让代码可信

**本章造什么**：完整的测试套件：工具单元测试、Agentic Loop 集成测试、端到端测试。

**里程碑**：

```bash
bun test
✓ Tool Registry (5)
✓ Agentic Loop - tool calling (8)
✓ File Tools - read/write/edit (12)
✓ Permission System (6)
31 passed, coverage: 74%
```

**实现要点**：

- **Mock LLM**：不调用真实 API，用预录制的响应（VCR 模式）
- **工具单元测试**：直接调用 `tool.execute()`，不经过 LLM 层
- **集成测试**：Mock API + 真实工具，测试完整工具调用链
- **快照测试**：对 Ink 组件做 `renderToString` 快照

```typescript
// 工具单元测试示例
test("edit_file 精确匹配", async () => {
  await fs.writeFile("/tmp/test.ts", "hello world");
  const result = await editFileTool.execute({
    path: "/tmp/test.ts",
    old_str: "hello",
    new_str: "hi",
  });
  expect(result.isError).toBe(false);
  expect(await fs.readFile("/tmp/test.ts", "utf-8")).toBe("hi world");
});
```

**Claude Code 怎么做**：

- `src/tools/testing/TestingPermissionTool.ts`：只在 `NODE_ENV=test` 时加载的测试专用工具
- `src/services/vcr.ts`：VCR（Video Cassette Recorder）模式，录制 API 响应供测试回放

**实战代码**：约 500 行测试代码

---

### 第 19 章：监控与可观测性

**本章造什么**：结构化日志、启动性能分析、错误追踪——让 Agent 的行为可观测、问题可定位。

**里程碑**：

```bash
# 开启详细启动分析
hello-agent-cli_PROFILE_STARTUP=1 hello-agent-cli "hello"
cat ~/.hello-agent-cli/startup-perf/latest.txt
# init_time: 234ms, import_time: 89ms, total: 1243ms
```

**实现要点**：

- **结构化日志**：每次会话生成 `~/.hello-agent-cli/logs/<session-id>.jsonl`，记录所有工具调用
- **启动性能分析**：参照 Claude Code 的 `profileCheckpoint` 系统，在关键路径插入时间戳
- **Token 消耗追踪**：每条消息记录 input/output token 数和费用
- **错误日志**：区分"用户错误"（可恢复）和"系统错误"（需上报）

**Claude Code 怎么做**：

- `src/utils/startupProfiler.ts`：`profileCheckpoint()` 基于 `performance.mark()`，采样率 100%（内部）/ 0.5%（外部），最终上报到 Statsig
- 阶段定义：`import_time`（模块加载）、`init_time`（初始化）、`settings_time`（配置加载）、`total_time`（整体）
- 关键设计：性能分析本身有成本，所以用采样率控制

**实战代码**：约 200 行

---

### 第 20 章：配置管理——多层优先级系统

**本章造什么**：一套从全局配置到项目配置到环境变量的完整配置体系，优先级清晰，支持团队部署。

**里程碑**：

```bash
hello-agent-cli config set model claude-3-5-sonnet
hello-agent-cli "你用什么模型？"  # 自动使用新配置
```

**实现要点**：

```plaintext
配置优先级（由低到高）：
  1. 内置默认值
  2. 全局配置（~/.hello-agent-cli/config.json）
  3. 项目配置（.hello-agent-cli/settings.json）
  4. 企业托管配置（MDM / 远程配置）
  5. 环境变量（hello-agent-cli_MODEL、hello-agent-cli_API_KEY）
  6. 命令行参数（--model、--permission-mode）
```

- **JSON Schema 验证**：配置文件格式错误时，展示友好的错误位置和修复建议
- **配置迁移**：新版本增加配置项时，自动迁移旧格式
- **`hello-agent-cli config`** 子命令：`get/set/list/reset`

**Claude Code 怎么做**：

- `src/utils/config.ts`（1000+ 行）：`getGlobalConfig()` 处理 `~/.claude.json`，`enableConfigs()` 在初始化时加载并验证
- `src/utils/settings/`：Project settings（`settings.json`）、MDM 设置（企业远程管理）、Managed settings（策略限制）
- 关键设计：API Key 不写入项目配置（防止 git 泄露），`~/.claude.json` 的写入有重入锁（防止并发写损坏）

**实战代码**：约 300 行

---

### 第 21 章：打包与分发

**本章造什么**：把工具打包成可安装的 npm 包或单文件可执行文件，让他人一行命令安装使用。

**里程碑**：

```bash
npm install -g hello-agent-cli
hello-agent-cli --version  # 全局安装，可用
```

**实现要点**：

- **Bun 打包**：`bun build --compile src/index.ts --outfile hello-agent-cli`（单文件，~25MB，包含 Bun 运行时）
- **多平台**：`--target bun-macos-arm64`、`bun-linux-x64`、`bun-windows-x64`
- **npm 发布**：`package.json` 的 `bin`、`files`、`engines` 字段配置
- **GitHub Actions**：tag 触发 → 多平台构建 → 发布 GitHub Release + npm

```yaml
# .github/workflows/release.yml 核心
- name: Build
  run: |
    bun build --compile src/index.ts --target bun-macos-arm64 --outfile dist/hello-agent-cli-macos-arm64
    bun build --compile src/index.ts --target bun-linux-x64   --outfile dist/hello-agent-cli-linux-x64
```

- **自动更新**：启动时检查 npm 最新版本，有新版本时提示

**Claude Code 怎么做**：

- `build.ts`：Claude Code 的构建脚本用 Bun 的 `Bun.build()` API，450 个 chunk 的代码分割策略
- 关键设计：外部发布版和内部版用同一套源码，通过 Feature Flag 在打包时 DCE（Dead Code Elimination）

**实战代码**：约 100 行配置 + CI 脚本

---

## 第五部分：扩展生态

### 第 22 章：Skills 与插件系统

**本章造什么**：让用户扩展你的工具——通过 Skills（封装的提示词工作流）和插件（npm 包形式的工具扩展）。

**里程碑**：

```bash
# 安装社区 Skill
hello-agent-cli skill install code-review

# 使用
hello-agent-cli /code-review src/auth.ts
# 执行预定义的代码审查流程
```

**实现要点**：

- **Skill 格式**（YAML）：触发词 + 系统提示词补充 + 工具白名单 + 参数定义
- **Skill 加载**：从 `~/.hello-agent-cli/skills/` 和 `hello-agent-cli-skills/` 目录扫描
- **`discover_skill` 工具**：让 Agent 能搜索并使用已安装的 Skill
- **插件接口**：npm 包导出 `getTools(): Tool[]`，Agent 启动时加载

**Claude Code 怎么做**：

- `src/skills/`：`loadSkillsDir.ts` 扫描目录，`bundledSkills.ts` 内置 Skill，`mcpSkills.ts` 把 MCP Server 包装成 Skill
- `src/tools/SkillTool/`：`DiscoverSkillsTool` 让 LLM 能搜索可用 Skill
- 关键设计：Skill 不是"新类型的工具"，而是"带有特定系统提示词的工作流"；底层还是调用已有工具

**实战代码**：约 400 行

---

### 第 23 章：子代理编排——多 Agent 协同

**本章造什么**：实现多 Agent 协作模式——一个 Coordinator 分配任务，多个 Worker 并行执行，任务系统追踪进度。

**里程碑**：

```bash
hello-agent-cli "为 src/ 下所有模块生成文档，并行处理"
# Coordinator 分析模块列表
# Worker A: 生成 auth 模块文档
# Worker B: 生成 utils 模块文档
# Worker C: 生成 api 模块文档（并行）
# Coordinator: 汇总，生成 README
```

**实现要点**：

- **编排模式对比**：顺序（依赖有序）、并行（独立任务）、条件分支（结果决定下一步）
- **Team 机制**：`team_create` 创建协作组，成员间通过 `send_message` 通信
- **任务系统（Tasks v2）**：`TaskCreateTool`、`TaskGetTool`、`TaskListTool`、`TaskUpdateTool`、`TaskStopTool`——任务状态持久化，跨会话追踪

**Claude Code 怎么做**：

- `src/coordinator/coordinatorMode.ts`：Coordinator 模式下，主 Agent 只负责分配 Task（不执行工具），Worker 负责执行
- `src/tasks/`：Task 系统，任务状态存储在文件系统，支持多 Agent 共享
- 关键设计：Coordinator 和 Worker 的工具列表**不同**——Coordinator 有 `AgentTool`，Worker 有具体操作工具，但两者都没有对方的工具

**实战代码**：约 500 行

---

### 第 24 章：多云 API 支持

**本章造什么**：实现 Provider 抽象层，一套代码支持 Anthropic Direct、AWS Bedrock、Google Vertex、Azure Foundry。

**里程碑**：

```bash
# 切换到 AWS Bedrock
hello-agent-cli_PROVIDER=bedrock AWS_REGION=us-east-1 hello-agent-cli "hello"
```

**实现要点**：

```typescript
// src/services/api/providers.ts
interface LLMProvider {
  createMessage(params: MessageParams): Promise<Stream>;
}

class AnthropicProvider implements LLMProvider { /* ... */ }
class BedrockProvider implements LLMProvider {
  // AWS SigV4 签名、凭据刷新、Bedrock 特有的模型 ID 格式
}
class VertexProvider implements LLMProvider {
  // GCP 服务账号、Access Token 刷新
}
class AzureProvider implements LLMProvider {
  // Azure AD Token、Azure 特有的 endpoint 格式
}
```

- **凭据刷新**：Bedrock 的临时凭据、Vertex 的 OAuth Token 都需要定时刷新
- **成本路由**：根据任务类型和预算自动选择 Provider
- **模型映射**：`claude-3-5-sonnet` → 各 Provider 对应的模型 ID

**Claude Code 怎么做**：

- `src/utils/model/providers.ts`：Provider 选择逻辑
- 关键设计：Provider 之间不只是 endpoint 不同——Bedrock 需要 AWS SigV4 签名，Vertex 需要 GCP OAuth，Azure 有独特的认证和 API 版本控制

**实战代码**：约 400 行

---

## 第六部分：综合实战

### 第 25 章：从零到生产——完整项目实战

**本章造什么**：完整走一遍：从空目录到 npm 可安装的 `hello-agent-cli v1.0.0`。

**实战项目**：用 `hello-agent-cli` 自己来完成 `hello-agent-cli` 的一部分开发（Dogfooding）。

**25.1 核心实现回顾**

| 模块 | 章节 | 参考实现 | 代码量 |
| --- | --- | --- | --- |
| CLI 入口 | 第 1-2 章 | `src/entrypoints/cli.tsx` | ~120 行 |
| 流式 REPL | 第 3 章 | `src/screens/REPL.tsx` | ~300 行 |
| Agentic Loop | 第 4 章 | `src/query.ts` + `src/QueryEngine.ts` | ~500 行 |
| 上下文构建 | 第 5 章 | `src/context.ts` | ~200 行 |
| 工具框架 | 第 6 章 | `src/Tool.ts` + `src/tools.ts` | ~200 行 |
| 文件工具 | 第 7 章 | `src/tools/FileReadTool/` 等 | ~500 行 |
| Shell 工具 | 第 8 章 | `src/tools/BashTool/` 等 | ~400 行 |
| 网络工具 | 第 9 章 | `src/tools/WebFetchTool/` 等 | ~300 行 |
| 生产力工具 | 第 10 章 | `src/tools/TodoWriteTool/` 等 | ~400 行 |
| 子代理 | 第 11 章 | `src/tools/AgentTool/` | ~500 行 |
| MCP 客户端 | 第 12 章 | `src/services/mcp/` | ~500 行 |
| 记忆系统 | 第 13 章 | `src/memdir/` | ~600 行 |
| 权限系统 | 第 14 章 | `src/hooks/toolPermission/` | ~700 行 |
| 上下文压缩 | 第 16 章 | `src/services/compact/` | ~300 行 |
| Hook 系统 | 第 17 章 | `src/hooks/` | ~300 行 |
| 配置管理 | 第 20 章 | `src/utils/config.ts` | ~300 行 |
| **合计** | | | **~5600 行** |

**25.2 测试与优化**

- 性能基准：启动时间 < 200ms，首个 token < 1s
- 测试覆盖：核心模块 > 70%

**25.3 发布清单**

- `npm publish`（npm 包）
- GitHub Release（二进制文件）
- `hello-agent-cli.md` 模板（帮助用户快速配置项目）
- README（30 秒能跑起来的 Quickstart）

---

## 附录

### A. Claude Code 核心文件速查

| 文件 | 行数 | 对应章节 |
| --- | --- | --- |
| `src/entrypoints/cli.tsx` | 320 | 第 2 章 |
| `src/main.tsx` | 4,683 | 第 2 章 |
| `src/screens/REPL.tsx` | 5,009 | 第 3 章 |
| `src/query.ts` | 1,732 | 第 4 章 |
| `src/QueryEngine.ts` | 1,320 | 第 4 章 |
| `src/context.ts` | 189 | 第 5 章 |
| `src/tools.ts` | 389 | 第 6 章 |
| `src/services/api/claude.ts` | 3,420 | 第 1 章 |
| `src/services/mcp/` | 12,242 | 第 12 章 |
| `src/memdir/` | — | 第 13 章 |
| `src/hooks/toolPermission/` | — | 第 14 章 |
| `src/services/compact/` | — | 第 16 章 |
| `src/utils/config.ts` | 1,000+ | 第 20 章 |

### B. 工具 Schema 参考

每章的工具实现都附有完整的 JSON Schema 定义（`inputSchema`），可直接复制使用。

### C. System Prompt 模板库

- 通用 Agent 系统提示词
- 子代理（Explore / Plan / Verify）提示词
- 记忆提取专用提示词
- Coordinator 角色提示词

### D. 学习路径建议

| 目标 | 需完成 | 耗时 |
| --- | --- | --- |
| 快速上手，能聊天 | 第 1-3 章 | 1-2 天 |
| 能干活的 Agent | 第 1-9 章 | 3-5 天 |
| 生产可用 | 第 1-20 章 | 2-3 周 |
| 完整版本 | 全部 25 章 | 1 个月 |

### E. 常见问题

- **用 OpenAI 还是 Anthropic？** 两者均可；Anthropic 的 Tool Use API 更贴近本教程的设计
- **必须用 Bun 吗？** 推荐用 Bun，Node.js 也可以，但需跳过第 2 章的部分优化技巧
- **React Ink 难吗？** 会 React 的话 Ink 一天上手；不会 React 可以先用 `readline` 实现简单版本
- **API 费用多少？** 完成全教程约 $5-20，可用 `claude-haiku` / `gpt-4o-mini` 降低成本
