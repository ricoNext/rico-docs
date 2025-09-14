# 使用 Ultracite 告别 ESLint 和 Prettier 的配置地狱

> “过去十年，我们为代码规范浪费了太多创造力。而 Ultracite 让工具回归本质——沉默地服务，而非喧宾夺主。” —— Shadcn UI 作者推荐

Shadcn UI 的作者遇到问题，相信不是小部分前端开发同学才会遇到的。出于对代码的洁癖，我在过去的开发过程中， 对eslint、prettier、githook、代码保存格式化进行配置是我初始化项目后首先要做的事情，这会花费我大量的时间，因为市面上主流的代码生成脚手架工具大都提供其中一部分能力，比如只提供了 eslint 的配置，没有提供 prettier 的配置，或者是没有 githook 的能力，更别提大部分的脚手架没有提供在 vsCode、zed、cursor 等编辑器中自动格式化的配置、不同的框架需要引用不同的 eslint 插件。

让我们从 Ultracite 是什么开始，看一下 Ultracite 是如何帮忙我们快速解决这些繁杂的配置的。

## Ultracite 是什么？

> [biome](https://biomejs.dev/zh-cn/) 超集，Web 项目开发的一体化工具链, 集合了 eslint 和 prettier 的能力

- 定义 ​：基于 Biome 的零配置开发助手，将代码检查、格式化、Git 流程、AI 协作封装为一体化工具链。
- 定位 ​：非独立工具，而是 Biome（Rust 编写的 ESLint + Prettier 替代品）的“最佳实践封装”。
- 使命 ​：消除前端开发中 80% 的配置成本，让开发者专注业务逻辑而非工具调试

## 传统工具链的困境

1. ​ 性能瓶颈 ​

   ESLint 和 Prettier 基于 JavaScript 单线程运行，在大型项目中格式化速度显著下降，保存文件时肉眼可见延迟。

2. 规则冲突与工具链冗余 ​

   ESLint 与 Prettier 职责重叠引发“格式化战争”：

   - 规则打架 ​：ESLint 的 quotes: ["error", "double"] 与 Prettier 的 singleQuote: true 冲突，需依赖 eslint-config-prettier 禁用冲突规则
   - ​ 插件依赖黑洞 ​：支持 TypeScript 需安装 @typescript-eslint/parser+eslint-plugin-vue+prettier-plugin-tailwindcss 等，版本兼容性问题频发（如 stylelint v15 插件不兼容 Vite）

3. ​ 脚手架生态碎片化，默认规则不统一 ​，配置冲突 ​

   主流脚手架（如 create-react-app、Vue CLI、Vite）虽提供开箱配置，但存在显著问题：

   - 规则割裂 ​：create-react-app 默认启用 airbnb 规则，而 Vue CLI 采用 standard 规范，团队切换技术栈时需重新统一规则
   - 配置覆盖成本高 ​：迁移旧项目时，需手动合并 .eslintrc 与脚手架默认规则，常因 extends 顺序冲突导致校验失效

   > 示例：某团队从 CRA 迁移至 Vite，花费 ​3 小时 ​ 解决 import/no-extraneous-dependencies 规则冲突

4. Git Hook 与编辑器配置的“隐藏成本”​​
   市面脚手架均不内置完整工作流，开发者需手动补全：

   - Git Hook 组装 ​：需独立配置 husky + lint-staged，调试 pre-commit 钩子触发逻辑常耗费 ​1-2 小时
   - 编辑器同步难题 ​：团队成员需统一配置 VSCode 的 settings.json（如 "editor.formatOnSave": true），否则出现“本地不报错，CI 拦截提交”的协作故障

5. ​AI 协作断层 ​

   AI 工具（如 Copilot）无法读取项目规范，需人工粘贴规则，陷入“生成 → 报错 → 调提示词”的循环。

## 开发效率的进化方向

Ultracite 的三大设计原则：

- 零配置 ​：一键初始化，开箱即用规则集覆盖主流场景。
- 高性能 ​：基于 Rust 内核，规避 JS 单线程性能天花板。
- AI 原生 ​：规范自动转化为 AI 可读格式，实现人机协作闭环

## Ultracite 核心能力

1. 极速引擎：Biome 的 Rust 内核 ​

   ​35 倍速度提升 ​：对比 Prettier，Biome 的 Rust 实现让代码格式化从“可感知”变为“无感延迟”。
   ​ 现代规则内置 ​：默认启用 TypeScript 严格模式、React/Next.js 最佳实践、a11y 可访问性检查，覆盖 95% 项目需求。

2. 零配置一体化 ​
   一条命令完成全栈配置：

   ```bash
    npx ultracite init  # 选择包管理器、编辑器、是否启用Git钩子
   ```

   自动完成 ​：

   - 生成 biome.json（规则集）、.vscode/settings.json（编辑器集成）
   - ⚓ 配置 Husky 提交前钩子 + lint-staged 增量检查
   - 🤖 输出 docs/ai-conventions.md（AI 可读规范文档）

3. AI 优先的设计哲学 ​

   - MCP 服务 ​：将代码规范转化为 API 接口，AI 工具实时获取规则细节（如行宽、命名约定），无需人工干预
   - ​ 消除提示词调试 ​：Copilot 直接读取项目规范，生成代码一次通过率提升 60%

   ```json
   // 配置示例：AI工具连接MCP服务
   {
     "mcpServers": {
       "ultracite": {
         "command": "npx",
         "args": ["-y", "mcp-remote", "https://www.ultracite.ai/api/mcp/http"]
       }
     }
   }
   ```

## Ultracite​ 的落地

### 新项目接入

新项目接入（1 分钟启动）​​

```bash
npx ultracite init  # 选择 React + TypeScript 模板
```

执行命令后，会允许选择：

- 项目中使用的包管理器
- 需要配置的编辑器。并根据选择的编辑器生成配置文件， 例如生成 .vscode/settings.json 文件， 并生成基于 biome 自动格式化的配置
- 要创建的 AI 编辑器规则文件。 选择项目中使用的 AI 工具， 基于 AI 工具生成规则（类似 Prompt）,帮助指导 AI 助手编写更优、更一致的代码，遵循最佳实践
- 选择 githook 工具

生成配置后，所有代码保存时自动格式化，提交时触发校验，AI 工具按规范生成代码

### 旧项目改造

> 由于 Ultracite​ 会预设一些配置， 当完成 Ultracite​ 升级后， 代码中会出现一些报错， 为了减少代码改动可能出现的问题， 对于这些报错可以先不用那么着急修复

#### 1. 从 eslint + prettier 迁移到 Biome

> 参考 [从 ESLint 和 Prettier 迁移](https://biomejs.dev/zh-cn/guides/migrate-eslint-prettier/)

以下是操作步骤：

```bash
# 1. 项目中安装 biome 依赖
pnpm add --save-dev --save-exact @biomejs/biome

# 2. 初始化 biome， 生成 biome 的配置文件
pnpm exec biome init

# 3. 迁移 eslint 的配置 (兼容 flat 配置和 旧版本配置)
pnpm exec biome migrate eslint --write

# 4. 迁移prettier 的配置
pnpm exec biome migrate prettier --write
```

#### 2. 从 Biome 升级到 Ultracite​

> [参考](https://www.ultracite.ai/migrate/biome)

```bash
pnpm dlx ultracite init
```

#### 3. 删除现有 eslint、prettier 相关依赖和配置

为了避免编辑器对 Biome 和 eslint、prettier 的配置存在冲突， 需要删除现有 eslint、prettier 的配置

1. 移出相关依赖

   ```bash
   # 移除 ESLint 及相关包
   pnpm remove $(npm ls --depth=0 --json | jq -r '.dependencies | keys[]' | grep eslint)

   # 移除 Prettier 及相关包
   npm uninstall $(npm ls --depth=0 --json | jq -r '.dependencies | keys[]' | grep prettier)
   ```

2. 移出相关配置

移除 prettier 的配置, 例如：.eslintrc.js  .eslintrc.json  .eslintrc.yml  .eslintignore  eslint.config.js

移除 prettier 的配置, 例如：.prettierrc.js  .prettierrc.json  .prettierrc.yml .prettierignore   prettier.config.js

## Ultracite​ 的定位和未来

### 定位： 整合者​

Ultracite 是对 Biome（Rust 编写的 ESLint + Prettier 替代品）的 ​高阶封装，将代码检查、格式化、Git 流程、AI 协作整合为统一工具链，消除配置碎片化问题。

- Biome 的强化层​：继承其 Rust 内核的极速性能（比 Prettier 快 35 倍），同时通过预设规则和自动化流程降低使用门槛
- 开箱即用的“规范即服务”​​：默认规则覆盖 TypeScript 严格模式、React/Next.js 最佳实践、a11y 可访问性检查，满足 95% 现代项目需求
- 生态兼容： 对 Svelte、Solid 等新兴框架的支持，覆盖 Node.js 服务端规范（如文件结构、日志格式），内置合规规则（GDPR 数据安全检测、审计日志规范）

### 未来： AI 协同

- MCP 服务标准化​：Ultracite 已实现将代码规范转化为 API 接口（MCP 服务），供 Copilot 等工具实时读取规则细节。未来将扩展为 ​行业协议，支持 CodeLlama、GPT-Engineer 等更多 AI 工具，避免人工粘贴规则的低效循环
- 规范文档的动态生成：基于项目规则自动更新的 docs/ai-conventions.md 文件，将成为 AI 的“项目记忆库”，实现 ​人机共享上下文，减少 60% 的生成代码修正成本
  
## 总结： 工具链的终极形态是“消失”​​

Ultracite 的定位与未来揭示了前端开发的本质规律：​高效工具应如空气般存在——不可或缺却无需感知。其通过 ​零配置一体化​ 和 ​AI 原生设计，将 Biome 的工程价值转化为开发者的创造力释放，最终实现工具链的“自我消亡”——当开发者不再为配置分心时，工具便完成了终极使命。

```bash
npx ultracite init # 让工具回归服务本质，创造回归核心价值
```
