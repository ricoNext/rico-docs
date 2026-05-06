# 09 - Tool 注册与调用框架搭建

> 从本章起进入 `Hello Agent CLI` 系列的 **第二部分：工具系统**。  

这是一套从 0 到 1 构建 Agent CLI 的分阶段实战教程。你会沿着  
`REPL -> Agentic Loop -> Context Builder -> 工具系统 -> 工程化`  
的路线逐章推进，最终做出一个可运行、可扩展、可发布的完整工具。

**技术栈**：`TypeScript + Node.js/Bun + React Ink + OpenAI 兼容 API`

仓库在这：[hello-agent-cli](https://github.com/ricoNext/hello-agent-cli)。  
作者博客：<https://www.riconext.cn/>。

1. 每章的代码按照分支存放在仓库中，分支名称为 `chapter-xxx`，本章代码分支 **`chapter-09`**。
2. 本章的代码改动会基于上节的代码进行改动，所以你可以直接查看上一节的代码学习，跟着本章的节奏一步步实现。

---

![](https://neptune-ipc.oss-cn-shenzhen.aliyuncs.com/img/20260506105234969.png)


第 4 章我们已经跑通 **`Agentic Loop`**：模型返回 `tool_calls`，程序执行
`bash`，再把 `role: "tool"` 的消息塞回上下文。那一章的重点是**控制流**。

让我们回顾一下 bash 工具是如何调用的：

1. `src/tools/openai-tools.ts` 里**手写** `openaiTools` 数组，目前只有
   `bash`；
2. `src/agent/loop.ts` 的 `handleToolCalls` 里**手写** `if (name === "bash")`
   分支，直接 `executeBash`。

这能虽然能跑通，但每加一个工具就要改两处，且容易和 **流式路径**（`callModelStreamFinalText`
里同样引用 `openaiTools`）**漂移**。

本章目标：**新增工具只动「工具侧」一处列表**，`loop` 只负责「解析
`tool_calls` → 调统一入口 → 拼回消息」。

最终要实现的工具注册和调用流程是这样的： 

![](https://neptune-ipc.oss-cn-shenzhen.aliyuncs.com/img/20260506101301559.png)

所有的工具收拢在 `AGENT_TOOLS` 数组中，然后通过 `toolsToOpenAI` 生成 API 的 `openaiTools`，模型在
`messages + tools` 上推理；若有 `tool_calls`，循环里再经 `handleToolCalls`、
`runToolCall` 回到注册表执行。

下面进入代码实现阶段。

## 代码实现

### 1. 定义 `AgentTool` 类型

新建 `src/tools/types.ts` 文件，约定工具接口必须包含 `name`、`toOpenAI`、`execute` 三个属性，
分别表示工具的名称、生成 OpenAI tools 列表的函数、执行工具的函数。 除此之外，还支持工具的别名，便于改名兼容。


```typescript
// src/tools/types.ts
import type { ChatCompletionTool } from "openai/resources/chat/completions";

export interface AgentTool {
  /** 可选：工具的别名，便于改名兼容 */
  readonly aliases?: readonly string[];
  /** 已解析的 JSON 参数 → 写入 `role: "tool"` 的消息体正文 */
  execute: (args: unknown) => Promise<string>;
  /** 工具的名称 */
  readonly name: string;
  /** 生成挂到 `chat.completions.create({ tools })` 的一项 */
  toOpenAI: () => ChatCompletionTool;
}
```

### 2. 把 `bash` 收成工具对象

已经定义好的 `bash` 工具， 不再直接面向模型，新建 `src/tools/bash-tool.ts` 文件，
将 `bash` 收成工具对象，并继续调用第 4 章已有的 `executeBash` 函数， 具体代码如下：

```typescript
// src/tools/bash-tool.ts

import { executeBash } from "./bash";
import type { AgentTool } from "./types";

export const bashTool: AgentTool = {
  name: "bash",
  toOpenAI: () => ({
    type: "function",
    function: {
      name: "bash",
      description:
        "在项目当前工作目录执行一条 shell 命令，返回 stdout、stderr、exitCode 的 JSON。",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "要执行的一条 shell 命令" },
        },
        required: ["command"],
      },
    },
  }),
  async execute(args: unknown) {
    const command =
      typeof (args as { command?: unknown })?.command === "string"
        ? (args as { command: string }).command
        : "";
    if (!command.trim()) {
      return "错误：command 为空";
    }
    return executeBash(command);
  },
};
```

这样 **执行语义** 与第 4 章完全一致，只是换了挂载方式。

### 4.3 增加演示工具 `uppercase`

新增一个演示工具 `uppercase` （字符转大写）， 测试工具注册和调用流程。

并且模型也可以只调用工具 `uppercase` 完成「把 `hello` 转大写」，
而不依赖 `bash`（也避免不同系统 `tr`/`awk` 差异）。

代码存放在 `src/tools/uppercase-tool.ts`。

```typescript
// src/tools/uppercase-tool.ts
import type { AgentTool } from "./types";

export const uppercaseTool: AgentTool = {
  name: "uppercase",
  toOpenAI: () => ({
    type: "function",
    function: {
      name: "uppercase",
      description: "将输入字符串转为大写，返回 JSON：`{ \"result\": \"...\" }`。",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "原始字符串" },
        },
        required: ["text"],
      },
    },
  }),
  async execute(args: unknown) {
    const text =
      typeof (args as { text?: unknown })?.text === "string"
        ? (args as { text: string }).text
        : "";
    return JSON.stringify({ result: text.toUpperCase() }, null, 2);
  },
};
```

### 3. 注册表与 `findToolByName`

新建 `src/tools/registry.ts` 文件， 创建 `AGENT_TOOLS` 数组， 并实现 `toolMatchesName` / `findToolByName` / `toolsToOpenAI` 函数。

`AGENT_TOOLS` 数组用于存储所有的工具， 每个工具都是一个 `AgentTool` 对象。

`toolMatchesName` 函数用于匹配工具名称， 如果工具名称和传入的名称相同， 或者工具的别名包含传入的名称， 则返回 true。

`findToolByName` 函数用于根据工具名称查找工具， 如果找到工具， 则返回工具对象， 否则返回 undefined。

`toolsToOpenAI` 函数用于生成 OpenAI tools 列表， 将 `AGENT_TOOLS` 数组中的每个工具转换为 OpenAI tools 列表。

具体代码如下：

```typescript
// src/tools/registry.ts

import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { bashTool } from "./bash-tool";
import type { AgentTool } from "./types";
import { uppercaseTool } from "./uppercase-tool";

// 工具注册表
export const AGENT_TOOLS: readonly AgentTool[] = [bashTool, uppercaseTool];

// 工具名称匹配工具
export function toolMatchesName(
  tool: { name: string; aliases?: readonly string[] },
  name: string
): boolean {
  return tool.name === name || (tool.aliases?.includes(name) ?? false);
}

// 根据工具名称查找工具
export function findToolByName(
  tools: readonly AgentTool[],
  name: string
): AgentTool | undefined {
  return tools.find((t) => toolMatchesName(t, name));
}

// 根据工具名称查找工具
export function findAgentTool(name: string): AgentTool | undefined {
  return findToolByName(AGENT_TOOLS, name);
}

// 生成 OpenAI tools 列表
export function toolsToOpenAI(): ChatCompletionTool[] {
  return AGENT_TOOLS.map((t) => t.toOpenAI());
}
```

这样以后新增 `read_file`、`grep` 等工具，只要把新工具 import
进来并推进 `AGENT_TOOLS` 数组即可。

### 4. 实现统一调度 `runToolCall`

新建 `src/tools/tool-dispatch.ts` 文件， 实现 `runToolCall` 函数， 
把 `loop.ts` 里「JSON 解析失败 / 未知工具 / 执行异常」三件事收拢到一个函数，
实现「先解析再分发」的结构，后续加权限时也只改这一处：

```typescript
// src/tools/tool-dispatch.ts

import { findAgentTool } from "./registry";

export async function runToolCall(
  id: string,
  name: string,
  argumentsJson: string | undefined
): Promise<{ id: string; body: string }> {
  let args: unknown;
  try {
    args = JSON.parse(argumentsJson || "{}");
  } catch {
    return { id, body: "tool 参数 JSON 解析失败" };
  }
  const tool = findAgentTool(name);
  if (!tool) {
    return { id, body: `未知工具: ${name}` };
  }
  try {
    const body = await tool.execute(args);
    return { id, body };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return { id, body: `工具执行错误: ${m}` };
  }
}
```

### 5. 让 `openaiTools` 由注册表派生

前面的章节 `openai-tools.ts` 中我们手写了一个 `openaiTools` 数组， 现在我们让 `openaiTools` 由注册表派生，

把原来的手写数组**替换**为调用 `toolsToOpenAI` 函数，具体代码如下：

```typescript
// src/tools/openai-tools.ts
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { toolsToOpenAI } from "./registry";

export const openaiTools: ChatCompletionTool[] = toolsToOpenAI();
```

这样 `callModel` 与 `callModelStreamFinalText` 里引用的 `openaiTools` **自动**
包含 `uppercase`，不会出现「流式一轮能选工具、执行层却不认识」的断层。

### 6. 精简 `handleToolCalls`

在 Agentic Loop 的 `loop.ts` 中，`handleToolCalls` 的职责是并行处理本轮所有
 `tool_calls`，得到 `{ id, body }[]`，再把
 **原始的 assistant 消息**（含 `tool_calls`）和**各条 `role: "tool"`** 
 按顺序拼进数组返回给上层 `runAgentConversation`。

既然我们有了 `runToolCall` 函数， 我们可以直接在 `handleToolCalls` 中调用 `runToolCall` 函数， 而不是手写 `if (name === "bash")` 分支。

具体代码如下：
```typescript
// src/agent/loop.ts

import { runToolCall } from "../tools/tool-dispatch";

async function handleToolCalls(
  msg: ChatCompletionMessage
): Promise<ChatCompletionMessageParam[]> {
  const calls = msg.tool_calls ?? [];
  const appended: ChatCompletionMessageParam[] = [];

  const results = await Promise.all(
    calls.map(async (tc) => {
      if (tc.type !== "function") {
        return { id: tc.id, body: "不支持的 tool_calls.type" };
      }
      return runToolCall(tc.id, tc.function.name, tc.function.arguments);
    })
  );

  appended.push(msg);
  for (const r of results) {
    appended.push({ role: "tool", tool_call_id: r.id, content: r.body });
  }
  return appended;
}
```

这样我们就实现了 `handleToolCalls` 的精简， 并且模型是否选用 `uppercase` 取决于描述是否清晰。我们可以在 `BASE_SYSTEM` 基座里加一句短约束，例如：

```typescript
// src/agent/loop.ts

const BASE_SYSTEM =
  `你是命令行里的编码助手。需要列文件、统计数量、跑测试时，优先用工具获取真实输出，不要编造结果。
  若用户明确要求「只转大小写、不访问磁盘」，优先使用 `uppercase` 工具。`;
```

做后我们再验证一下结果：

![](https://neptune-ipc.oss-cn-shenzhen.aliyuncs.com/img/20260506103824484.png)


期望行为：至少出现一轮 `tool_calls`（常见为 `uppercase`），最终回答里出现
`HELLO` 或等价说明。

若模型仍坚持用 `bash`，也算 loop 正常，但建议你检查 `openaiTools` 是否已
包含 `uppercase`、以及系统提示是否过短。

## 总结

在这章中我们完成了三件事：

1. **Tool 契约**：`AgentTool` 把「声明」与「执行」绑在同一块，便于测试单个
   工具；
2. **注册表**：`AGENT_TOOLS` + `findToolByName`，对齐 `tools.ts` 的组装方式；
3. **调度入口**：`runToolCall` 收拢解析与错误，对齐 query 层「先解析再分发」
   的结构，为后面章节的权限、Hook 留钩子。

下一章 **第 10 章：文件操作工具**，会在同一套框架上挂 `read_file` /
`write_file` / `edit_file`，无需再改 loop 的分支形态。

感谢阅读， 如果你对我们这个系列感兴趣，欢迎关注我的公众号：「闲不住的李先森」， 我们会持续更新更多关于 AI 全栈开发的内容。

![公众号二维码](https://neptune-ipc.oss-cn-shenzhen.aliyuncs.com/img/%E6%89%AB%E7%A0%81_%E6%90%9C%E7%B4%A2%E8%81%94%E5%90%88%E4%BC%A0%E6%92%AD%E6%A0%B7%E5%BC%8F-%E7%99%BD%E8%89%B2%E7%89%88.png)


