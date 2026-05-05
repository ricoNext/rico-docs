# 07 - 统一执行链路的流式回复

> 本章节所有代码基于第六章的代码进行修改， 所以你需要先理解第六章的代码实现， 然后再进行本章的学习。

这是一套从 0 到 1 构建 Agent CLI 的分阶段实战教程。你会沿着  
`REPL -> Agentic Loop -> Context Builder -> 工具系统 -> 工程化`  
的路线逐章推进，最终做出一个可运行、可扩展、可发布的完整工具。

**技术栈**：`TypeScript + Node.js/Bun + React Ink + OpenAI 兼容 API`

仓库在这：[hello-agent-cli](https://github.com/ricoNext/hello-agent-cli)。  
作者博客：<https://www.riconext.cn/>。

1. 建议按章节顺序读，每章末有对应分支；
2. 每章代码按分支存放，分支名为 `chapter-xxx`；
3. 本章继续基于第 6 章代码增量修改，不另起新架构。

---

![第 7 章配图](https://neptune-ipc.oss-cn-shenzhen.aliyuncs.com/img/20260430114107555.png)

第 6 章我们已经实现：`-p` 与 `REPL` 共用 `runAgentConversation`函数， 实现了循环执行的效果。  但是对于大模型的回答， 并没有实现流式回复。 本章我们来实现 `REPL 流式回复` 效果， `-p` 模式还保持整段输出：

在开始之前， 我们需要了解大部分 `OpenAI` 兼容协议里， 当我们使用 `chat.completions.create` 创建对话时， 并设置 `stream: true` 时， 模型返回的消息是流式返回的， 这样的：

1. 用户输入消息， 并携带 `tool_calls` 信息（如果有）；
2. 模型根据用户输入消息， 判断是否需要调用工具， 如果需要调用工具， 则返回 `tool_calls` 信息；
3. 程序中根据 `tool_calls` 信息， 自己调用工具， 并将工具执行结果返回给模型；
4. 模型根据工具执行结果， 继续生成回答；

关键点来了， 因为设置了 `stream: true` ， 所以第 2 步模型返回的消息是流式返回的， 也就是说， 模型会分段返回消息， 而不是一次性返回整个消息。

他返回的信息是这样的（示意）：

```json
{"choices":[{"delta":{"role":"assistant"}}]}

{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_xxx","type":"function","function":{"name":"bash","arguments":"{\"command\":\"ls"}}]}}]}

{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":" -la\"}"}}]}}]}

{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}
```

所以我们要想在第三步程序中根据 `tool_calls` 信息自己调用工具，就需要等模型把所有的 `tool_calls` 信息都返回后， 才能调用。

那为了等待模型返回所有 `tool_calls` 信息， 就需要手动拼接多端 `tool_calls` 信息， 很容易出错， 所以我们对于 `tool_calls` 的处理， 不走 流式输出， 直接调用定义好的 `callModel` 函数来获取完整的 `tool_calls` 信息。

这个逻辑在下面的代码中会体现到。


了解了上面的流程后， 我们本章要做的事情就很简单了： 

![第 7 章流程图配图](https://neptune-ipc.oss-cn-shenzhen.aliyuncs.com/img/20260430142645314.png)

本章配套代码：[chapter-07](https://github.com/ricoNext/hello-agent-cli/tree/chapter-07)

--- 

开始代码实现环节： 

沿用前面章节实现的代码， 我们需要修改 `runAgentConversation` 函数的入参 `RunAgentConversationOptions` ， 增加两个入参：

```typescript
// loop.ts

export interface RunAgentConversationOptions {
  // 最大轮次
  maxTurns: number;
  // 模型
  model: string;
  // 工具调用回调
  onToolRound?: (info: { toolNames: string[] }) => void;
  // 添加： 流式输出最后一轮 assistant 的文本
  onAssistantDelta?: (text: string) => void;
  // 添加： 是否流式输出最后一轮 assistant 的文本
  streamFinalAssistant?: boolean;
}
```

- `streamFinalAssistant: true`：最后一轮纯文本尝试流式；
- 不传或为 `false`：完全走整段输出模式。


接下来我们需要在主循环函数 `runAgentConversation` 里面增加一个判断，
如果 `streamFinalAssistant` 为 `true` ，则**处理流式输出**，否则调用 `callModel` 函数来输出最后一轮 assistant 的文本。

```typescript
// loop.ts
/**
 * 运行 Agent 对话
 * @param initialMessages 初始消息
 * @param opts 执行选项
 * @returns 最终消息和最后一轮助手消息
 */
export async function runAgentConversation(
  initialMessages: ChatCompletionMessageParam[],
  // 按照上面入参的定义， 这里 opts 存在 streamFinalAssistant 字段
  opts: RunAgentConversationOptions
): Promise<{
  messages: ChatCompletionMessageParam[];
  finalAssistantText: string;
}> {
  const working: ChatCompletionMessageParam[] = [...initialMessages];

  for (let turn = 0; turn < opts.maxTurns; turn++) {
    // 如果 opts.streamFinalAssistant 为 true， 则处理流式输出
    if (opts.streamFinalAssistant) {
      // 处理流式输出： 调用 callModelStreamFinalText 函数处理
      return { messages: working, finalAssistantText: text };
    }

    // 否则继续走非流式输出
    const res = await callModel(opts.model, working);
    const msg = res.choices[0]?.message;
    // 以下的代码前面章节已经实现， 这里不再展示
    // ...

  }
  // ... 
}
```

接下来是实现**处理流式输出**

他由 `callModelStreamFinalText` 函数实现。 主要功能是：

1.当等待完模型返回所有 `tool_calls` 信息后， 再调用 `callModel` （之前章节已实现）函数来流式输出最后一轮 assistant 的文本。
如果最后一轮 assistant 不包含 `tool_calls` ， 则直接返回流式输出的文本。
如果最后一轮 assistant 包含 `tool_calls` ， 则返回一个 
`{ kind: "tools"; message: ChatCompletionMessage }` 对象， 这个对象的 `message` 字段是最后一轮 assistant 的完整消息， 这个消息会传递给主循环进行处理。


`callModelStreamFinalText` 函数需要接收 `model`、`messages`、`onDelta` 三个入参。其中 `onDelta` 是流式输出最后一轮 assistant 的文本的回调函数。

同时他异步返回一个 `StreamFinalResult` 类型（因为需要等待模型返回信息）：
这是一个联合类型， 可能返回流式输出的文本， 也可能返回最后一轮 assistant 的完整消息。

```typescript
type StreamFinalResult =
  | { kind: "text"; text: string }
  | { kind: "tools"; message: ChatCompletionMessage };
```

下面看 `callModelStreamFinalText` 的实现： 

核心逻辑就是：
1. 先尝试创建流式对话， 流式对话只要发现有 `tool_calls` 信息， 就直接用 `callModel` 函数来获取完整的 assistant 消息
2. 如果流式对话没有发现 `tool_calls` 信息， 则继续流式输出， 直到流式对话结束

```typescript
// loop.ts

async function callModelStreamFinalText(opts: {
  model: string;
  messages: ChatCompletionMessageParam[];
  onDelta?: (text: string) => void;
}): Promise<StreamFinalResult> {
  // 获取系统提示词， getSystemPrompt 函数前面章节已实现
  const systemPrompt = await getSystemPrompt();
  // 初始化一个空数组， 用于存储流式输出的文本
  const acc: string[] = [];
  // 初始化一个标志， 用于判断最后一轮 assistant 是否包含 `tool_calls`
  let sawToolCalls = false;

  // 先尝试创建流式对话
  const stream = await client.chat.completions.create({
    model: opts.model,
    messages: [{ role: "system", content: systemPrompt }, ...opts.messages],
    // 使用前面章节已实现的 openaiTools 工具
    tools: openaiTools,
    tool_choice: "auto",
    // 设置流式输出
    stream: true,
  });

  // 遍历流式对话的每一段
  for await (const chunk of stream) {
    // delta 是流式对话的每一段的内容
    const delta = chunk.choices[0]?.delta;
    // 重点来了： 只要发现有 `tool_calls` 信息
    // 就跳出循环， 并且不消费流式对话的后续内容
    if (delta?.tool_calls?.length) {
      sawToolCalls = true;
      break;
    }
    // 不带 `tool_calls` 信息， 才会走到这里
    const piece = delta?.content ?? "";
    if (piece) {
      acc.push(piece);
      // 使用 onDelta 回调函数触发 REPL 的流式输出
      opts.onDelta?.(piece);
    }
  }

  // 消费完  stream 之后，如果 sawToolCalls 为 false， 则返回流式输出的文本
  if (!sawToolCalls) {
    return { kind: "text", text: acc.join("") };
  }

  // 对于是 `tool_calls` 的情况，
  // 我们直接调用 callModel 函数来获取完整的 assistant 消息
  const res = await callModel(opts.model, opts.messages);
  const msg = res.choices[0]?.message;
  if (!msg) {
    throw new Error("模型未返回 message");
  }
  return { kind: "tools", message: msg };
}
```

这样 `callModelStreamFinalText` 只负责“流式尝试 + 返回统一结果”，
不负责工具分支编排，避免和主循环重复判断逻辑。

返回 `runAgentConversation` 主循环函数， 接入 `callModelStreamFinalText` 函数， 补齐对流式数据的处理：


```typescript
// loop.ts

export async function runAgentConversation(
  initialMessages: ChatCompletionMessageParam[],
  // 按照上面入参的定义， 这里 opts 存在 streamFinalAssistant 字段
  opts: RunAgentConversationOptions
): Promise<{
  messages: ChatCompletionMessageParam[];
  finalAssistantText: string;
}> {
  const working: ChatCompletionMessageParam[] = [...initialMessages];

  for (let turn = 0; turn < opts.maxTurns; turn++) {
    // 如果 opts.streamFinalAssistant 为 true， 则处理流式输出
    if (opts.streamFinalAssistant) {
      const streamed = await callModelStreamFinalText({
        model: opts.model,
        messages: working,
        onDelta: opts.onAssistantDelta,
      });

      // 如果 streamed.kind 为 "tools"， 
      // 说明调用了 callModel 函数来获取完整的 assistant 消息
      // 我们就通过 onToolRound 改变 REPL 的显示， 并调用 handleToolCalls 函数来处理工具调用
      if (streamed.kind === "tools") {
        const msg = streamed.message;
        const names =
          msg.tool_calls
            ?.filter((t) => t.type === "function")
            .map((t) => t.function.name) ?? [];
        opts.onToolRound?.({ toolNames: names });

        const chunk = await handleToolCalls(msg);
        working.push(...chunk);
        // 终止本层 tool_calls的循环， 进行下一轮循环
        continue;
      }

      // 如果 streamed.kind 为 "text"， 说明是纯文本流式输出
      // 我们就直接将文本添加到 working 数组中， 并返回 
      const text = streamed.text;
      working.push({ role: "assistant", content: text });
      return { messages: working, finalAssistantText: text };
    }

    // 否则继续走非流式输出
    const res = await callModel(opts.model, working);
    const msg = res.choices[0]?.message;
    // 以下的代码前面章节已经实现， 这里不再展示
    // ...

  }
  // ... 
}
```

上面补齐了流式输出的处理逻辑， 并在主循环函数中接入。  并且最终也输出了 `{ messages: working, finalAssistantText: text }` 提供给 `-p` 模式或者历史信息使用。

但是如果你看过上节的代码， 会发现 流处理和非流处理在获取到数据后的逻辑是重复的， 所以我们需要抽一个局部函数来统一处理 `assistant message`，去掉重复逻辑。

下面是处理 `assistant message` 的函数：

```typescript
// loop.ts

// 在 runAgentConversation 函数顶部定义 闭包函数， 用于处理 assistant message
async function handleAssistantMessage(
  msg: ChatCompletionMessage
): Promise<{ done: boolean; text?: string }> {
  if (msg.tool_calls?.length) {
    const names = msg.tool_calls
    .filter((t) => t.type === "function")
    .map((t) => t.function.name);
    opts.onToolRound?.({ toolNames: names });
    const chunk = await handleToolCalls(msg);
    working.push(...chunk);
    return { done: false };
  }
}
```

这个函数的主要功能是：
1. 如果 `assistant message` 包含 `tool_calls` 信息， 则调用 `onToolRound` 函数来改变 `REPL` 的显示， 并调用 `handleToolCalls` 函数来处理工具调用
2. 如果 `assistant message` 不包含 `tool_calls` 信息， 则直接将文本添加到 `working` 数组中， 并返回


下面补齐主循环函数 `runAgentConversation` 中处理 `assistant message` 的逻辑：


```typescript
export async function runAgentConversation(
  initialMessages: ChatCompletionMessageParam[],
  opts: RunAgentConversationOptions
): Promise<{
  messages: ChatCompletionMessageParam[];
  finalAssistantText: string;
}> {
  const working: ChatCompletionMessageParam[] = [...initialMessages];

  for (let turn = 0; turn < opts.maxTurns; turn++) {
    if (opts.streamFinalAssistant) {
      const streamed = await callModelStreamFinalText({
        model: opts.model,
        messages: working,
        onDelta: opts.onAssistantDelta,
      });

      if (streamed.kind === "text") {
        const text = streamed.text;
        working.push({ role: "assistant", content: text });
        return { messages: working, finalAssistantText: text };
      }

      const handled = await handleAssistantMessage(streamed.message);
      if (handled.done) {
        return { messages: working, finalAssistantText: handled.text ?? "" };
      }
      continue;
    }

    // 第 6 章原逻辑（非流式）
    const res = await callModel(opts.model, working);
    const msg = res.choices[0]?.message;
    if (!msg) throw new Error("模型未返回 message");

    const handled = await handleAssistantMessage(msg);
    if (handled.done) {
      return { messages: working, finalAssistantText: handled.text ?? "" };
    }
  }

  throw new Error(`已达到最大轮次 ${opts.maxTurns}，停止以防死循环。`);
}
```

Agentic Loop 的主循环函数已经补齐了流式输出的处理逻辑，下面我们来实现 REPL 的流式输出。

在 `repl-app.tsx` 中， 我们需要接入 `onAssistantDelta` 函数和传入 `streamFinalAssistant: true` 参数。


在 `submit` 中的 `try{}` 中调用 `runAgentConversation` 时，传入 `streamFinalAssistant: true` 参数， 并且使用 `onAssistantDelta` 函数来流式输出：

```typescript
// repl-app.tsx

  // 在 REPLApp 组件内部 更新 submit 函数， 接入 onAssistantDelta 函数和传入 streamFinalAssistant: true 参数。
  
  const submit = async (line: string) => {
    // ... 前面代码未改变 保持第 6 章写法即可。

    try {
      const { messages: after, finalAssistantText } =
        await runAgentConversation(nextMessages, {
          model,
          maxTurns,
          // 打开流式输出
          streamFinalAssistant: true,
          // 使用 onAssistantDelta 函数来流式输出
          onAssistantDelta: (piece) => {
            setRows((prev) =>
              prev.map((row) =>
                row.id === botId
                  ? { ...row, content: row.content + piece, streaming: true }
                  : row
              )
            );
          },
          onToolRound: ({ toolNames }) => {
            setRows((prev) =>
              prev.map((row) =>
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

      // ... 代码未改变， 保持第 6 章写法即可。
    } catch (e) {
      // ... 代码未改变 保持第 6 章写法即可。
    } finally {
      setBusy(false);
    }
  };
```

后面的 `footer`、`setHistory(after)`、`setBusy(false)` 等逻辑保持第 6 章写法即可。


这样 REPL 的流式输出就实现了。

`bun run src/index.ts` 进入 REPL 后， 可以测试流式输出：

1. 问开放题（无工具）：应看到 assistant 内容逐段增长；
2. 问需 `bash` 的问题：先显示“正在调用工具…”，后给总结；
3. 重复两轮：确认 `history` 累加不乱序。

![](https://neptune-ipc.oss-cn-shenzhen.aliyuncs.com/img/Kapture%202026-05-01%20at%2009.15.56.gif)

再测 `-p`：

```bash
bun run src/index.ts -p "当前目录有多少个 .ts 文件？"
```

预期：仍是整段输出，不逐字刷屏。

好的， 本章到这里就结束了。

下一章（第八章）：REPL 展示与交互优化——搭建正式终端 UI 骨架


喜欢我的文章，欢迎关注我的公众号：「闲不住的李先森」。

![公众号二维码](https://neptune-ipc.oss-cn-shenzhen.aliyuncs.com/img/%E6%89%AB%E7%A0%81_%E6%90%9C%E7%B4%A2%E8%81%94%E5%90%88%E4%BC%A0%E6%92%AD%E6%A0%B7%E5%BC%8F-%E7%99%BD%E8%89%B2%E7%89%88.png)
