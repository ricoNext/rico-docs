# 06 - 让 REPL 复用 Agentic Loop 与 Context


这是一套从 0 到 1 构建 Agent CLI 的分阶段实战教程。 你会沿着 `REPL -> Agentic Loop -> Context Builder -> 工具系统 -> 工程化` 的路线逐章推进，最终做出一个可运行、可扩展、可发布的完整工具。

**技术栈**：`TypeScript + Node.js/Bun + React Ink + OpenAI/Anthropic API/DeepSeek API/GLM API/Qwen API`

仓库在这：[hello-agent-cli](https://github.com/ricoNext/hello-agent-cli)。作者博客：<https://www.riconext.cn/>。

1. 建议按章节顺序读，每章末有对应分支；
2. 仓库地址是 https://github.com/ricoNext/hello-agent-cli/tree/chapter-xx, 每章的代码按照分支存放在仓库中， 分支名称为 `chapter-xxx`。
2. 本章的代码改动会基于上节的代码进行改动，所以你可以直接基于上一节的代码学习，跟着本章的代码一起实现。
---

![第 6 章配图](https://neptune-ipc.oss-cn-shenzhen.aliyuncs.com/img/20260429165752105.png)


前几章已经凑齐三件事：能进 `REPL` 模式、`-p` 能跑 `Agentic Loop`、第五章又往上下文里塞了 `Git` 和用户规则。

现在 `-p` 场景下能够进入 `Agentic Loop` 和 `Context Builder`，而 `REPL` 模式下还是进入普通的流式对话中， 并不能使用 `Agentic Loop` 和 `Context Builder` 的能力。

所以这一节， 我们把 `Agentic Loop` 和 `Context Builder` 的能力抽出来， 让 `REPL` 和 `-p` 模式下都能使用。

---

## 一、梳理实现思路

之前实现的循环入口是 `loop.ts` 文件中的 `runAgentPipe` 函数， 他实现了 `for`：`callModel` 的逻辑， 并在 `callModel` 中判断是否存在 `tool_calls`， 如果存在则调用 `handleToolCalls` 处理工具调用， 否则直接打印结果。

看一下之前 `runAgentPipe` 函数的实现， 这里只展示核心逻辑， 完整代码请参考仓库。

```typescript
export async function runAgentPipe(opts: {
  prompt: string;
  model: string;
  maxTurns: number;
}): Promise<void> {
  // ... 

  const messages: ChatCompletionMessageParam[] = [
    { role: "user", content: opts.prompt },
  ];

  // 循环调用模型， 直到达到最大轮次或模型不再需要调用工具
  for (let turn = 0; turn < opts.maxTurns; turn++) {
    const res = await callModel(opts.model, messages);
    const choice = res.choices[0];
    const msg = choice?.message;
    // ...
    // 如果有工具调用，则调用工具
    if (msg.tool_calls?.length) {
      const chunk = await handleToolCalls(msg);
      messages.push(...chunk);
      continue;
    }
    // 否则直接打印结果
    console.log(msg.content ?? "");
    return;
  }

  // ...
}
```

最后的结果也可以看到， 当大模型判定不再需要调用工具时， 因为是在  `-p` 模式下， 直接打印了结果， 为了保证 `REPL` 模式下也能使用，就需要在 `REPL` 模式下将最后一轮的 `assistant` 消息保存在对话的上下文中， 而在 `-p` 模式下， 直接打印结果。 

知道了这个最终的目的， 我们来看实现的思路：

1. 将 `runAgentPipe` 函数中的循环的核心逻辑提炼成 `runAgentConversation` 函数。支持 `-p` 和 `REPL` 模式。
2. 改写 `runAgentPipe` 函数， 让它调用 `runAgentConversation` 函数， 继续走 `-p` 模式下的逻辑。
3. 改写 `repl-app.tsx` 文件， 对话时调用 `runAgentConversation` 函数， 继续走 `REPL` 模式下的逻辑。

知道要做的事情， 我们来看如何实现。

## 二、抽离 `runAgentConversation` 函数， 支持 `-p` 和 `REPL` 模式

`runAgentConversation` 的主要逻辑和 `runAgentPipe` 类似， 都是循环调用模型， 直到达到最大轮次或模型不再需要调用工具。 他需要两个参数：

1. `initialMessages`: 这一轮已经拼好的 OpenAI `messages`（里头含本轮用户话）， 这是一个 `ChatCompletionMessageParam[]` 类型的数组。
2. `opts`: 外加 `model` / `maxTurns`， 以及 `onToolRound` 函数， 用来进入工具 `Loop`时回调给 `REPL` 展示信息。

并返回两个值：
1. `messages`: 这一轮循环结束后的 `messages`， 依旧是一个 `ChatCompletionMessageParam[]` 类型的数组， 包含了这一轮循环的全部对话消息。
2. `finalAssistantText`: 这一轮循环结束后的 `assistant` 消息的文本内容， 提供给 `-p` 模式下直接打印。

`ChatCompletionMessageParam` 是 OpenAI 的类型， 定义了 `role` 和 `content` 字段。

先定义 入参 `opts` 的类型接口：`RunAgentConversationOptions`

```typescript
// loop.ts

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

/** 与 `-p`、REPL 共用的执行选项 */
export interface RunAgentConversationOptions {
  model: string;
  maxTurns: number;
  /** 进入工具轮时回调（用于 REPL 展示「正在调用工具」） */
  onToolRound?: (info: { toolNames: string[] }) => void;
}
```

下面实现 `runAgentConversation` 函数：


```typescript
// loop.ts

/**
 * 从当前 OpenAI 消息列表开始跑 Agent 循环，直到返回无 tool_calls 的 assistant 文本或达到 maxTurns。
 */
export async function runAgentConversation(
  initialMessages: ChatCompletionMessageParam[],
  opts: RunAgentConversationOptions
): Promise<{
  messages: ChatCompletionMessageParam[];
  finalAssistantText: string;
}> {
  // 初始化 working 数组， 复制初始消息
  const working: ChatCompletionMessageParam[] = [...initialMessages];

  // 循环调用模型， 直到达到最大轮次或模型不再需要调用工具
  for (let turn = 0; turn < opts.maxTurns; turn++) {
    const res = await callModel(opts.model, working);
    const msg = res.choices[0]?.message;
    if (!msg) {
      throw new Error("模型未返回 message");
    }

    if (msg.tool_calls?.length) {
      // 这里先过滤出工具调用， 并获取工具名称， 用于在 `REPL` 模式下展示
      const names = msg.tool_calls
        .filter((t) => t.type === "function")
        .map((t) => t.function.name);
      opts.onToolRound?.({ toolNames: names });

      // 调用工具
      const chunk = await handleToolCalls(msg);
      // 将工具调用的结果添加到 working 数组中
      working.push(...chunk);
      continue;
    }
    // 没有工具调用， 则直接将 `assistant` 消息添加到 working 数组中
    const text = msg.content ?? "";
    working.push({ role: "assistant", content: text });
    return { messages: working, finalAssistantText: text };
  }

  // 如果达到最大轮次， 则抛出错误
  throw new Error(`已达到最大轮次 ${opts.maxTurns}，停止以防死循环。`);
}
```

1. `working` 数组用来存储这一轮循环的对话消息。
2. `opts.onToolRound` 用来在进入工具轮时回调给 `REPL` 展示信息。
3. `handleToolCalls` 函数没有变化， 这里不展开。
3. 最后返回 `messages` 用来给 `REPL` 模式下展示对话历史， 返回 `finalAssistantText` 用来给 `-p` 模式下直接打印。


然后就是调整 `runAgentPipe` 函数， 让它调用 `runAgentConversation` 函数， 继续走 `-p` 模式下的逻辑。

```typescript
// loop.ts

export async function runAgentPipe(opts: {
  prompt: string;
  model: string;
  maxTurns: number;
}): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    console.error("错误：请设置 OPENAI_API_KEY");
    process.exit(1);
  }

  try {
    const { finalAssistantText } = await runAgentConversation(
      [{ role: "user", content: opts.prompt }],
      { model: opts.model, maxTurns: opts.maxTurns }
    );

    // 打印结果
    console.log(finalAssistantText);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    console.error(m);
    process.exit(1);
  }
}
```

完成上面的代码， 你可以尝试使用 `bun run src/index.ts -p “xxx”` 命令来测试一下， 看看是否能够正常工作。

下面我们来看 `repl-app.tsx` 文件， 如何改写， 让它能够使用 `runAgentConversation` 函数。


## 三、`repl-app.tsx` 改写：对话时使用 `runAgentConversation` 函数

整个 `repl-app.tsx` 的代码逻辑是： CLI 入口调用 `runRepl` 函数 -> 调用 `REPLApp` 组件 -> 提交对话时调用 `submit` 函数。

这里我们首先改写 `runRepl` 函数 和 `REPLApp` 组件以支持传入 `maxTurns` 参数。

```typescript
// repl-app.tsx

// 改写 runRepl 函数， 支持传入 `maxTurns` 参数
export async function runRepl(opts: {
  model: string;
  maxTurns: number;
}): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    console.error("错误：请设置 OPENAI_API_KEY");
    process.exit(1);
  }
  const { render } = await import("ink");
  const app = render(
    // 传入 `maxTurns` 参数
    <REPLApp model={opts.model} maxTurns={opts.maxTurns} />
  );
  await app.waitUntilExit();
}
```

然后改写 `REPLApp` 组件， 支持传入 `maxTurns` 参数。

```typescript
// repl-app.tsx

export function REPLApp({
  model,
  maxTurns,
}: {
  model: string;
  maxTurns: number;
}) {
// ...
}
```

提交对话时在 `submit` 函数中调用 `streamChatCompletion` 函数， 现在需要改写， 让它能够使用 `runAgentConversation` 函数来循环调用模型。

下面是 `submit` 函数的实现， 代码比较长， 但是相对于之前章节实现的代码改动不大， 重点关注  `try {} catch {}` 部分的代码改动

```typescript
// repl-app.tsx

// REPLApp 组件内部
const submit = async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed || busy) {
      return;
    }
    
    // 如果输入为斜杠命令， 则执行斜杠命令
    if (trimmed.startsWith("/")) {
      runSlash(trimmed);
      return;
    }

    const userRow: ChatRow = { id: uid(), role: "user", content: trimmed };
    const botId = uid();

    const userMsg: ChatCompletionMessageParam = {
      role: "user",
      content: trimmed,
    };
    const nextMessages: ChatCompletionMessageParam[] = [...history, userMsg];

    setRows((r) => [
      ...r,
      userRow,
      { id: botId, role: "assistant", content: "", streaming: true },
    ]);
    setBusy(true);

    const t0 = performance.now();

    try {

      // 这里也删掉了 流式拼接的逻辑， 
      // 因为 `runAgentConversation` 函数 还不支持流式输出， 后续的章节会补充。

      // 调用 `runAgentConversation` 函数， 循环调用模型
      const { messages: after, finalAssistantText } =
        await runAgentConversation(nextMessages, {
          model,
          maxTurns,
          // 在进入工具轮时回调给 `REPL` 展示信息
          onToolRound: ({ toolNames }) => {
            setRows((prev) =>
              prev.map((row) =>
                // 区分 调用工具， 来更新历史对话
                row.id === botId
                  ? {
                      ...row,
                      content: `正在调用工具：${toolNames.join(", ") || "(未知)"}\n`,
                    }
                  : row
              )
            );
          },
        });

      const sec = ((performance.now() - t0) / 1000).toFixed(1);
      const footer = `\n[完成，约 ${roughTokens(finalAssistantText)} tokens，${sec}s]`;

      // 更新助手消息行
      setRows((prev) =>
        prev.map((row) =>
          row.id === botId
            ? {
                ...row,
                content: `${finalAssistantText}${footer}`,
                streaming: false,
              }
            : row
        )
      );
      // 更新历史对话
      setHistory(after);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setRows((prev) =>
        prev.map((row) =>
          row.id === botId
            ? { ...row, content: `错误：${msg}`, streaming: false }
            : row
        )
      );
    } finally {
      setBusy(false);
    }
  };
```


1. 上面的代码主要是将 `streamChatCompletion` 函数替换为 `runAgentConversation` 函数， 并增加了 `onToolRound` 回调函数， 用来在进入工具轮时展示信息。
2. 另外 对 `history` 数组的类型也做了调整， 从 `Message[]` 类型的数组， 改为 `ChatCompletionMessageParam[]` 类型的数组， 这样就可以包含工具调用的消息。
3. 删掉了流式拼接的逻辑， 因为 `runAgentConversation` 函数 还不支持流式输出， 后续的章节会补充。

这样下来我们在 `REPL` 模式下也接入了 `Agentic Loop` 和 `Context Builder` 的能力。

接下来我们来看 `cli.ts` 文件，让它能够支持传入 `maxTurns` 参数。

```typescript
// cli.ts

// 定义最大轮次， 默认 16 轮
const DEFAULT_MAX_TURNS = 16;

// program.action 函数内部
// 无参数且非管道：进入交互 REPL
if (!(prompt || opts.pipe)) {
  // 动态导入 `runRepl` 避免入口阻塞
  const { runRepl } = await import("./ui/repl-app.js");
  await runRepl({
    model: opts.model,
    maxTurns: Number(opts.maxTurns ?? DEFAULT_MAX_TURNS),
  });
  return;
}
```

## 四、总结

我们的项目在不同的模式下调用关系是这样的：

```plaintext
CLI
├─ 无参数         → runRepl → REPLApp.submit → runAgentConversation → callModel(buildSystemPrompt) + tools
└─ `-p`           → runAgentPipe → runAgentConversation（同一套）
```

可以看到：**Ink 只管渲染 UI，`buildSystemPrompt` 仍在 `callModel` 这条线上**，整条链的核心就是 **`runAgentConversation`**。

最终我们在 `REPL` 模式下的运行效果是这样的。

![](https://neptune-ipc.oss-cn-shenzhen.aliyuncs.com/img/20260430104139214.png)

唯一有点遗憾的是， 我们删掉了流式拼接的逻辑， 因为 `runAgentConversation` 函数 还不支持流式输出， 下一节我们会补充这个功能。

[本章节代码仓库](https://github.com/ricoNext/hello-agent-cli/tree/chapter-06)

喜欢我的文章，欢迎关注我的公众号：「闲不住的李先森」，我会定期分享 AI 编程相关的知识和经验。

![](https://neptune-ipc.oss-cn-shenzhen.aliyuncs.com/img/%E6%89%AB%E7%A0%81_%E6%90%9C%E7%B4%A2%E8%81%94%E5%90%88%E4%BC%A0%E6%92%AD%E6%A0%B7%E5%BC%8F-%E7%99%BD%E8%89%B2%E7%89%88.png)
