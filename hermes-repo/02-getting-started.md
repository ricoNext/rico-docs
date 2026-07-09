# 上手指南

在项目 Git 根目录执行：

```bash
npx @riconext/hermes-repo init
```

交互式 `init` 会询问：

- 目标仓库目录
- 要接入哪些助手
- 是否写入 capture 示例模板到 `.memory/templates/`
- 是否现在配置 OpenAI 兼容 LLM

如果在 init 阶段配置 LLM，hermes-repo 会写入 `.memory/config.json`，并在结束摘要中确认 `flush` 是否可用。LLM 不完整时，`capture` 和 `inject` 仍可用，但 `flush` / `autoFlush` 暂时无法整理记忆。

> `flush` / `autoFlush`  非常重要， 他是用大模型对原始对话记忆进行归纳总结，生成记忆地图索引， 并在下一次对话中将记忆地图索引注入到上下文中。

其他 init 参数：

 | 参数 | 说明 |
  |------|------|
  | `-y, --yes` | 非交互模式，使用默认选项（跳过所有询问） |
  | `-f, --force` | 覆盖已存在的脚手架文件（不删除 captures 等内容） |
  | `-C, --cwd <dir>` | 目标目录，默认为当前工作目录 |
  | `--tools <ids>` | 逗号分隔的助手 id，如 `claude-code,cursor`（**必须与 `-y` 合用**） |
  | `--mcp-project-id <id>` | 非交互模式：启用 MCP 并绑定团队项目 UUID |
  | `--mcp-server-url <url>` | 非交互模式：MCP 服务地址，默认 `http://localhost:3000` |
  | `--mcp-user-id <id>` | 非交互模式：MCP 用户 UUID，用于推送记忆时关联用户 |

使用示例：

```bash
# 交互式初始化
  hermes-repo init

  # 非交互模式，使用默认助手
  hermes-repo init -y

  # 非交互模式，指定多个助手
  hermes-repo init -y --tools claude-code,cursor

  # 非交互模式 + 启用 MCP
  hermes-repo init -y \
    --mcp-project-id "uuid-here" \
    --mcp-user-id "user-uuid-here" \
    --mcp-server-url "http://localhost:3000"

  # 强制覆盖已有文件
  hermes-repo init -y -f

  # 在指定目录初始化
  hermes-repo init -y -C /path/to/repo
```

  注意：
  - --tools 参数需要与 -y 一起使用，否则会报错
  - MCP 相关参数只在非交互模式下有效


之后正常使用助手：

1. 会话开始时，hook 运行 `inject` 注入 `MEMORY.md` 导航摘要。
2. 会话结束时，hook 运行 `capture` 进行原始会话捕获。
3. 积累了原始捕获且已配置 LLM 后，可等待 `autoFlush` 自动整理，或手动执行：

```bash
npx @riconext/hermes-repo flush
```

## LLM 配置

配置 LLM 后才能启用整理能力。`flush`、`capture-llm`、`autoFlush` 都依赖 LLM。

hermes-repo 使用 OpenAI 兼容的 Chat Completions 接口：

```json
{
  "llm": {
    "enabled": true,
    "provider": "openai",
    "baseUrl": "https://api.deepseek.com",
    "model": "deepseek-v4-flash",
    "apiKey": "你的密钥",
    "timeoutMs": 60000,
    "maxInputChars": 24000,
    "mode": "async"
  },
  "consolidate": {
    "autoFlush": {
      "enabled": true,
      "minPendingSessions": 3,
      "minIntervalMinutes": 30,
      "maxPendingChars": 20000
    }
  }
}
```

注意事项：

- `enabled`、`apiKey`、`baseUrl`、`model` 都必须完整配置，LLM 调用才会发生。
- `baseUrl` 是服务根地址；hermes-repo 会请求 `{baseUrl}/chat/completions`。
- 不直接支持 Anthropic 或 Gemini 原生接口。需要通过 OpenAI 兼容网关使用。
- `.memory/config.json` 可能包含 `apiKey`，默认会被 gitignore。
- 新项目默认开启 `consolidate.autoFlush.enabled`。LLM 配置完整后，capture 达到阈值时可以后台自动触发 `flush`。
- 如果关闭 `autoFlush`，需要在积累 capture 后手动运行 `npx @riconext/hermes-repo flush`。

手动处理排队的捕获升级：

```bash
npx @riconext/hermes-repo capture-llm --flush
```

## MCP 服务器使用

hermes-repo 提供了 MCP 服务器（`@riconext/hermes-mcp-server`）用于团队级别的记忆管理。它暴露 MCP 工具用于列出项目、添加记忆、搜索和提升记忆，同时提供 REST API 供 Web UI 使用。


MCP 服务会在两个地方使用： 

- 执行 `flush` 时：程序会向 MCP 服务拉取团队记忆并推送个人记忆
- 对话中：可以直接在对话中让编程工具调用 MCP 服务提供的工具拉取团队记忆到项目中或者推送记忆到服务中等

为了能在 `flush` 环节能够推送和拉取团队记忆， 需要在 `init` 阶段配置 MCP 的服务。 

有几个关键内容需要填写：

```json
"serverUrl": "mcp 服务的地址",
"projectId": "在 mcp 上面录入的当前项目的projectId",
"userId": "在 mcp 上创建的当前项目的userId",
```

为了能够在对话中自动获取 MCP 服务的工具， 也可以手动添加 MCP 服务, 该服务提供一下工具：

### MCP 工具

- `list_projects` — 列出可用项目
- `add_memory` — 向项目添加新记忆
- `search_memories` — 按关键词搜索记忆
- `promote_memory` — 将记忆提升到团队级别
- `delete_memory` — 删除记忆

### 部署 MCP 服务器

MCP 服务需要自行部署，才能够使用， 将项目拉取到本地， 进行一下操作：

1. **启动 PostgreSQL**

   在仓库根目录：

   ```bash
   docker compose up -d
   ```

2. **配置环境变量**

   ```bash
   cd packages/mcp-server
   cp .env.example .env
   ```

   关键变量：

   - `DATABASE_URL` — PostgreSQL 连接字符串
   - `MCP_TRANSPORT` — `httpStream`（默认）或 `stdio`
   - `DEV_AUTH_BYPASS=true` — 开发模式跳过 JWT 认证

3. **初始化数据库**

   ```bash
   bun run db:push
   bun run db:seed
   ```

   默认管理员账号：`admin` / `admin`（角色：SUPER_ADMIN）

4. **启动 MCP 服务**

   ```bash
   bun run dev:mcp   # 从仓库根目录
   # 或
   cd packages/mcp-server
   bun run dev
   ```

   服务运行在 `http://localhost:3000`。健康检查：`http://localhost:3000/health`。

### 接入 Claude Code

在 Claude Code 配置中添加 MCP 服务器：

```json
{
  "mcpServers": {
    "hermes": {
      "url": "http://localhost:3000/mcp",
      "headers": {
        "X-User-Id": "00000000-0000-4000-8000-000000000001"
      }
    }
  }
}
```

请将 `/path/to/hermes-repo` 替换为实际的仓库路径。


## 部署 UI

Web UI（`@riconext/hermes-ui`）提供了用于浏览项目和记忆的仪表盘。

1. **配置环境变量**

   ```bash
   cd packages/ui
   cp .env.example .env.local
   ```

   编辑 `.env.local`：

   ```bash
   NEXT_PUBLIC_API_URL=http://localhost:3000
   ```

2. **启动 UI**

   从仓库根目录：

   ```bash
   bun run dev:ui
   ```

   或从 UI 包目录：

   ```bash
   bun run dev
   ```

   访问 UI：`http://localhost:3001`

3. **生产构建**

   ```bash
   cd packages/ui
   bun run build
   bun run start
   ```

> MCP 服务不是必须的， 但是如果你需要在团队中使用 `@riconext/hermes-repo` 的记忆管理能力， 就需要自行部署 MCP 服务了。
