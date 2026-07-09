# 配置说明

```json
{
  // 支持的 AI 编程工具
  "assistants": [
    "claude-code",
    "cursor",
    "codebuddy",
    "codex"
  ],

  // 是否打开日志， 打开日志会把日志存放在  .memory/logs/
  "debug": false,
  // llm 配置
  "llm": {
    // 是否开启
    "enabled": true,
    // 供应商
    "provider": "openai",
    "baseUrl": "https://api.deepseek.com",
    "model": "deepseek-v4-flash",
    // akikey
    "apiKey": "",
    // 请求超时（毫秒）
    "timeoutMs": 60000,
    // 单次输入字符上限
    "maxInputChars": 24000
  },
  // 巩固 / 自动 flush / 归档 配置
  "consolidate": {
    // 超过 N 天的条目可归档
    "autoArchiveDays": 30,
    "autoFlush": {
      // 是否在 capture 后自动 flush --if-needed
      "enabled": true,
      // 待处理 session 数阈值， 超过这个数字后就会进行 flush 操作
      "minPendingSessions": 3,
      // 距上次巩固最短间隔（分钟）
      "minIntervalMinutes": 30,
      // 待处理总字符阈值
      "maxPendingChars": 20000

      // 满足任一阈值且 LLM 可用时才会真正巩固。
    }
  },
  "mcp": {
    // 是否启用 MCP 同步
    "enabled": true,
    // MCP 服务地址 
    "serverUrl": "",
    // 项目 UUID
    "projectId": "",
    // 用户 UUID
    "userId": "",
    "sync": {
      // 同步模式： auto / manual / off 
      "mode": "auto",
      "onFlush": {
        // lush 时推送
        "push": true,
        // flush 时拉取
        "pull": true
      },
      // 重试次数
      "retries": 3,
      // 超时（毫秒）
      "timeout": 30000
    }
  }
}


```