# 08 - REPL 展示与交互优化——搭建正式终端 UI 骨架

> 本章将完成 Agent CLI 的基础部分搭建， 完成本章你就拥有一个 MVP 版本的 Agent CLI 工具。你可以给你的 CLI 工具取一个合适的名称， 并发布到 npm 上。

这是一套从 0 到 1 构建 Agent CLI 的分阶段实战教程。你会沿着  
`REPL -> Agentic Loop -> Context Builder -> 工具系统 -> 工程化`  
的路线逐章推进，最终做出一个可运行、可扩展、可发布的完整工具。

**技术栈**：`TypeScript + Node.js/Bun + React Ink + OpenAI 兼容 API`

仓库在这：[hello-agent-cli](https://github.com/ricoNext/hello-agent-cli)。  
作者博客：<https://www.riconext.cn/>。

1. 建议按章节顺序读，每章末有对应分支；
2. 每章的代码按照分支存放在仓库中， 分支名称为 `chapter-xxx`， 本章的代码分支为 `chapter-08`。
2. 本章的代码改动会基于上节的代码进行改动，所以你可以直接基于上一节的代码学习，跟着本章的节奏一步步实现。

---

在第 7 章中， 我们把链路打通：REPL 与 `-p` 共用 `runAgentConversation`，并在 REPL 拿到最后一轮流式文本体验。

但现在的 UI 仍是“能用版本”：消息、输入、状态都堆在同一列里，缺少正式产品该有的布局层次与交互分区。

这一章我们先把**正式 REPL 组件骨架**搭好，为后面 CLI 拥有更多能力搭建 UI 展示基础：

+ 顶部状态区（模型、模式、会话状态）；
+ 中间消息区（消息列表 + 工具进行中提示）；
+ 底部输入区（输入框 + hint + 快捷键提示）；
+ 右下角或底部次级状态（token 粗算、耗时、错误提示占位）。

最终达到的效果差不多是这个样子的：

![](https://neptune-ipc.oss-cn-shenzhen.aliyuncs.com/img/20260502135718390.png)

根据上面的规划我们把已经实现的 `REPLApp` 拆分成 4 个展示组件：


```typescript
// src/ui/repl-app.tsx

// REPLApp （结构示意）
export function REPLApp(...) {
  return (
    <Box flexDirection="column">
      <ReplHeader ... />
      <ReplMessages ... />
      <ReplComposer ... />
      <ReplFooter ... />
    </Box>
  );
}
```

职责划分是：

+ `ReplHeader`：模型名、模式、忙闲状态、会话标签；
+ `ReplMessages`：消息列表、streaming 光标、工具进行中行；
+ `ReplComposer`：输入框、键位提示、焦点态；
+ `ReplFooter`：本轮耗时、token 粗算、最近错误。

这样后续要改滚动、虚拟列表、快捷键，不会污染业务逻辑。

进入代码实现部分。

## 代码实现

代码实现部分我们分为两部分进行， 首先是定义 4 个展示组件， 然后是改造 `REPLApp` 组件。

### 定义 4 个展示组件

新增 `src/ui/repl-layout.tsx` 文件， 用于存放 4 个展示组件

#### 定义 `ReplHeader` 组件

没有什么复杂的逻辑， 就是根据 props 渲染对应的 UI 元素。

```tsx
// src/ui/repl-layout.tsx
import { Box, Text } from "ink";

// ReplHeader 组件参数定义
export interface ReplHeaderProps {
  busy: boolean;
  model: string;
  statusText: string;
}

export function ReplHeader({ model, busy, statusText }: ReplHeaderProps) {
  return (
    <Box borderStyle="single" paddingX={1}>
      <Text bold color="cyan">
        hello-agent-cli
      </Text>
      <Text> · model={model}</Text>
      <Text> · {busy ? "busy" : "idle"}</Text>
      <Text> · {statusText}</Text>
    </Box>
  );
}
```

#### 定义 `ReplFooter` 组件

```tsx
// src/ui/repl-layout.tsx

// ReplFooter 组件参数定义
export interface ReplFooterProps {
  lastError?: string;
  showFooter: boolean;
  statusText: string;
}

export function ReplFooter({
  showFooter,
  statusText,
  lastError,
}: ReplFooterProps) {
  if (!showFooter) {
    return null;
  }
  return (
    <Box borderStyle="single" paddingX={1}>
      <Text dimColor>Status: {statusText}</Text>
      {lastError ? <Text color="red">{` · Error: ${lastError}`}</Text> : null}
    </Box>
  );
}
```

#### 定义 `ReplMessages` 组件

`ReplMessages` 组件的职责是根据 `rows` 数组渲染消息列表， 我们为了将模型输出和工具执行进行区分， 所以需要在已经定义的 `ChatRow` 类型基础上扩展出 `status` 行：

为了不影响  `Role` 类型的定义， 我们使用联合类型来定义 `ChatRow` 类型：
这样 ChatRow 既可以表示用户消息， 也可以表示工具执行状态。

```typescript
// src/types/chat-row.ts
import type { Role } from "./message";

export type ChatRow =
  | {
      id: string;
      role: Role;
      content: string;
      streaming?: boolean;
    }
  | {
      id: string;
      role: "status";
      kind: "tool";
      content: string;
    };
```

然后就是定义 `ReplMessages` 组件：

```tsx
// src/ui/repl-layout.tsx
import { Box, Text } from "ink";
import type { ChatRow } from "../types/chat-row";

export interface ReplMessagesProps {
  rows: ChatRow[];
}

export function ReplMessages({ rows }: ReplMessagesProps) {
  return (
    <Box borderStyle="single" flexDirection="column" paddingX={1}>
      {rows.map((row) => {
        // 工具调用状态
        if (row.role === "status") {
          return (
            <Text color="yellow" key={row.id}>
              · {row.content}
            </Text>
          );
        }
        // 用户或助手消息
        return (
          <Text dimColor={row.role === "user"} key={row.id}>
            {row.role === "user" ? "> " : "◆ "}
            {row.content}
            {"streaming" in row && row.streaming ? "▋" : ""}
          </Text>
        );
      })}
    </Box>
  );
}
```

#### 定义 `ReplComposer` 组件

`ReplComposer` 组件的职责是根据 `input` 和 `busy` 状态渲染输入框和提示文本。


```tsx
// src/ui/repl-layout.tsx
export interface ReplComposerProps {
  busy: boolean;
  input: string;
}

export function ReplComposer({ input, busy }: ReplComposerProps) {
  return (
    <Box borderStyle="single" flexDirection="column" paddingX={1}>
      <Text>{`> ${input}`}</Text>
      <Text dimColor>
        {busy ? "Thinking..." : "Hints: /help /clear /exit · Ctrl+C 退出"}
      </Text>
    </Box>
  );
}
```


下面我们改造 `REPLApp` 组件， 将 4 个展示组件组合起来。

### 改造 `REPLApp` 组件

对于已经实现的 `REPLApp` 组件的逻辑层， 我们不做改动， 只改动 UI 层， 我们需要将 4 个展示组件组合起来。

下面代码只展示改动部分：

增加 4 个展示组件的导入：
```tsx
// src/ui/repl-app.tsx

// 。。。省略未改动代码。。。
import {
  ReplHeader,
  ReplMessages,
  ReplComposer,
  ReplFooter,
} from "./repl-layout";
// 。。。省略未改动代码。。。
```

新增 UI 状态类型定义：

```typescript
// src/ui/repl-app.tsx

// UI 状态定义
type ReplUIState = {
  focus: "composer" | "messages";
  showFooter: boolean;
  // 状态文本， 用于显示状态信息
  statusText: "ready" | "thinking" | "tool-running" | "error" | "cleared";
  // 最近错误， 只有当状态为 'error' 时才有值
  lastError?: string;
};
```

在 `REPLApp` 组件中定义 ui 状态变量, 类型为 `ReplUIState`：

```typescript
// src/ui/repl-app.tsx

// REPLApp 内部状态定义
const [ui, setUI] = useState<ReplUIState>({
  focus: "composer",
  showFooter: true,
  statusText: "ready",
});
```





```tsx
type ReplUIState = {
  focus: "composer" | "messages";
  showFooter: boolean;
  statusText: string;
  lastError?: string;
};

export function REPLApp({
  model,
  maxTurns,
}: {
  model: string;
  maxTurns: number;
}) {
  const { exit } = useApp();
  const [input, setInput] = useState("");
  const [rows, setRows] = useState<ChatRow[]>([]);
  const [history, setHistory] = useState<ChatCompletionMessageParam[]>([]);
  const [busy, setBusy] = useState(false);
  const [ui, setUI] = useState<ReplUIState>({
    focus: "composer",
    showFooter: true,
    statusText: "ready",
  });

  const runSlash = (line: string): boolean => {
    const cmd = line.slice(1).trim().split(SLASH_CMD_SPLIT)[0]?.toLowerCase();
    if (cmd === "exit" || cmd === "quit") {
      exit();
      return true;
    }
    if (cmd === "clear") {
      setRows([]);
      setHistory([]);
      setUI((s) => ({ ...s, statusText: "cleared", lastError: undefined }));
      return true;
    }
    if (cmd === "help") {
      setRows((r) => [
        ...r,
        { id: uid(), role: "assistant", content: "命令：/exit /clear /help" },
      ]);
      return true;
    }
    return false;
  };

  const submit = async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed || busy) return;

    if (trimmed.startsWith("/")) {
      if (!runSlash(trimmed)) {
        setRows((r) => [
          ...r,
          { id: uid(), role: "assistant", content: `未知命令：${trimmed}` },
        ]);
      }
      return;
    }

    const userRow: ChatRow = { id: uid(), role: "user", content: trimmed };
    const botId = uid();
    const userMsg: ChatCompletionMessageParam = {
      role: "user",
      content: trimmed,
    };
    const nextMessages = [...history, userMsg];
    const t0 = performance.now();

    setRows((r) => [
      ...r,
      userRow,
      { id: botId, role: "assistant", content: "", streaming: true },
    ]);
    setBusy(true);
    setUI((s) => ({ ...s, statusText: "thinking", lastError: undefined }));

    try {
      const { messages: after, finalAssistantText } =
        await runAgentConversation(nextMessages, {
          model,
          maxTurns,
          streamFinalAssistant: true,
          onToolRound: ({ toolNames }) => {
            setRows((prev) => [
              ...prev,
              {
                id: uid(),
                role: "status",
                kind: "tool",
                content: `正在调用工具：${toolNames.join(", ") || "(未知)"}`,
              },
            ]);
            setUI((s) => ({ ...s, statusText: "tool-running" }));
          },
          onAssistantDelta: (piece) => {
            setRows((prev) =>
              prev.map((row) =>
                row.id === botId && row.role === "assistant"
                  ? { ...row, content: row.content + piece, streaming: true }
                  : row
              )
            );
          },
        });

      const sec = ((performance.now() - t0) / 1000).toFixed(1);
      const footer = `\n[完成，约 ${roughTokens(finalAssistantText)} tokens，${sec}s]`;

      setRows((prev) =>
        prev.map((row) =>
          row.id === botId && row.role === "assistant"
            ? {
                ...row,
                content: `${finalAssistantText}${footer}`,
                streaming: false,
              }
            : row
        )
      );
      setHistory(after);
      setUI((s) => ({ ...s, statusText: "ready" }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setRows((prev) =>
        prev.map((row) =>
          row.id === botId && row.role === "assistant"
            ? { ...row, content: `错误：${msg}`, streaming: false }
            : row
        )
      );
      setUI((s) => ({ ...s, statusText: "error", lastError: msg }));
    } finally {
      setBusy(false);
    }
  };

  useInput((ch, key) => {
    if (busy) return;
    if (key.return) {
      void submit(input);
      setInput("");
      return;
    }
    if (key.backspace || key.delete) {
      setInput((s) => s.slice(0, -1));
      return;
    }
    if (key.ctrl && (ch === "c" || ch === "C")) {
      exit();
      return;
    }
    if (ch && !key.ctrl && !key.meta) {
      setInput((s) => s + ch);
    }
  });

  return (
    <Box flexDirection="column">
      <ReplHeader model={model} busy={busy} statusText={ui.statusText} />
      <ReplMessages rows={rows} />
      <ReplComposer input={input} busy={busy} />
      <ReplFooter
        showFooter={ui.showFooter}
        statusText={ui.statusText}
        lastError={ui.lastError}
      />
    </Box>
  );
}
```

这个版本已经满足“正式骨架”目标：

+ 分区清晰；
+ 流式文本与工具状态解耦；
+ 留有后续交互扩展入口。

---

## 五、状态分层：业务状态 vs UI 状态

现有状态可以先分为两类：

```typescript
type ReplDomainState = {
  rows: ChatRow[];
  history: ChatCompletionMessageParam[];
  busy: boolean;
};

type ReplUIState = {
  focus: "composer" | "messages";
  showFooter: boolean;
  viewportHeight: number;
  statusText: string;
  lastError?: string;
};
```

原则：

+ **DomainState** 只描述“事实”（消息、历史、是否请求中）；
+ **UIState** 只描述“怎么展示”（焦点、可见性、临时提示）。

这一层一旦分开，后续你接权限弹窗、消息选择器会轻松很多。

---

## 六、把“工具进行中”从文本拼接改成结构化消息

第 7 章里常见写法是把“正在调用工具：xxx”拼到 assistant 文本里。  
本章建议开始结构化：

```typescript
type ChatRow =
  | { id: string; role: "user"; content: string }
  | { id: string; role: "assistant"; content: string; streaming?: boolean }
  | { id: string; role: "status"; kind: "tool"; content: string };
```

然后 `onToolRound` 里追加 `role: "status"` 的行，而不是污染 assistant 正文。

收益：

+ assistant 最终文本更干净（便于复制/导出）；
+ status 行未来可折叠/隐藏；
+ 为“工具时间线”做了兼容铺垫。

---

## 七、输入交互：保留现在可用能力，先补“正式入口”

本章先保持第 7 章输入能力：

+ 回车提交；
+ `/help`、`/clear`、`/exit`；
+ `Ctrl+C` 退出。

同时补一个标准交互框架（先占位）：

```typescript
useInput((ch, key) => {
  // 1) Global shortcuts（预留）
  // 2) Focused area routing（composer/messages）
  // 3) Domain actions（submit/slash）
});
```

即使第二层目前只有 composer，也先把路由框架搭好。

---

## 八、建议的最小改造顺序（不会断层）

1. 先把 `REPLApp` 拆成 Header/Messages/Composer/Footer 四块；
2. 再引入 `ReplUIState`，保留原 `rows/history/busy` 不动；
3. 把 `onToolRound` 改成写结构化 `status` 行；
4. 最后补样式细节（颜色、分隔线、提示文本）。

这样每一步都可运行，不会出现“重构一半无法演示”。

---

## 九、验证清单

```bash
cd tours/hello-agent-cli
export OPENAI_API_KEY='sk-...'
bun run src/index.ts
```

验证点：

1. 顶部、消息区、输入区、底部四区都可见；
2. 提问开放题时，assistant 在消息区流式增长；
3. 提问需工具的问题时，先出现工具状态行，再出现回答；
4. `/clear` 只清消息区，不破坏 header/footer；
5. `busy=true` 时输入区提示明确（如 `Thinking...`）。

---

## 十、与 claude-js REPL 的关系

你不需要在本章就复刻全部能力（权限弹窗、消息选择器、复杂时间线等），
但应该先对齐它的“架构意图”：

+ **执行层和渲染层分离**；
+ **消息区独立为可扩展视口**；
+ **状态显示与输入区不是临时文本拼接**。

后续章节做权限、任务、压缩时，会直接受益。

---

## 小结

1. 本章核心不是“加新功能”，而是“把 REPL 结构定型”；  
2. 保持第 7 章执行链路不变，只升级展示与交互骨架；  
3. 未实现能力先占位，避免未来返工；  
4. 通过分区 + 状态分层，为后续章节预留稳定扩展点。  

下一章（第 9 章）进入 **工具框架**：定义统一 Tool 接口与注册执行机制。

```bash
# 第 9 章预告
bun run src/index.ts -p "把字符串 hello 转为大写"
```

[本章节代码仓库](https://github.com/ricoNext/hello-agent-cli/tree/chapter-08)
