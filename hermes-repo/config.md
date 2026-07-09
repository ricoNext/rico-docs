# 配置说明

```json
{
  "version": 2,   // 当前版本
  // 存储设置
  "storage": {
    "backend": "file",
    "mcp": {
      "enabled": true,
      "serverUrl": "http://localhost:3000",
      "projectId": "18323b18-fca3-487e-a829-2b05ac143fe0",
      "userId": "e6436c2a-b20d-47eb-92d6-8ca84a2429e6",
      "sync": {
        "mode": "auto",
        "onFlush": {
          "push": true,
          "pull": true
        },
        "retries": 3,
        "timeout": 30000
      },
      "deduplication": {
        "enabled": true,
        "strategy": "team-first",
        "similarityThreshold": 0.9
      }
    }
  },
  "assistants": [
    "claude-code",
    "cursor",
    "codebuddy",
    "codex"
  ],
  "debug": false,
  "llm": {
    "enabled": true,
    "provider": "openai",
    "baseUrl": "https://api.deepseek.com",
    "model": "deepseek-v4-flash",
    "apiKey": "sk-c8cb149f936543fa859b8e8dde7aa4a4",
    "timeoutMs": 60000,
    "maxInputChars": 24000
  },
  "consolidate": {
    "autoArchiveDays": 30,
    "autoFlush": {
      "enabled": true,
      "minPendingSessions": 3,
      "minIntervalMinutes": 30,
      "maxPendingChars": 20000
    }
  }
}

```