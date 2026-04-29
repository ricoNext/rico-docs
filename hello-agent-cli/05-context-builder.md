# 05 - Context Builder，上下文构建

这是一套从 0 到 1 构建 Agent CLI 的分阶段实战教程。 你会沿着 `REPL -> Agentic Loop -> Context Builder -> 工具系统 -> 工程化` 的路线逐章推进，最终做出一个可运行、可扩展、可发布的完整工具。

**技术栈**：`TypeScript + Node.js/Bun + React Ink + OpenAI/Anthropic API/DeepSeek API/GLM API/Qwen API`

代码仓库：[hello-agent-cli](https://github.com/ricoNext/hello-agent-cli)

最新文章可在 [https://www.riconext.cn/](https://www.riconext.cn/) 查看。

学习建议： 
1. 按照章节顺序阅读，每章的代码仓库地址在章节末尾。
2. 你可以基于上个章节的代码，跟着本章内容一起实现。

---

![](https://neptune-ipc.oss-cn-shenzhen.aliyuncs.com/img/20260429154407319.png)

前面四章，我们已经做出了一个可以调工具、可以循环推进任务的 Agent CLI。

但是，它还有一个很明显的短板：模型对运行环境是“瞎”的。

比如用户问一句「我们现在在哪个分支？」或者「最近改了什么？」，模型第一反应往往还是去尝试先调工具检查。问题在于，这些信息本来就存在本地环境里，每轮都现查，不仅慢，还浪费 token。

这一章要补的就是这个缺口：在请求模型之前，先构建一层稳定的运行上下文。

> Context Builder = 预先收集「当前目录、Git 状态、项目约束、当前时间」等环境事实，再交给模型推理。

本章配套代码：[`chapter-05`](https://github.com/ricoNext/hello-agent-cli/tree/chapter-05) ， 也可以基于 `chapter-04` 分支跟着本章内容一起实现。

这章的目标是：让模型第一轮就知道这些信息：

- 当前工作目录。
- 是否处于 Git 仓库。
- 当前分支和最近提交。
- 工作区改动摘要。
- 项目级约束（`CLAUDE.md` 体系）。

一句话，就是把“项目上下文”提前补给模型，让它先看环境再回答。


## 一、先定义上下文结构

在 `claude code` 中，上下文被分成了两层，分别是：

- `SystemContext`：环境事实（Git 快照、操作系统、当前目录等）。

- `UserContext`：用户/项目指令（`CLAUDE.md` 聚合）+ 当前日期。

所以我们在自己的 Agent CLI 里，也按这个边界定义上下文结构。

```typescript
// src/agent/context.ts
export interface SystemContext {
  // Git 状态
  gitStatus: string | null;
}

export interface UserContext {
  // 来自 CLAUDE.md / .claude/CLAUDE.md / .claude/rules/*.md 的聚合指令
  claudeMd: string | null;
  // 当前日期
  currentDate: string;
}
```

## 二、并行收集上下文（核心入口）

所有收集动作并行执行，避免串行等待拖慢首轮 token 产出。

在收集上下文时，参考 `claude code` 的两个策略：

1. 上下文按会话级 `memoize`(依赖 `lodash-es` 库) 缓存。
2. Git 与指令文件分开构建（对应 `getSystemContext` / `getUserContext`）。

`lodash-es` 库需要使用 `bun add lodash-es` 添加依赖 和 `bun add @types/lodash-es -D` 添加类型声明。

```typescript
// src/agent/context.ts
import {memoize} from "lodash-es"

export const getSystemContext = memoize(async (): Promise<SystemContext> => {
  const gitStatus = await getGitStatusMemoized()
  return { gitStatus }
})

export const getUserContext = memoize(async (): Promise<UserContext> => {
  const [claudeMd, currentDate] = await Promise.all([
    getClaudeMdContextMemoized(),
    Promise.resolve(`Today's date is ${new Date().toISOString().slice(0, 10)}.`),
  ])

  return { claudeMd, currentDate }
})
```

这里使用 `memoize` 是因为：

- 同一会话里，Git 快照和指令文件没必要每轮重算。
- 首轮成本换后续稳定，整体响应会更好。

> 新开对话时， 这些信息是需要被重新加载的。

上面两个上下文函数依赖的 memoized 函数，代码如下：

```typescript
// src/agent/context.ts
const getGitStatusMemoized = memoize(async () => {
  return getGitStatus()
})

const getClaudeMdContextMemoized = memoize(async () => {
  return getClaudeMdContext()
})
```

两者都是按照会话级缓存结果，避免重复计算。

## 三、实现 `getGitStatus`：采集 Git 快照（供 memoized 包装）

Git 信息最容易失控。处理时同时执行三件事：

1. 非 Git 目录，直接跳过。
2. 多个 Git 命令并行执行。
3. 严格限制输出长度，防止 token 爆炸。

首先实现基础函数方便后面的逻辑实现：

`run` 函数用于执行命令并返回输出。

```typescript
// src/agent/context.ts
import { spawn } from "node:child_process"

function run(command: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      shell: true,
      // 忽略错误输出
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString(); // 拼接 stdout
    });

    // 这里故意不 throw：Context Builder 应该“尽量给信息”，而不是因单点失败中断整轮
    child.on("close", () => {
      resolve(stdout.trim());
    });
  });
}
```

`isGitRepo` 函数用于检查当前目录是否为 Git 仓库。

```typescript
// src/agent/context.ts
async function isGitRepo(): Promise<boolean> {
  const output = await run("git rev-parse --is-inside-work-tree");
  return output === "true";
}
```

`truncate` 函数用于截断字符串，避免 token 爆炸。

> 在最后最好留一个尾巴提示，告诉模型这份信息是截断版，这样模型看到截断提示后，需要完整信息时会主动调工具。

```typescript
// src/agent/context.ts
function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n...(truncated, use bash tool for full git details)`;
}
```

现在我们可以实现 `getGitStatus` 函数了。

```typescript
// src/agent/context.ts
const MAX_GIT_CONTEXT_CHARS = 2000

async function getGitStatus(): Promise<string | null> {
  const inRepo = await isGitRepo();
  // 如果不是 Git 仓库，返回 null
  if (!inRepo) {
    return null;
  }

  // 并行获取 Git 状态：分支、主分支、状态、最近提交
  const [branch, mainBranch, status, log] = await Promise.all([
    run("git branch --show-current"),
    run(
      "git symbolic-ref refs/remotes/origin/HEAD | sed 's@^refs/remotes/origin/@@'"
    ),
    run("git status --short"),
    run("git log --oneline -n 5"),
  ]);

  // 拼接 Git 状态文本
  const text = [
    "This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.",
    "",
    `Current branch: ${branch || "(unknown)"}`,
    `Main branch (you will usually use this for PRs): ${mainBranch || "main"}`,
    "",
    "Status:",
    status || "(clean)",
    "",
    "Recent commits:",
    log || "(none)",
  ].join("\n");

  // 截断 Git 状态文本
  return truncate(text, MAX_GIT_CONTEXT_CHARS);
}
```

## 四、实现 `getClaudeMdContext`：加载 `CLAUDE.md` 指令链（供 memoized 包装）

`claude code` 的 `getClaudeMdContext` 函数实现思路是： 

1. 按层级递归加载以下文件：
   - `CLAUDE.md`
   - `.claude/CLAUDE.md`
   - `.claude/rules/*.md`
   - `CLAUDE.local.md`
2. 从当前目录向上遍历到根目录，再做聚合、去重与过滤。

这里我们先用一个简单的实现，先支持 `CLAUDE.md` 文件，后续再扩展 `.claude/rules/*.md` 文件。

同样先实现基础工具函数： 

`fileExists` 函数用于检查文件是否存在。

```typescript
// src/agent/context.ts
import fs from "node:fs/promises";

// 判断文件是否存在
async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}
```

然后实现 `getClaudeMdContext` 函数：

```typescript
// src/agent/context.ts
import { dirname, join } from "node:path"

async function getClaudeMdContext(): Promise<string | null> {
  const chunks: string[] = []
  let current = process.cwd()

  while (true) {
    // 第一步先支持 CLAUDE.md（后续再扩展 .claude/rules）
    const candidate = join(current, "CLAUDE.md")
    const exists = await fileExists(candidate)
    if (exists) {
      const content = (await fs.readFile(candidate, "utf-8")).trim()
      if (content) {
        chunks.push(`Contents of ${candidate}:\n\n${content}`)
      }
    }

    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  return chunks.length > 0 ? chunks.join("\n\n") : null
}
```

> 在 Unix/macOS 上，根目录 / 的父目录还是 /，所以当 current 走到 / 时，parent === current 成立，循环结束。

`CLAUDE.md` 里建议放三类内容：

- 编码约定（测试框架、包管理器等）。
- 禁止行为（哪些目录不能碰）。
- 常用命令（build/test/lint）。

这段信息注入后，模型首轮决策会明显稳定。后续章节中会继续补充以下功能：

1. `.claude/CLAUDE.md` 与 `.claude/rules/*.md` 遍历。
2. `@include` 解析与循环引用保护。
3. 条件规则（frontmatter `paths`）匹配目标文件。

## 五、拼装 system prompt

使用分层注入（`system/user`）的方式，把静态系统提示词和双上下文拼成结构化文本。

```typescript
// src/agent/context.ts
// 构建系统提示词
export async function buildSystemPrompt(
  baseSystemPrompt: string
): Promise<string> {
  const [systemCtx, userCtx] = await Promise.all([
    getSystemContext(),
    getUserContext(),
  ]);
  const blocks = [baseSystemPrompt.trim()];

  if (systemCtx.gitStatus) {
    blocks.push(
      "",
      "<system_context>",
      systemCtx.gitStatus,
      "</system_context>"
    );
  }

  if (userCtx.claudeMd) {
    blocks.push("", "<user_context>", userCtx.claudeMd, "</user_context>");
  }

  blocks.push("", userCtx.currentDate);
  return blocks.join("\n");
}
```

这种分层注入（`system/user`）有两个直接好处： 

- 模型更容易区分信息来源。
- 调试时更容易观察 prompt 结构。


## 六、接到 Agentic Loop 上

第 4 章里，`callModel()` 用的是固定 `SYSTEM`。这里改成“按需构建 + 会话缓存”。

```typescript
// src/agent/loop.ts
import { buildSystemPrompt } from "./context"

const BASE_SYSTEM =
  "你是命令行里的编码助手。需要列文件、统计数量、跑测试时，优先用工具获取真实输出，不要编造结果。"

let cachedSystemPrompt: string | null = null

async function getSystemPrompt(): Promise<string> {
  if (cachedSystemPrompt) return cachedSystemPrompt
  cachedSystemPrompt = await buildSystemPrompt(BASE_SYSTEM)
  return cachedSystemPrompt
}

export async function callModel(model: string, messages: ChatCompletionMessageParam[]) {
  const systemPrompt = await getSystemPrompt()
  return client.chat.completions.create({
    model,
    messages: [{ role: "system", content: systemPrompt }, ...messages],
    tools: openaiTools,
    tool_choice: "auto",
  })
}
```

这就完成了 `Context Builder` 的实现，核心思路就是：高频不变信息尽量只构建一次，把 token 和延迟预算留给真正任务。

## 七、验证

先在 Git 仓库里测试：

```bash
bun run src/index.ts -p "我们现在在哪个分支？最近有什么改动？"
```

预期现象：

- 模型多数情况下可直接回答，不用先调 `bash`。
- 回答里能带出分支、改动摘要、最近提交。

再测项目约束注入（先准备 `CLAUDE.md`）：

```bash
bun run src/index.ts -p "这个项目默认用什么命令跑测试？"
```

预期现象：

- 模型能直接依据 `CLAUDE.md` 回答。
- `CLAUDE.md` 不存在时，不报错，只是少一段上下文。

## Claude Code 的实现思路

参考仓库：[Claude Code](https://github.com/ricoNext/claude-code)

对应模块主要是两个文件：`src/context.ts` 和 `src/utils/claudemd.ts`。

- `getSystemContext`：按条件收集 Git 快照（会话级 `memoize`）。
- `getUserContext`：加载 `CLAUDE.md` 指令链并注入当前日期（会话级 `memoize`）。
- `MAX_STATUS_CHARS = 2000`：硬限制 Git 状态长度。
- `getMemoryFiles`：向上遍历目录，聚合 `CLAUDE.md` / `.claude/rules` / `CLAUDE.local.md`，并处理 include、去重、过滤。

和上面我们实现的思路大致， 可以提炼出三条经验：

1. 上下文构建不追求大而全。
2. 只放高价值事实。
3. 一定做长度控制和缓存。


## 小结

这一章我们实现了 Agent 的环境感知层：

1. 定义 `SystemContext` + `UserContext`，分层管理运行时信息与指令信息。
2. 实现并行收集（Git 快照 + `CLAUDE.md` 指令链 + 日期）。
3. 加入截断与缓存，避免 token 和性能失控。
4. 把上下文无缝接入 Agentic Loop 的调用链。

从这里开始，Agent 就不再是“想当然的回答”，而是“先读环境，再做决策”。

下一章进入第 6 章「链路打通」：我们会把 REPL 输入链路接到 Agentic Loop 和 Context Builder，让 `bun run src/index.ts` 与 `bun run src/index.ts -p` 共用同一套执行引擎。

```bash
# 第 6 章预告
bun run src/index.ts
> 你好，我是你的编码助手，有什么可以帮你的吗？
> 我们现在在 哪个分支？最近有什么改动？
> 我们当前位于 `xxx` 分支。最近的改动包括：`xxx`、`xxx`、`xxx`。
```

[本章节代码仓库](https://github.com/ricoNext/hello-agent-cli/tree/chapter-05)

喜欢我的文章，欢迎关注我的公众号：「闲不住的李先森」，我会定期分享 AI 编程相关的知识和经验。

![](https://neptune-ipc.oss-cn-shenzhen.aliyuncs.com/img/%E6%89%AB%E7%A0%81_%E6%90%9C%E7%B4%A2%E8%81%94%E5%90%88%E4%BC%A0%E6%92%AD%E6%A0%B7%E5%BC%8F-%E7%99%BD%E8%89%B2%E7%89%88.png)