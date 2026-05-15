# OpenSpec 最新 OPSX 工作流使用教程

[OpenSpec 仓库](https://github.com/Fission-AI/OpenSpec)

之前写过两篇文章介绍了 `OpenSpec` 如何使用的， 目前 `OpenSpec` 提供了全新的工作流 `OPSX`， 我尝试使用了一段时间，这里给大家分享一下我的使用心得。还有一些会踩到的坑。

所谓 **OPSX**，官方的定位是：

**面向变更的、可迭代的流体工作流**——不再是「锁死在某一阶段」的线性流程，而是**随时可做**的若干动作（创建、实现、更新、归档等）；
依赖关系用来表示**哪些产物已经就绪**，而不是强制你下一步只能做什么。

旧版工作流是这样的： **`计划阶段 -> 实现阶段 -> 完成阶段`**

**当实现完成后，我们无法回退到计划阶段。**

```text
(旧版工作流):
  （计划阶段） ────────► （实现阶段） ────────► （完成阶段）
      │                    │
      │   （无法回退）       │
      └────────────────────┘
```

而新版本 **OPSX** 工作流是这样的：

```text
proposal 提案 ──► specs 规范 ──► design 设计 ──► tasks 任务 ──► implement 实现
```

关键原则：

- **是行动，而非阶段**——命令是你可以执行的操作，而不是你被困住的阶段。
- **依赖关系是赋能工具**——它们展示的是可能性，而不是下一步需要做什么。

除此之外还有下面的问题：

- **指令是硬编码的**——指令都在包内的 TypeScript 代码中，你无法更改它们。
- **要么全有，要么全无**——一条大命令创建一切，无法测试各个部分。无法只创建部分产物。
- **固定结构**——所有人的工作流程都一样，没有自定义选项。
- **黑匣子**——当人工智能输出结果不佳时，你无法调整提示信息。

OPSX 则把规则外置：**`schema.yaml` + `templates/*.md`** 等可由项目或用户调整，改完即生效，便于实验与迭代。
这和「离散产物 + 依赖图」是一套设计；默认用户用 **core** 配置即可，需要更多粒度时再开 **expanded**。

---

## 二、核心理念（一句话 + 我自己的理解）

OpenSpec 产品侧常提的方向，大意如下（便于你扫一眼）：

```text
灵活而非死板 → 迭代而非瀑布 → 简单而非复杂 → 兼顾存量项目 → 从个人到企业均可使用
```

我个人的理解：**它不要求你瀑布式写满文档**，而是给 AI 和人类一份**落在仓库里的、可对齐的变更产物**；实现过程中发现设计或规格不对，**回到产物上改**再继续 `apply`，比「阶段锁死」更贴近真实开发。

依赖在图里是 **enabler（就绪即可做）**，不是「过完这一关才能看下一关」的硬门禁——官方强调：**Actions, not phases**。

---

## 三、安装与初始化

环境要求：**Node.js 20.19.0 及以上**（以仓库 `package.json` / 文档为准时可再核对）。

```bash
# 全局安装 CLI
npm install -g @fission-ai/openspec@latest

# 进入项目根目录初始化
cd your-project
openspec init
```

`openspec init` 会在项目里生成约定目录，并在 **`.claude/skills/`**（或当前工具链对应的等价路径）下生成 **skills**，供 AI 编程助手自动发现。初始化过程中可创建**项目级配置** `openspec/config.yaml`（可选，但官方推荐）。

---

## 四、工作流配置：core 与 expanded

- **core（默认）**：`/opsx:propose`、`/opsx:explore`、`/opsx:apply`、`/opsx:sync`、`/opsx:archive`。
- **expanded**：在 core 基础上增加 `/opsx:new`、`/opsx:continue`、`/opsx:ff`、`/opsx:verify`、`/opsx:bulk-archive`、`/opsx:onboard` 等更细粒度命令。

切换方式（与官方一致）：

```bash
openspec config profile   # 选择 expanded 等配置
openspec update           # 把配置应用到项目里的 AI 指令
```

---

## 五、常见工作流模式（据官方 workflows.md）

本节对应官方 [Workflows（workflows.md）](https://github.com/Fission-AI/OpenSpec/blob/main/docs/workflows.md)；安装入门见仓库 [Getting Started](https://github.com/Fission-AI/OpenSpec/blob/main/docs/getting-started.md)，命令参数见 [Commands](https://github.com/Fission-AI/OpenSpec/blob/main/docs/commands.md)。

### 理念小结（Actions, not phases）

传统做法像被锁在「计划 → 实现 → 完成」的相位里；真实工作常会回头改规格或设计。**OPSX** 用 **行动** 代替 **阶段**：依赖只表示「哪些产物已就绪」，不强制你下一步只能做什么。默认 schema 下可记这样一条链（与官方插图一致）：

```text
proposal ──► specs ──► design ──► tasks ──► implement
```

产物链路由 **schema** 定义；要自定义工作流见官方 [Customization](https://github.com/Fission-AI/OpenSpec/blob/main/docs/customization.md)。

### core（默认）典型一笔画

官方在 `workflows.md` 里给出的 **`core` 最常见路径** 是：

```text
/opsx:propose ──► /opsx:apply ──► /opsx:sync ──► /opsx:archive
```

若提案前还需要摸底、比方案，可在最前插入 **`/opsx:explore`**（与下文「探索型」一致，也与**第九节**「`/opsx:explore`」呼应）。

### expanded：Quick Feature（需求清晰，只想快做）

适合小到中型功能、明确的 bug 修复等：

```text
/opsx:new ──► /opsx:ff ──► /opsx:apply ──► /opsx:verify ──► /opsx:archive
```

**示意对话**（压缩自官方示例，非真实日志）：

```text
你: /opsx:new add-logout-button

AI:  已创建 openspec/changes/add-logout-button/
     可创建：proposal

你: /opsx:ff

AI:  正在生成全部规划产物...
     ✓ proposal.md
     ✓ specs/
     ✓ design.md
     ✓ tasks.md
     可以开始实现。

你: /opsx:apply

AI:  按任务实施中...
     ✓ 在 header 加入登出按钮
     ✓ 清理会话
     ✓ 增加确认对话框
     全部任务完成。

你: /opsx:archive

AI:  ✓ 已合并 specs
     ✓ 变更已归档
```

### expanded：Exploratory（需求不清，先调研）

需要先想清楚再落盘产物时：

```text
/opsx:explore ──► /opsx:new ──► /opsx:continue ──► ... ──► /opsx:apply
```

官方示例路径：先 `explore` 查性能瓶颈 → 选定方向 → `new` 开变更 → 多次 `continue` 依次生成 proposal、specs 等 → 再 `apply`。适合性能优化、排错、架构取舍、需求模糊。

### expanded：Parallel Changes（并行多条变更）

```text
变更 A: /opsx:new ──► /opsx:ff ──► /opsx:apply（进行中）
                                        │
                                   切换上下文
                                        │
变更 B: /opsx:new ──► /opsx:ff ─────────► /opsx:apply
```

被打断时（例如做着 `add-dark-mode` 被拉去修登录跳转）可为打断项新建并走完一小条，再回到原变更；继续某个变更时可用 **`/opsx:apply add-dark-mode`** 这类带变更名的调用（与官方示例一致）。

多条变更都已做完、要一起收口时，用 **`/opsx:bulk-archive`**。官方说明：bulk-archive 会检测多条变更是否触及同一规格路径；若有冲突，会结合**仓库里实际已实现情况**等做处理（细节以官方文档与当时 CLI/技能输出为准）。

**示意**（非真实日志）：

```text
你: /opsx:bulk-archive

AI:  发现 3 个已完成变更：add-dark-mode、fix-login-redirect、update-footer
     正在检查 specs 冲突…
     ⚠ add-dark-mode 与 update-footer 都改到 specs/ui/
     …（分析后给出合并/归档顺序建议）
     是否全部归档？

你: Yes

AI:  ✓ 三个变更已归档（specs 合并顺序以实际输出为准）
```

### 完成一条变更：推荐收尾顺序（expanded）

官方推荐把「实现 → 校验 → 归档」串起来：

```text
/opsx:apply ──► /opsx:verify ──► /opsx:archive
                    │                 │
             对照产物做体检      必要时提示同步 specs
```

- **`/opsx:verify`**：从 **Completeness（完整性）**、**Correctness（正确性）**、**Coherence（一致性）** 三方面对照产物检查实现；**不会**强行阻止归档，但会列出 critical / warnings，便于你在归档前补缺。
- **`/opsx:archive`**：完成归档；若 delta specs 尚未同步到主线，可能**询问是否现在 sync**；任务未全部完成时**未必硬拦**，但会**警告**（以实际技能模板为准）。

**verify 三维度**（与官方表格一致，中文简述）：

| 维度 | 校验什么 |
| --- | --- |
| Completeness | 任务是否完成、需求是否落地、场景是否覆盖等 |
| Correctness | 实现是否符合规格意图、边界与错误态等 |
| Coherence | 设计是否在结构与命名上体现、模式是否自洽等 |

### `/opsx:ff` 还是 `/opsx:continue`？

| 情况 | 更宜用 |
| --- | --- |
| 需求清晰、准备开干 | `/opsx:ff` |
| 仍在摸索，想逐步审每一类产物 | `/opsx:continue` |
| 想在写 specs 前多轮改 proposal | `/opsx:continue` |
| 时间紧、要快 | `/opsx:ff` |
| 变更复杂，想控节奏 | `/opsx:continue` |

**经验法则**（官方原文意译）：**能一口气说清范围 → `ff`；边做边想清 → `continue`。**

### 与第十节呼应：官方「深色模式」例子

workflows 在「何时更新 vs 新开」下举了三类判断（可与第十节决策树对照）：

- 「还要支持自定义主题」等 → 往往算 **新开变更**（范围膨胀成另一件事）。
- 「系统偏好检测比预想的难」→ 多属 **更新**（意图仍是深色模式）。
- 「先 ship 切换，偏好设置放后面」→ 常见是 **先更新收紧范围**，归档后再 **新开** 后续增强。

### 官方 Best Practices（工作流向）

1. **一条变更只做一类事**：功能 X + 大范围重构 Y，官方建议拆成两条，便于评审、归档与回滚。
2. **拿不准就先 `/opsx:explore`**，再创建产物。
3. **归档前尽量 `/opsx:verify`**（expanded），减少「关了单子才发现跑偏」。
4. **变更命名要可读**：`add-dark-mode` 好过 `feature-1`、`update`、`wip`；方便 `openspec list` 扫一眼。

### 命令速查（何时用谁，据 workflows 表意译）

| 命令 | 用途 | 何时用 |
| --- | --- | --- |
| `/opsx:propose` | 创建变更并生成规划产物 | `core` 默认快捷路径 |
| `/opsx:explore` | 想问题、调研 | 需求不清、要查证 |
| `/opsx:new` | 新建脚手架 | expanded、要显式控制产物节奏 |
| `/opsx:continue` | 创建下一产物 | expanded、一步步来 |
| `/opsx:ff` | 一次生成全部规划产物 | expanded、范围已想清楚 |
| `/opsx:apply` | 按任务写代码 | 准备实现 |
| `/opsx:verify` | 对照产物校验实现 | expanded、归档前体检 |
| `/opsx:sync` | 合并增量规格 | **core 内可选**（与 opsx.md 一致）；按需插在 `apply` 与 `archive` 之间 |
| `/opsx:archive` | 收尾归档 | 工作完成 |
| `/opsx:bulk-archive` | 批量归档 | expanded、并行多条一起收口 |

---

## 六、项目配置（`openspec/config.yaml`）

项目配置用来设**默认 schema**、往各产物指令里**注入项目上下文**、以及按产物 ID 写**额外规则**。官方示例字段包括：

| 字段 | 含义 |
| --- | --- |
| `schema` | 新建变更时的默认 schema（如 `spec-driven`） |
| `context` | 多行字符串，会注入到各 artifact 的说明前（官方说明有大小上限，当前文档为 **50KB**） |
| `rules` | 按 artifact ID（如 `proposal`、`specs`）写的附加规则列表 |

**Schema 优先级**（高到低）：CLI 参数 `--schema` → 变更目录里的 `.openspec.yaml` → `openspec/config.yaml` → 默认 `spec-driven`。

**spec-driven 下的 artifact ID**（默认）：`proposal`、`specs`、`design`、`tasks`。

校验与排错（常见）：`rules` 里写了不存在的 artifact 会告警；可用 `openspec schemas --json` 查看各 schema 的 artifact ID；配置文件须为 **`openspec/config.yaml`**（不是 `.yml`）；`context` 过大需压缩或改为链接外部文档。

---

## 七、命令一览（与官方表对齐）

| 命令 | 作用 |
| --- | --- |
| `/opsx:propose` | 创建变更并**一步生成**进入实现前所需的规划产物（默认快捷路径） |
| `/opsx:explore` | 想思路、查问题、澄清需求；**不要求**先落盘成 proposal 结构 |
| `/opsx:new` | 新建变更脚手架（expanded） |
| `/opsx:continue` | 按依赖创建**下一个**产物（expanded） |
| `/opsx:ff` | 快进生成全部规划产物（expanded） |
| `/opsx:apply` | 按 `tasks.md` 等实施；多变更时可指定变更名，否则由对话上下文推断，不能确定时会请你选 |
| `/opsx:verify` | 对照产物做实现校验（expanded） |
| `/opsx:sync` | 将**增量规格**同步回主线（core 内、**可选**） |
| `/opsx:archive` | 完成后归档；官方说明会在适当时机**提示是否需同步 specs** |
| `/opsx:bulk-archive` | 批量归档多个已完成变更（expanded） |
| `/opsx:onboard` | 端到端引导走一遍（expanded） |

---

## 八、默认路径怎么用（core）

1. **先想清楚**：`/opsx:explore` —— 不写结构也行，当作「想清楚 + 看仓库」的对话；有结论后再进入提案。
2. **对齐规划**：`/opsx:propose` —— 默认一键拉出 proposal / specs / design / tasks（具体文件名与目录以 schema 为准）。
3. **落地代码**：`/opsx:apply` —— 按任务推进；中途若发现设计或规格不对，**改产物文件再继续**，这是官方强调的流体迭代。
4. **（可选）同步规格**：`/opsx:sync` —— 把变更侧的规格差异合回主线规格视图（与「只在变更里改」的分工有关，细节以官方描述为准）。
5. **收尾**：`/opsx:archive` —— 归档；若需要，按提示处理 specs 同步。

若启用了 expanded，创建阶段可改用 `/opsx:new` + `/opsx:continue` 或 `/opsx:ff`，再同样进入 `apply` / `sync` / `archive`。

---

## 九、`/opsx:explore`（我仍然建议新手多用）

`/opsx:explore` 在 **core** 里就有，**不会在磁盘上生成** proposal 那一套结构；更像**定向侦察 + 对话式理清需求**。官方建议：insights 固化后，再切到 `/opsx:propose`（默认），或 expanded 下的 `/opsx:new` / `/opsx:ff`。

**语法：**

```text
/opsx:explore [主题]
```

**示意对话**（非真实日志，仅感受流程）：

```text
你: /opsx:explore

AI:  你想探索什么？

你: 移动端的认证该怎么处理？

AI:  让我看看你现有的认证设置...
     [分析代码库]

     Web 端用的是 session 认证。
     移动端有三个主要方案：

     1. JWT Token（无状态，可离线）
     2. OAuth2（需要第三方登录的话）
     3. 扩展现有 session（简单但需联网）

     你的 API 已经配了 CORS。你倾向于哪个方向？

你: 用 JWT 吧，能开始一个变更吗？

AI:  随时可以。运行 /opsx:propose add-jwt-auth 开始。
```

---

## 十、何时「改现有变更」vs「新开变更」

官方给了一套启发式（此处为中文压缩版，判据仍以 `opsx.md` 原文为准）：

**倾向继续改同一变更（UPDATE）**：意图未变，只是执行细节或边界在补；范围**缩小**（先 ship MVP）；实现中发现设计与现实略有偏差，但大目标仍是「同一件事」。

**倾向新开变更（NEW）**：**意图根本变了**；范围膨胀到几乎算另一件工作；原变更已经可以**干净做完并归档**，新工作适合单独开一条线（类似 git：同一功能线上多 commit， genuinely 新功能则新开分支）。

原则（官方原句意译）：**更新保留上下文；新开带来清晰度**——若「修补史」仍有价值就更新；若从头写更清楚就新开。

---

## 十一、OPSX 与旧版 `/openspec:*`（Legacy）对比

| | Legacy（如 `/openspec:proposal`） | OPSX（`/opsx:*`） |
| --- | --- | --- |
| **结构** | 偏「一大份 proposal」 | 离散产物 + 依赖 |
| **工作流** | 线性阶段感强 | 流体动作，可来回改产物 |
| **迭代** | 回到规划层较别扭 | 实现中可改 specs/design/tasks 再继续 |
| **定制** | 结构相对固定 | Schema 驱动，可扩展 artifact |

官方结论大意：**真实工作不是线性的，OPSX 不再假装它是。**

---

## 十二、CLI 常用命令

| 命令 | 用途 |
| --- | --- |
| `openspec init` | 项目内初始化 OpenSpec / skills |
| `openspec update` | 升级包后刷新项目内 AI 指令 |
| `openspec config profile` | 切换 core / expanded 等工作流配置 |
| `openspec status --change "name"` | 查看某变更下各产物状态（官方 Tips 推荐） |
| `openspec schemas` / `openspec schemas --json` | 列出 schema / 查 artifact ID |
| `openspec schema init` / `fork` / `validate` / `which` | 自定义或调试 schema（见官方「Schemas / Custom Schemas」） |

---

## 十三、升级

```bash
npm install -g @fission-ai/openspec@latest
cd your-project && openspec update
```

---

## 十四、最佳实践与官方 Tips（摘录）

（**工作流模式、收尾顺序、`ff`/`continue` 抉择等**以**第五节**为准；本节是模型与日常习惯的补充。）

1. **大事前先 `/opsx:explore`**，再 `propose` 或 `new`/`ff`，减少返工。
2. **已经想清楚、变更不大**：可考虑 `/opsx:ff`；**还在摸索**：用 `/opsx:continue` 一块一块出。
3. **`apply` 中途发现不对**：先改对应产物（如 `design.md`），再继续 `apply`。
4. **`tasks.md` 用勾选框**跟踪进度；不确定进展时用 `openspec status --change "..."`。
5. **模型与上下文**：规划与实现尽量用好模型；大改前整理或新开对话，避免旧聊天干扰（个人习惯，非官方强制）。

---

## 十五、与其他方案对比（简要）

| 对比对象 | OpenSpec / OPSX 的定位 |
| --- | --- |
| **GitHub Spec Kit** | 功能完整但偏重、门禁更严；OpenSpec 相对轻、迭代自由度更高 |
| **AWS Kiro** | 与特定 IDE / 模型绑定更深；OpenSpec 更偏「与现有工具链拼接」 |
| **纯聊天** | 需求易散；OpenSpec 用轻量规范换可核对性 |

---

## 十六、其他说明

- **许可证**：以仓库为准（常见为 MIT）。
- **支持工具**：官方称覆盖多种 AI 编程助手，具体列表见仓库。
- **遥测**：若 CLI 默认开启匿名统计，可用环境变量关闭（以仓库 README / 文档为准，例如 `OPENSPEC_TELEMETRY=0`）。
- **进阶**：自定义 schema 存放位置、DAG 状态机、与 Legacy 架构对比等，直接读 [opsx.md](https://github.com/Fission-AI/OpenSpec/blob/main/docs/opsx.md)。

---

## 十七、一句话总结

装包 → `openspec init`（可选配 `openspec/config.yaml`）→ **`/opsx:explore` 理清** → **`/opsx:propose` 对齐产物** → **`/opsx:apply` 落地** → 需要时 **`/opsx:sync`** → **`/opsx:archive` 收尾**；要更细粒度就 `openspec config profile` 切到 expanded，用 `new` / `continue` / `ff` / `verify` / `bulk-archive` / `onboard` 组合使用。

---

## 十八、扩展命令场景详解（expanded）

启用方式见第四节。下面各节与官方「Commands / Usage」一致，仅作中文场景说明。

### 1. `/opsx:new` —— 只搭脚手架

只建变更目录与元数据（如 `.openspec.yaml`），**不**自动填满 proposal 全文。适合你要**自己掌控每一步**或换非默认 schema。

### 2. `/opsx:continue` —— 一次产出一个块

按依赖顺序**每次生成一个**产物；中间可人工改文件再下一步。

### 3. `/opsx:ff`（Fast-Forward）

规划阶段已想清楚时，**一次生成** proposal / specs / design / tasks（以 schema 为准），再整体审阅后 `apply`。

### 4. `/opsx:verify`

从完整性、正确性、一致性等角度对照规划产物检查实现（报告级别等以 skill 模板为准）。

### 5. `/opsx:bulk-archive`

多个变更同时收尾时使用。

### 6. `/opsx:onboard`

官方引导走完整端到端流程，适合第一次跟做。

### 快速决策表

| 你的情况 | 推荐命令 |
| --- | --- |
| 第一次上手 | `/opsx:onboard`（expanded） |
| 需求或代码不熟 | `/opsx:explore` → 再 `propose` 或 `new`/`ff` |
| 默认快捷路径 | `propose` → `apply` →（按需）`sync` → `archive` |
| 想搭骨架再填 | `/opsx:new` → `/opsx:continue` |
| 已想清楚要快出规划 | `/opsx:new` → `/opsx:ff` |
| 多变更同时收尾 | `/opsx:bulk-archive` |
| 实现完做体检 | `/opsx:verify` |

---

## 十九、完整命令全景图

| 层级 | 命令 | 作用 |
| --- | --- | --- |
| **core** | `/opsx:explore` | 调研、澄清、比方案；不强制生成变更结构 |
| **core** | `/opsx:propose` | 创建变更并生成规划产物（默认快捷路径） |
| **core** | `/opsx:apply` | 按任务实施；可多变更 |
| **core** | `/opsx:sync` | 增量规格同步回主线（可选） |
| **core** | `/opsx:archive` | 归档；可能提示 specs 相关操作 |
| **expanded** | `/opsx:new` | 新建脚手架 |
| **expanded** | `/opsx:continue` | 逐产物创建 |
| **expanded** | `/opsx:ff` | 快进生成全部规划产物 |
| **expanded** | `/opsx:verify` | 校验实现与产物 |
| **expanded** | `/opsx:bulk-archive` | 批量归档 |
| **expanded** | `/opsx:onboard` | 引导式教程 |

---

## 参考链接

- [OpenSpec（Fission AI）](https://github.com/Fission-AI/OpenSpec)
- [OPSX Workflow（docs/opsx.md）](https://github.com/Fission-AI/OpenSpec/blob/main/docs/opsx.md)
- [Workflows 工作流模式（docs/workflows.md）](https://github.com/Fission-AI/OpenSpec/blob/main/docs/workflows.md)

我认为，这类工具的价值在于给 AI 协作加一层**可对齐、可回退修改**的薄规范；用多深仍取决于项目与团队节奏。

（完）
