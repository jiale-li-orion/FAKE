# FAKE | 身份流亡

> 身份不是你的。是这一轮的。

[![License: MIT](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](./CONTRIBUTING.md)
![Tech](https://img.shields.io/badge/stack-React%2019%20%7C%20Vite%206%20%7C%20Tailwind%204-blue)

一个关于"语言即身份"的社会模拟器。你是一个身份流亡者，在陌生的群聊中，用语言临时构造身份——混进去，活下去，别崩解。

---

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置 API Key（任选一种）
#    方式 A：在浏览器中设置（游戏内 API 配置面板）
#    方式 B：创建 .env 文件
echo 'DEEPSEEK_API_KEY="sk-xxx"' > .env
echo 'GEMINI_API_KEY="xxx"' >> .env

# 3. 启动开发模式（热重载，无需预构建）
npm run dev
# 访问 http://localhost:3000

# 或启动生产模式
npm run build && npm start
```

> **API 说明**：默认使用 DeepSeek API（快速、稳定），不可用时自动降级至 Gemini。至少配置一个即可使用全部功能。
>
> 本项目早期框架和 prompt 原型由 Gemini 辅助生成，后续开发和优化由 DeepSeek 驱动。

---

## 体验指南

### 第一步：进入游戏

打开 `http://localhost:3000`，你会看到黑客终端风格的首页：

```
  FAKE
  身份不是你的。是这一轮的。

  🎭 每轮你 构造一个新的自己 ——身份只有一句话的寿命
  💬 用NPC的词汇和节奏说话，让他们以为 你是自己人
  ❓ 被质疑时不解释， 只重塑 ——你没义务保持前后一致
  💀 身份崩解 = 流亡结束
```

### 第二步：配置 AI 引擎

点击 **API 配置** 展开面板，填入你的 DeepSeek 或 Gemini API Key。密钥仅保存在浏览器本地，不会上传。

### 第三步：选择话题

点击 **进入论坛** → 选择一个话题类别（当代艺术评论 / 都市玄学 / 时尚圈 / 恋爱心理学宗师局 / AI 意识 / 未来学家圆桌会议），或在下方自定义输入你想挑战的话题。

### 第四步：选择难度

| 难度 | 评分映射 | 流亡成功条件 |
|------|-----------|--------------|
| 简单 | 评分**衰减** (×0.3) | 存活 8 轮且未被识破 |
| 中等 | 评分**平衡** (×0.5) | 存活 10 轮且未被识破 |
| 困难 | 评分**剧烈放大** (×2.0) | 存活 10 轮且未被识破 |

难度不改变胜利门槛，只改变**暴露指数增长速度**——同样糟糕的一轮回答，在简单模式涨得慢（×0.3），在困难模式涨得极其快（×2.0）。也意味着同样精彩的一轮，在简单模式更有机会把暴露指数降下来。困难模式下只有持续得分很低 + 频繁抓住NPC破绽才能幸存。

选择难度后，进入 loading 终端屏——AI 正在构建 NPC 身份和群聊场景。几秒后进入游戏主界面。

### 第六步：群聊生存

你会看到：
- **顶部状态栏**：左侧显示领域/话题，右侧显示暴露指数和面具完整度
- **规则卡**（首次进入时显示）：6 条核心生存规则
- **4 个 NPC 串行发言**：术语轰炸机、逻辑狙击手、捧杀艺术家、乐子人，每个都有独特的攻击方式

### 第七步：构造身份，参与对话

在底部输入框输入你的发言。回车提交后：
1. **身份审判**条出现——显示你本轮的表现评估（圈内感 / 身份自洽 / 存在感）
2. 暴露指数变化，面具完整度条随之调整
3. NPC 串行回复，每个之间有 0.5-1 秒的"打字停顿"

> 💡 输入框会根据你的输入内容给出实时建议。
> 暴露指数达到 40% 时颜色开始漂移；65% 开始震颤；85% 显示"即将崩解"。

### 第八步：游戏结束

当暴露指数达到 100% 或触发崩溃条件时，游戏结束。AI 会自动生成一份**身份流亡复盘报告**，包含：

| 章节 | 内容 |
|------|------|
| 🎭 身份构造模式 | 你的身份构造策略分析（话语借用/叙事编织/权威借势……） |
| ⚠️ 身份崩解报告 | 在哪一轮、因为什么语言痕迹而崩解（或流亡成功） |
| 🤖 AI 锐评 | 一句毒舌点评，终端风格 |
| 🏅 称号 | 根据你的表现颁发称号（流沙行者/面具商人/身份噬菌体……） |

分页浏览，按 ← → 翻页。

---

## 核心机制

### 暴露指数（Suspicion）

```
0% ──────────────── 40% ────── 65% ────── 85% ──→ 100%
  emerald (稳定)    rose (裂痕)  rose (渗漏)  fuchsia (崩解)
```

- 每轮回答后，AI 从三个维度评估并调整暴露指数
- 暴露指数可能**降低**（回答精彩、主动进攻、展现元认知）
- 暴露指数≥100% = 游戏结束

### 身份审判（Judge）

三维评分：

| 维度 | 说明 |
|------|------|
| **圈内感** | 你像这个圈子的人吗？用对了话语方式吗？ |
| **身份自洽** | 你构造的身份前后不自相矛盾吗？ |
| **存在感** | 你对讨论有贡献吗？推动了对话还是透明人？ |

加分项（破圈表现）：提出新角度、引导话题方向、同时回应多人、话语主动权、元认知观察。

### 四个 NPC

| NPC | 攻击方式 |
|-----|-----------|
| **术语轰炸机** | 丢冷门术语制造知识迷雾，不解释，不接茬就换更生僻的词 |
| **逻辑狙击手** | 对漏洞有病态嗅觉，先假装认同再精准刺入，优雅撤退 |
| **捧杀艺术家** | 先夸后推翻，"你角度很新啊，但是……" |
| **乐子人** | 拱火、起哄、看戏，把讨论推向更混乱的方向，短句快攻 |

---

## 项目结构

```
src/
├── App.tsx              # 全部 UI 和游戏流程（~1420 行）
├── types.ts             # TypeScript 类型定义
├── services/
│   └── ai.ts            # 全部 AI 引擎（NPC、评测、开场、复盘）
├── main.tsx             # React 渲染入口
└── index.css            # Tailwind CSS 入口
server.ts                # Express 静态文件服务器 / Vite 开发代理
index.html               # HTML 入口
```

### 关键函数速查（ai.ts）

| 函数 | 用途 |
|------|------|
| `generateGameStart(difficulty, customTheme)` | 生成话题、NPC 名字、开场闲聊 |
| `generateSingleNPCReply(npc, topic, round, playerMsg, prevContent, history, difficulty)` | 串行生成单个 NPC 回复 |
| `judgeRound(playerMsg, npcDialogue, npcs, playerHistory, currentSuspicion, round, difficulty)` | 身份审判——三维评分 + 暴露指数变动 |
| `generateGameRecap(field, topic, rounds, finalSuspicion, messages, npcs, judgeHistory)` | 游戏结束复盘报告 |
| `generateTopics()` | LLM 动态生成 6 类 12 个话题 |

### Prompt 体系

所有 prompt 位于 `src/services/ai.ts`：

| Prompt | 位置 | 说明 |
|--------|------|------|
| `NPC_PROFILES` | 第 15-40 行 | 4 个 NPC 人格描述 |
| `INTERACTION_RULES` | 第 206-234 行 | 8 条群聊行为规则 |
| `DISCUSSION_PROTOCOL` | 第 237-267 行 | 7 条深度讨论约束 |
| `buildNPCPrompt()` | 第 270-298 行 | 拼接 NPC prompt（规则 → 人格 → 协议 → 上下文） |
| `judgeRound` prompt | 第 340-409 行 | 身份审判——场景感知 → 圈内感/身份自洽/存在感 → 分数计算 |

---

## 调优指南

### 想让游戏更简单？
- `ai.ts` → 降低 `DIFF_VICTORY` 中的暴露指数阈值
- `ai.ts` → 调整 `judgeRound` prompt 中的加分项幅度（`-5~0` → `-8~0`）

### 想让游戏更难？
- `ai.ts` → 提高 `DIFF_VICTORY` 阈值
- `ai.ts` → 缩小加分项幅度

### 想调整 NPC 性格？
- `NPC_PROFILES` 数组（第 15-40 行）：修改人格描述
- `INTERACTION_RULES`（第 206-234 行）：修改群聊行为规则
- `DISCUSSION_PROTOCOL`（第 237-267 行）：修改讨论深度约束

### 想改变评分维度？
- `judgeRound` prompt（第 340 行起）：修改评分维度、权重、加分逻辑
- `types.ts` 的 `JudgeResult.breakdown`：同步更新字段

---

## 技术栈

| 层 | 技术 |
|-----|------|
| 前端框架 | React 19 + TypeScript |
| 构建 | Vite 6 |
| 样式 | Tailwind CSS 4 |
| 动画 | Motion (ex-Framer Motion) |
| AI SDK | OpenAI SDK (DeepSeek) + Google GenAI (Gemini) |
| 图标 | Lucide React |
| 服务端 | Express (静态文件 + Vite 中间件) |

---

## 已知问题 & 贡献指南

欢迎提交 PR 共同优化。以下列出目前已知的架构漏洞、性能瓶颈和功能缺陷，标注了优先级（🔴严重 🟠高 🟡中 🟢低）和修复难度。

### 🏗 架构

| # | 问题 | 优先级 | 难度 | 说明 |
|---|------|--------|------|------|
| A1 | 单体 `App.tsx` （1900+ 行）无组件拆分 | 🔴 | 大 | 状态、渲染、逻辑全部耦合，每次 `setState` 重跑全部代码。建议拆分为 `HomePage` / `GamePage` / `GameOverPage` |
| A2 | API Key 纯前端明文传输 | 🟠 | 中 | `dangerouslyAllowBrowser: true`，XSS 下可被窃取。建议通过 Express 后端代理 API 请求 |
| A3 | `localStorage` 每次 `setState` 同步写盘 | 🟠 | 小 | 每轮 5+ 次 `JSON.stringify` + `setItem` 阻塞主线程。建议用 `useRef` + debounce 1s 写入 |
| A4 | 无 Error Boundary | 🟠 | 小 | 任何未捕获异常直接白屏。建议在 `main.tsx` 包裹 `<ErrorBoundary>` |
| A5 | 消息数组无限增长无裁剪 | 🟡 | 小 | 20 轮后 DOM 节点 100+，滚动变慢。建议只渲染最近 50 条，完整历史存 `useRef` |
| A6 | 游戏状态无迁移策略 | 🟡 | 小 | `localStorage` 的 `fakeExpert_save` 格式变更后旧存档会崩溃。建议加 `version` 字段 |
| A7 | NPC 链串行依赖 `prevContent` | 🟡 | 大 | 4 个 NPC 必须串行生成（每个需要上一个的回复），已与 judge 并行但链内无法再加速 |

### ⚡ 性能

| # | 问题 | 优先级 | 难度 | 说明 |
|---|------|--------|------|------|
| P1 | 模型推理占用户感知等待的 ~95% | 🔴 | 大 | flash 单次 ~2.7s，串行链累计 ~10.8s + 显示间隔 ~3s。可探索流式输出、更小模型、缓存常见回复 |
| P2 | 零 `React.memo` / `useMemo` / `useCallback` | 🟠 | 大 | 每次键盘输入都重跑 1900 行 JS。建议拆分组件后对 `MessageList`、`ParticleBg` 等加 memo |
| P3 | 60 颗粒子的随机位置每次渲染重新 `Math.random()` | 🟡 | 小 | 打字时不断重算 60 个 inline style。建议移入 `useRef` 仅挂载时生成一次 |
| P4 | 多处 `backdrop-filter: blur()` 叠加 | 🟡 | 小 | header、footer、rules card、glow orbs 同时 blur，GPU 合成层开销大。可用半透明背景替代装饰性 blur |
| P5 | `AnimatePresence` + `layout` 动画在消息列表上 | 🟡 | 中 | 每条新消息触发 FLIP 计算。建议移除消息气泡的 `layout` prop，仅保留 `initial/animate` |
| P6 | Tailwind v4 全量 class 扫描 | 🟢 | 小 | 首次编译扫描 1900 行 JSX。升级到 Tailwind v4.1+ 的 JIT 或配置 `content` 限制范围 |

### 🛡 健壮性

| # | 问题 | 优先级 | 难度 | 说明 |
|---|------|--------|------|------|
| R1 | API 调用无统一超时/重试 | 🟠 | 小 | judge 评审 JSON 解析失败只重试 1 次，二次失败直接崩。建议加 AbortController(15s) + 兜底默认值 |
| R2 | `generateTopics()` 无缓存 | 🟡 | 小 | 每次点击重复调用 LLM，浪费 API 额度。建议 `sessionStorage` 缓存 5min TTL |
| R3 | `generateGameRecap()` 无降级 | 🟡 | 小 | AI 复盘失败时只显示一行文本。建议基于 `judgeHistory` 本地生成基础数据分析 |
| R4 | 无 TypeScript strict 模式 | 🟢 | 小 | `tsconfig.json` `strict: false`，有潜在类型漏洞。开启后需修复约 20-30 处类型错误 |
| R5 | 硬编码投降关键词 `["我认输", "我不知道"]` | 🟢 | 小 | 扩展到可配置的投降短语列表，或改为关键词包含匹配 |

### 🎨 UI / 体验

| # | 问题 | 优先级 | 难度 | 说明 |
|---|------|--------|------|------|
| U1 | 无移动端适配 | 🟠 | 中 | 群聊窗口和复盘页在小屏上布局混乱。建议添加 breakpoint 适配 + 底部输入框吸底 |
| U2 | 无可访问性（a11y） | 🟡 | 中 | 无 ARIA 标签、无键盘导航、无屏幕阅读器支持。建议从 `role` 和 `aria-label` 开始 |
| U3 | 复盘图表 SVG 无数据时空白 | 🟡 | 小 | `timeline.length <= 1` 时不渲染折线，但占位区域仍在。建议加空状态占位图 |
| U4 | 无音效/震动反馈 | 🟢 | 小 | 暴露指数涨跌无感官反馈。可用 Web Audio API 加轻量音效或 `navigator.vibrate` |
| U5 | 无黑暗模式切换——始终暗色 | 🟢 | 小 | 可加浅色主题作为备选，用 CSS 变量切换 |

### 🔬 工程化

| # | 问题 | 优先级 | 难度 | 说明 |
|---|------|--------|------|------|
| E1 | 零测试覆盖 | 🟠 | 中 | 无单元测试/集成测试。建议从 `judgeRound` 的分数计算逻辑和 `computeRecapStats` 开始加 vitest |
| E2 | 无 CI/CD | 🟡 | 小 | 建议加 GitHub Actions：lint → typecheck → build |
| E3 | `motion` 包体内含 `framer-motion` 残留 | 🟢 | 小 | node_modules 中两包共存。检查 `package-lock.json` 去重 |
| E4 | 无 `CHANGELOG` / 版本号管理 | 🟢 | 小 | 建议用 `changesets` 或手动维护 |

---

### 如何贡献

1. **Fork** 本仓库
2. 从上面的问题列表中挑选一个，或自己发现新问题
3. 开 Issue 讨论方案（避免重复劳动）
4. 提交 PR，描述清楚改了什么问题、怎么改的
5. 如果是 UI 改动，请用 `@Designer` 先加载 Open UI Scout skill 出方案再动手

### 快速上手改动建议

| 耗时 | 适合改什么 |
|------|-----------|
| 10 分钟 | A3 localStorage debounce、P3 粒子 useRef、R1 AbortController、R4 tsconfig strict |
| 1 小时 | A4 ErrorBoundary、R2 topics 缓存、E2 CI/CD、U3 空状态 |
| 半天 | A2 API 代理、U1 移动端适配、E1 单元测试 |
| 1-2 天 | A1 组件拆分 + P2 memo、U2 a11y |

---

## 许可证 & 社区

本项目基于 **MIT License** 开源。详见 [LICENSE](./LICENSE)。

- 🐛 [报告 Bug](https://github.com/jiale-li-orion/FAKE/issues)
- 💡 [提议新功能](https://github.com/jiale-li-orion/FAKE/issues)
- 📖 [贡献指南](./CONTRIBUTING.md)
- 🔒 隐私：本项目不收集任何用户数据，API Key 仅保存在浏览器本地 localStorage

---

