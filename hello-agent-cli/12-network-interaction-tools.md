# Hello Agent CLI（12）： agent 网络搜索引擎搭建

这是一套从 0 到 1 构建 Agent CLI 的分阶段实战教程。你会沿着  
`REPL -> Agentic Loop -> Context Builder -> 工具系统 -> 工程化`  
的路线逐章推进，最终做出一个可运行、可扩展、可发布的完整工具。

**技术栈**：`TypeScript + Node.js/Bun + React Ink + OpenAI 兼容 API`

仓库在这：[hello-agent-cli](https://github.com/ricoNext/hello-agent-cli)。  
作者博客：<https://www.riconext.cn/>。

1. 每章的代码按照分支存放在仓库中，分支名称为 `chapter-xxx`，本章代码分支 **`chapter-12`**。
2. 本章的代码改动会基于上节的代码进行改动，所以你可以直接查看上一节的代码学习，跟着本章的节奏一步步实现。

---

![](https://neptune-ipc.oss-cn-shenzhen.aliyuncs.com/img/20260515115208417.png)

第 11 章我们在工具框架上挂载了 `glob` 与 `grep`，让 Agent 获得了结构化、只读、跨平台的代码搜索能力。至此 Agent 已经能自主操作本地文件系统——但它的"感知边界"还局限在磁盘之内。

本章继续扩展两类高频能力：

- **`web_fetch`** — 抓取一个公开 URL，将网页内容转换为 Markdown 返回；
- **`web_search`** — 用关键词搜索互联网，得到标题 + URL + 摘要列表，然后使用 `web_fetch` 抓取最相关的网页内容。

加上已有的文件系统与 `bash`，这两项与本地工具共同扩展 Agent 的**信息获取**边界，便于查文档、搜 changelog、对照 Release Notes 等。

**角色分工**：

- **`web_fetch`** → 读取指定 URL 的完整文档；
- **`web_search`** → 关键词搜索，得到候选 URL 列表。

二者挂在同一个 `AGENT_TOOLS` 注册表里，`handleToolCalls` 不需要任何改动。

## 为什么不直接用 `bash curl`？

直觉上，`bash curl https://example.com` 也能获取网页，为什么要单独定义 `web_fetch`？

| 维度 | `bash curl` | `web_fetch` |
|------|-------------|-------------|
| 输出格式 | 原始 HTML / 二进制 | **Markdown**（结构化文本，LLM 友好） |
| 参数声明 | 自由文本命令，flag 易出错 | 结构化 JSON 参数 |
| 内容截断 | 不截断，可能撑爆上下文 | **主动截断**，防止超 token |
| 错误语义 | 需解析 HTTP 状态码 | 统一返回错误字符串 |
| 权限审核 | 每次需确认 bash 执行 | 可独立设置放行策略 |

`web_search` 的逻辑类似：模型如果自己拼 curl 去搜索引擎，不同 API 的 flag 差异、鉴权方式差异会产生大量不稳定输出；而 `web_search("query")` 的语义完全一致。

`claude code` 的实现中，`WebFetchTool` 使用内部 `getURLMarkdownContent` 将 HTML 转换为 Markdown 并通过 Haiku 模型二次提炼；`WebSearchTool` 调用 Anthropic 平台原生的 `web_search_20250305` Beta 工具，由服务端直接返回搜索结果（也就是说 `claude code` 的 `web_search` 是模型自带的能力）。  

这篇文章采用等价但更通用的方案：`web_fetch` 借助 **Jina AI Reader**（无需 API Key），`web_search` 借助 **tavily API**（需要 `tavily API Key`）。

关于 `web_fetch` 只是请求 url 路径，也可以使用原生的 `fetch` api 来实现，但是需要自己实现 HTML 转 Markdown 的功能，并且需要自己实现内容截断的功能，所以这里选择使用 `Jina AI Reader` 来实现。

而 `web_search` 有别于模型训练的知识库， 需要通过搜索引擎（百度、 Google、 Bing）来获取最新的相关信息， 自建引擎不是个人能力范围内能完成的， 市面上转给 AI 用的搜索引擎 API 有 [tavily](https://tavily.com/)、[Brave Search](https://brave.com/)、[Serper](https://serper.dev/)、[Firecrawl](https://www.firecrawl.dev/) 等， 本文选择使用 `tavily API` 来实现(目前 AI 应用开发领域最主流的搜索 API 之一, [LangChain](https://python.langchain.com/) 推荐)。

## 代码实现

### 1. 实现 `web_fetch`

新建 `src/tools/web-fetch-tool.ts`。

**核心实现**：调用 [Jina AI Reader](https://jina.ai/reader/) API（`https://r.jina.ai/{url}`）。它能将任意公开网页转换为干净的 Markdown，无需 API Key，是许多 Agent 框架的默认选择。

按照 `AgentTool` 接口定义 `name` 和 `toOpenAI`：

```typescript
// src/tools/web-fetch-tool.ts
import type { AgentTool } from "./types";

const MAX_CHARS = 20_000;

export const webFetchTool: AgentTool = {
  name: "web_fetch",
  toOpenAI: () => ({
    type: "function",
    function: {
      name: "web_fetch",
      description:
        "获取指定 URL 的网页内容，以 Markdown 格式返回。" +
        "用于读取文档、博客文章、Release Notes 等公开网页。" +
        "获取内容后可结合 web_search 返回的 URL 深入阅读。",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "要获取的完整 URL（须为公开可访问的网页）",
          },
        },
        required: ["url"],
      },
    },
  }),
  async execute(args: unknown) {},
};
```

再实现 `execute`。

分为三步实现：校验 URL → 调用 Jina API → 截断并返回。

```typescript
// src/tools/web-fetch-tool.ts
import type { AgentTool } from "./types";

const MAX_CHARS = 20_000;

export const webFetchTool: AgentTool = {
  // ... 上面已实现，忽略展示
  async execute(args: unknown) {
    const a = args as { url?: unknown };
    const url = typeof a.url === "string" ? a.url.trim() : "";
    if (!url) {
      return "错误：url 为空";
    }

    // 简单校验 URL 格式
    try {
      new URL(url);
    } catch {
      return `错误：无效的 URL "${url}"`;
    }

    const start = Date.now();
    let response: Response;
    try {
      // Jina AI Reader：将任意网页转换为 Markdown（无需 API Key）
      response = await fetch(`https://r.jina.ai/${url}`, {
        headers: { Accept: "text/markdown" },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return `错误：网络请求失败 — ${msg}`;
    }

    if (!response.ok) {
      return `错误：HTTP ${response.status} ${response.statusText}`;
    }

    const text = await response.text();
    const durationMs = Date.now() - start;

    // 截断，防止撑爆上下文
    const truncated = text.length > MAX_CHARS;
    const content = truncated ? text.slice(0, MAX_CHARS) : text;

    return JSON.stringify(
      {
        url,
        code: response.status,
        durationMs,
        content: truncated
          ? `${content}\n…(内容已截断，原始长度 ${text.length} 字符)`
          : content,
      },
      null,
      2
    );
  },
};
```

`MAX_CHARS = 20_000` 对应约 5,000 tokens，足够容纳一篇中等长度的文档，同时不至于单次请求耗尽 `context window`。实际生产实现（如 `claude code` 的 `MAX_MARKDOWN_LENGTH`）会根据模型上下文窗口动态调整。

### 2. 实现 `web_search`

新建 `src/tools/web-search-tool.ts`。

**核心实现**：调用 [tavily Search API](https://docs.tavily.com/)，无需爬虫，直接返回结构化的 JSON 搜索结果。需在环境变量中配置 `TAVILY_API_KEY`（免费层每月 2,000 次查询）。

首选需要前往 [tavily Search API](https://docs.tavily.com) 注册并 获取 API Key。

然后在项目中安装 `@tavily/core` 包：

```bash
bun add @tavily/core
```

在项目中创建 `.env` 文件，并添加以下内容：

```bash
# .env 文件
# 注册 tavily API 会获得一个 API Key，这里填写你的 API Key。
TAVILY_API_KEY=your_tavily_api_key
```
接下来定义工具接口： 

先定义接口和 `toOpenAI`：

```typescript
// src/tools/web-search-tool.ts
import type { AgentTool } from "./types";

export const webSearchTool: AgentTool = {
  name: "web_search",
  toOpenAI: () => ({
    type: "function",
    function: {
      name: "web_search",
      description:
        "在互联网上搜索关键词，返回最相关的网页列表（标题 + URL + 摘要）。" +
        "适合查找最新信息、技术文档、Changelog 等。" +
        "拿到 URL 后可用 web_fetch 深入读取完整内容。",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "搜索关键词",
          },
        },
        required: ["query"],
      },
    },
  }),
  async execute(args: unknown) {},
};
```

先单独抽出 `tavilySearch` 辅助函数，清晰分离 API 调用逻辑， 然后再实现 `execute`：

[tavily search 调用参数参考](https://docs.tavily.com/reference/search)： 


```typescript
// src/tools/web-search-tool.ts
const MAX_RESULTS = 5;

async function tavilySearch(query: string): Promise<string> {
  const apiKey = process.env.TIVLY_API_KEY;
  if (!apiKey) {
    return JSON.stringify({
      error: "未配置 TIVLY_API_KEY，无法执行搜索",
      hint: "请在 https://docs.tavily.com 申请 API Key，并设置环境变量 TIVLY_API_KEY",
    });
  }

  const tvly = tavily({ apiKey });

  // 官方返回值只定义了200的返回值类型， 
  // 404 等返回类型未定义， 这里使用联合类型定义了返回值
  const res = (await tvly.search(query, {
    limit: MAX_RESULTS,
  })) as TavilySearchResponse & { detail: { error: string } };


  if (!res.results) {
    return `错误：搜索 API 返回 ${res.detail?.error ?? "未知错误"}`;
  }

  const results = res.results ?? [];

  if (results.length === 0) {
    return JSON.stringify({ query, results: [], message: "未找到相关结果" });
  }

  return JSON.stringify(
    {
      query,
      results,
    },
    null,
    2
  );
}

```

然后是定义 execute 函数：

```typescript
export const webSearchTool: AgentTool = {
  // ... 上面已实现，忽略展示
  async execute(args: unknown) {
    const a = args as { query?: unknown };
    const query = typeof a.query === "string" ? a.query.trim() : "";
    if (!query) {
      return "错误：query 为空";
    }
    try {
      return await tavilySearch(query);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return `错误：搜索失败 — ${msg}`;
    }
  },
};
```

当 `TAVILY_API_KEY` 未配置时，`execute` 会返回含 `hint` 字段的 JSON 字符串，模型读到后会把申请步骤告知用户——这比直接抛异常的用户体验好得多。

### 3. 注册到 `AGENT_TOOLS`

修改 `src/tools/registry.ts`，在文件头部增加两个 import，并把新工具加入列表：

```typescript
// src/tools/registry.ts
// 新增 import
import { webFetchTool } from "./web-fetch-tool";
import { webSearchTool } from "./web-search-tool";

export const AGENT_TOOLS: readonly AgentTool[] = [
  // ... 原有工具，忽略展示
  webFetchTool,
  webSearchTool,
];

// toolMatchesName / findToolByName / findAgentTool / toolsToOpenAI 保持不变
```

`toolsToOpenAI()` 会自动把两个新工具的 JSON Schema 带进 API 请求，`runToolCall` 的分发逻辑完全不需要改动。

### 4. 更新系统提示词

在 `src/agent/loop.ts` 的 `BASE_SYSTEM` 末尾补充网络工具的使用规范：

```typescript
// src/agent/loop.ts

const BASE_SYSTEM =
  "你是命令行里的编码助手。" +
  "需要列文件、统计数量、跑测试时，优先用工具获取真实输出，不要编造结果。" +
  "若用户明确要求「只转大小写、不访问磁盘」，优先使用 `uppercase` 工具。" +
  "如果你需要修改文件，请先使用 `read_file` 工具读取文件，然后使用 `edit_file` 工具修改文件。" +
  "查找文件名时使用 `glob` 工具（而非 bash find 或 ls）；" +
  "在文件内容中搜索时使用 `grep` 工具（而非 bash grep）；" +
  "运行测试、构建、git 操作等需要「执行」语义的任务才使用 `bash` 工具。" +
  // 新增：网络工具使用规范
  "需要获取指定网页内容时使用 `web_fetch`（传入完整 URL）；" +
  "需要查找最新资讯或不熟悉的技术时使用 `web_search`（传入关键词），" +
  "搜到合适的 URL 后再用 `web_fetch` 深入阅读。";
```

## 两个工具的协作示意

完成注册后，工具调用链路如下：`web_fetch` 与 `web_search` 完全复用第 9 章已有的 `runToolCall` 分发和 `handleToolCalls` 并发执行，没有新的控制流分支。

```
用户: "搜索 Bun 1.2 breaking changes，并抓取一条官方说明做摘要"
    │
    ▼ runAgentConversation
模型 → tool_calls: [web_search("Bun 1.2 breaking changes")]
    │
    ▼ handleToolCalls（并发执行）
web_search → tavily Search API → 返回若干条搜索结果（URL + 摘要）
    │
    ▼ 继续对话
模型 → tool_calls: [web_fetch("https://bun.sh/blog/bun-v1.2")]
    │
    ▼ handleToolCalls
web_fetch → Jina Reader → 返回页面 Markdown（截断后）
    │
    ▼ 继续对话
模型 → 生成自然语言摘要与建议
```

到这里就完整了本章代码的实现：[完整代码](https://github.com/ricoNext/hello-agent-cli/tree/chapter-12)


期望行为（顺序取决于模型策略）：

1. **`web_search`** 先查 `"Bun 1.2 breaking changes"` 得到候选 URL；
2. **`web_fetch`** 深读其中最相关的一篇 Release Notes 或文档页；
3. 助手用自然语言给出摘要与升级建议。

也可以验证 pipe 模式：

```bash
bun run src/index.ts -p "抓取 https://bun.sh/docs 首页，总结要点"
```

---

到目前为止我们已完成：**在既有工具调度链路上挂载 `web_fetch` 与 `web_search`，扩展 Agent 的联网信息获取能力**。

下一章为 **REPL 展示与交互优化（二）**：在 Ink REPL 上统一实现 **`ask_user`** （等待用户输入， 确认是否执行某操作） 等需模态输入的交互

感谢阅读。若你对本系列感兴趣，欢迎关注公众号「闲不住的李先森」，我们会持续更新 AI
全栈与 Agent 工程实践。

![公众号二维码](https://neptune-ipc.oss-cn-shenzhen.aliyuncs.com/img/%E6%89%AB%E7%A0%81_%E6%90%9C%E7%B4%A2%E8%81%94%E5%90%88%E4%BC%A0%E6%92%AD%E6%A0%B7%E5%BC%8F-%E7%99%BD%E8%89%B2%E7%89%88.png)
