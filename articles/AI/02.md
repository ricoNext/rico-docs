# 02 AI 基础调用实现：从原理到代码实践 ​

> 在上篇文章中，我们介绍了 AI 技术从基础调用到自主智能体的应用层演进，后续会基于这个脉络着眼各阶段的关键技术实现，和技术层面的落地。

本文介绍基础 LLM 调用的基本原理和代码实现，包括 Prompt 设计、参数配置、Stream 传输、格式化内容等。 本文涉及的代码存放在 [github](https://github.com/starlee1992/rico/tree/main/apps/docs/articles/AI/02)

## 模型基础调用实现

首先看模型基础调用的应用架构图：

![](https://neptune-ipc.oss-cn-shenzhen.aliyuncs.com/img/20250825151704119.png)

我们需要一个客户端向服务层传输请求，服务层会调用模型层的 API，LLM 会返回结果，服务层再将结果返回给客户端。

服务端这里选择使用 node 实现，为了方便客户端搭建，这里使用 NextJs 举例。 对接的模型使用 doubao 大模型。

由于市面上大部分大模型的 API 调用都兼容 OpenAI API 的格式，这里选用 OpenAI 的 node SDK 访问大模型服务。

openai 实例初始化需要传入 apiKey 和 baseURL，apiKey 和 baseURL 从使用的大模型平台获取。

为了安全起见，不建议将 apiKey 直接写在代码中，而是从环境变量中获取。 在项目中，我们可以在 `env.local` 文件中定义环境变量，以 doubao 的 api 对接为例，在 env 中定义 doubao 的 apikey 和 baseUrl

```bash
DOUBAO_API_KEY=xxxxx
DOUBAO_API_BASE_URL=https://ark.cn-beijing.volces.com/api/v3/
```

安装 openai 的 node SDK：

```bash
pnpm add openai
```

初始化 openai 实例：

```typescript
import OpenAI from "openai";

const openai = new OpenAI({
  baseURL: process.env.DOUBAO_API_BASE_URL,
  apiKey: process.env.DOUBAO_API_KEY,
});
```

创建对话：

```typescript
export async function POST(request: Request) {
  const completion = await openai.chat.completions.create({
    model: "doubao-1-5-pro-32k-250115",
    messages: [{ role: "system", content: "You are a helpful assistant." }],
  });
  return new Response(completion.choices[0].message.content);
}
```

这里 create 方法接收两个参数：model 和 messages。

- model 是模型名称，这里选择 doubao-1-5-pro-32k-250115。 也可以选择其他开通的模型 [模型列表](https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement?LLM=%7B%7D&OpenTokenDrawer=false)

- messages 是对话历史，也就是常听到的 Prompt。 关于 Prompt 下面会做详细的解析， 这里需要知道对于 Prompt 需要传入 role 和 content 两个参数。

客户端调用对话：

当点击按钮时，调用服务端的 API，服务端会返回模型的结果。

```typescript
export default function Home() {
  const [data, setData] = useState("");

  const handleClick = async () => {
    const res = await fetch("/api/chat", {
      method: "POST",
    });
    const data = await res.text();
    setData(data);
  };
  return (
    <div>
      <Button onClick={handleClick}>点击我</Button>
      <div>{data}</div>
    </div>
  );
}
```

#### messages 参数讲解

messages 参数是一个数组，每个元素都是一个对象，对象包含 role 和 content 两个参数， 每个对象也就是一个 Prompt 指令。

Prompt 就像是传统 http 协议中传递给服务端的参数，http server 会根据参数返回不同的结果，LLM 也会根据传入的 prompt 内容返回不同的结果。 但不同与 http server 的是，http server 会定义传入参数，对于非法参数 http server 并不会接受处理，但 LLM 什么参数都会接收和处理，所以为了提升 LLM 处理的准确性，需要向 LLM 传递更加明确的意图指令参数。

所以通用大模型对于 Prompt 参数首先要求传入 role 和 该 role 对应的 content， 也就是和大模型进行对话时， 需要告知大模型的角色定位和角色定位的描述和要求。

同时为了提升 role 的灵活性， 大模型也支持传入多组 role 和 content：

- system 角色： 系统角色，设定模型的行为边界、身份定位和全局规则。
- user 角色： 用户角色，传递用户的具体需求或问题，触发模型生成回复。
- assistant 角色： 助手角色，承载模型的响应内容，维持对话连贯性。

一般我们创建一个新的对话的时候， 应该先传递 system 角色， 系统角色设定模型的行为边界、身份定位和全局规则。后续的问答角色是 user 角色， 而对应的 LLM 的角色是 assistant。

关于 Prompt 的设计是一个分场景的工程化问题， 后续的文章中会继续探究。下面回到 LLM 的调用上，继续补齐基础通信的能力。

#### 多轮对话实现

在上面的代码中，我们只传递了一个固定的 Prompt 指令，大模型会根据这个指令返回结果。但在实际场景中，我们需要输入并持续传递多轮对话指令，我们来看一下这部分的实现。

LLM 接受 prompt 指令是支持多条 message 的， 当多轮对话时， 需要把把上次的对话历史也传递给 LLM， 否则 LLM 会根据当前的指令返回结果，而不是根据对话历史返回结果。

为了实现多轮对话， 我们需要在服务端维护一个对话历史的数组， 每次客户端传递指令时， 把对话历史也传递给 LLM。

```typescript
export type Message = {
  role: "user" | "assistant" | "system";
  content: string;
  index: number;
};

const messages: Message[] = [];

const openai = new OpenAI({
  baseURL: process.env.DOUBAO_API_BASE_URL,
  apiKey: process.env.DOUBAO_API_KEY,
});

// 非流式问答
export async function POST(request: Request) {
  const { prompt } = await request.json();

  messages.push({
    role: "user",
    content: prompt,
    index: -1,
  });

  const completion = await openai.chat.completions.create({
    model: "doubao-1-5-pro-32k-250115",
    messages,
  });

  messages.push({
    ...completion.choices[0].message,
    index: completion.choices[0].index as number,
  } as Message);

  return new Response(JSON.stringify(messages));
}
```

通过使用数组来维护对话历史， 我们可以实现多轮对话。

对于需要新建一轮对话的场景， 我们需要清空对话历史数组。

```typescript
// 清空对话
export async function DELETE(request: Request) {
  messages.length = 0;
  return new Response(JSON.stringify({ message: "对话已清空" }));
}
```

> 在真实的项目中历史会根据业务要求存放到数据库中，并且随着对话轮数的增加， 传递给 LLM 的 token 不断增多， 除了浪费 token 的成本， 还会影响 LLM 的处理速度， 在项目中需要截断或重组简化历史记录， 后续的文章中会详细讨论。

#### 使用流式传输， 提升用户体验

上面的实现是同步调用 LLM，等待 LLM 返回结果后，才会返回给客户端。这会导致用户等待时间过长， 影响用户体验。

openai SDK 支持以数据流的方式把结果返回给客户端， 这样对于 LLM 的回答用户感受到的就是持续的输出。

在 next 中， 我们可以使用 node 原生的 ReadableStream 来实现流式传输。

首先初始化 请求体和 ReadableStream 实例：

```typescript
// 流式问答
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const prompt = searchParams.get("prompt");

  messages.push({
    role: "user",
    content: prompt as string,
    index: Date.now(),
  });

  const stream = new ReadableStream({
    async start(controller) {},
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

ReadableStream 的构造函数中接受 start 参数， 是在实例构造时就会立即执行的处理流传输的方法， 而 start 定义的 controller 参数， 用来控制流的状态和内部队列。

在 start 函数中， 我们可以调用 openai SDK 来获取 LLM 的回复， 并把回复内容写入到流中。

```typescript
const stream = new ReadableStream({
  async start(controller) {
    const completion = await openai.chat.completions.create({
      model: "doubao-1-5-pro-32k-250115",
      messages,
      stream: true,
    });
    let res = "";

    messages.push({
      role: "assistant",
      content: res,
      index: Date.now(),
    });

    for await (const event of completion) {
      const content = event.choices[0].delta.content || "";
      res += content;

      messages[messages.length - 1].content = res;

      // 发送符合 SSE 标准的消息格式
      controller.enqueue(`data: ${JSON.stringify(messages)}\n\n`);
    }

    // 通知前端对话结束
    controller.enqueue("data: close\n\n");
    controller.close();
  },
});
```

前端也需要使用处理流的方式调用 API， 才能正常接收流数据。

```typescript
const handleClick = async (e: React.FormEvent) => {
  setLoading(true);

  // 创建新的 EventSource，对 prompt 进行 URL 编码
  const eventSource = new EventSource(
    `/api/streamingChat?prompt=${encodeURIComponent(prompt)}`
  );

  eventSource.onmessage = (event) => {
    // 直接处理文本数据，不进行 JSON 解析
    if (event.data === "close") {
      setLoading(false);
      eventSource.close();
      setPrompt("");
    } else if (event.data) {
      // 处理流式内容更新
      setData(JSON.parse(event.data));
    }
  };
  // 处理错误事件
  eventSource.onerror = (error) => {
    console.error("EventSource error:", error);
    setLoading(false);
    eventSource.close();
  };
};
```

这样流式传输的多轮对话也实现了，下面是实现的效果：
![](https://neptune-ipc.oss-cn-shenzhen.aliyuncs.com/img/20250829113951_rec_.gif)

#### 格式化返回数据

默认情况下大模型返回的内容格式是 markdown 格式的， 前端展示时需要对 markdown 格式进行解析。

借助 `remark` 可以把 markdown 格式的内容解析成 html 格式的内容。

安装相关依赖

```bash
npm install --save rehype-stringify remark-gfm remark-parse remark-rehype unified
```

封装一个组件， 用来格式化 markdown 格式的内容。

```typescript
import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";

const processor = unified()
  .use(remarkParse)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeStringify);

const MarkdownWrap = ({ children }: { children: string }) => {
  const html = processor.processSync(children).toString();
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
};

export default MarkdownWrap;
```

本文涉及的代码存放在 [github](https://github.com/starlee1992/rico/tree/main/apps/docs/articles/AI/02)

## 总结

在这篇文章中， 我们实现了一个支持多轮对话的基础大模型调用应用。在实际的项目中，对于历史对话的维护会存放在数据库中，同时如果是一个对外提供服务的应用，会结合账号进行对话的维护。
