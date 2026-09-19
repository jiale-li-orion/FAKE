# FAKE | 身份流亡

> To fake is to make.
>
> 你没有被给一个身份。你必须用语言伪造一个。

[![License: MIT](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](./CONTRIBUTING.md)
![Tech](https://img.shields.io/badge/stack-React%2019%20%7C%20Vite%206%20%7C%20Tailwind%204-blue)

一个关于「语言即身份」的社会模拟器。你是身份流亡者，在陌生群聊中用语言伪造专家身份——混进去，活下去，别崩解。

---

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置 API Key（任选一种）
#    方式 A：在浏览器中设置（游戏内 API 配置面板，推荐）
#    方式 B：创建 .env 文件
echo 'DEEPSEEK_API_KEY="sk-xxx"' > .env

# 3. 启动开发模式（热重载，无需预构建）
npm run dev
# 访问 http://localhost:3000

# 或启动生产模式
npm run build && npm start
```

> **API 说明**：全部推理走 DeepSeek（OpenAI 兼容接口）。只需配置一个 `DEEPSEEK_API_KEY` 即可使用全部功能。
> 密钥只存在浏览器 localStorage，随请求直接发往 DeepSeek，不经过任何第三方。

---

## 运行时架构

这一节说明「一轮对话到底是怎么跑完的」——它决定了等待感是 3 秒还是 15 秒。

### 一轮 = Judge ∥ NPC 链

```
        ┌── judge ────────────────────────────┐
   t0 ──┤                                     ├──→ 各自落地
        └── npc0 → npc1 → npc2 → npc3 ────────┘
              ↑        ↑       ↑       ↑
           逐条流式输出，每条生成完立即上屏
```

- **Judge 与 NPC 链之间没有数据依赖**：Judge 评判的是「玩家本轮发言 + 上一轮 NPC 发言」，
  因此它从第一轮起就与 NPC 链完全重叠。整轮墙钟时间 ≈ `max(Judge, NPC 链)`，
  而不是两者相加。
- **NPC 链内部必须串行**：第 i 个 NPC 要先看到第 i-1 个说了什么才能接话。
  这是产品语义，不是实现偷懒——群聊里后发言的人本来就听过前面的。
  链内每个节点在等待前序时不会阻塞 Judge。

### 流式增量渲染

- NPC 回复走 SSE 流式（`stream: true`），**Token/Chunk 级**增量直接拼进气泡，
  不等整条回复生成完再上屏。
- 生成中的消息单独放在 `streamingReplies` 里，**不写入 `state.messages`**——
  避免半成品被持久化进存档、或被复盘逻辑当成完整发言。
  整条回复生成完成后，才落地为正式消息并写入 localStorage。
- Judge 在另一条路径上推进，UI 只显示「评审正在观察这一轮…」，
  不会为了等 Judge 而卡住 NPC 的显示。

### 消费顺序守卫

供应商的流式分片会出现「生成顺序 / 完成顺序 / 消费顺序」不一致
（后发分片先到、usage-only 空 delta 帧、一次 SSE 事件塞多条 `data:` 行）。
`src/services/stream.ts` 用纯函数处理这类情况：

- `ChunkOrderGuard`：按生成序位缓冲。乱序分片被挂起而不是直接拼接，
  保证最终文本等于生成顺序的文本；前序丢帧时由 `flush()` 兜底放行，
  不会永久阻塞（否则玩家会看到消息卡死）。
- `SequencedConsumer`：按 SSE 事件出现顺序编号并统计乱序分片数，供指标面板展示。
- `parseJsonLoose`：剥掉 ```` ```json ```` 围栏、BOM、前后多余话术，围栏未配平时截取最外层大括号。

这些都是纯函数，因此能在不打真实 API 的前提下写回归测试（见 `tests/stream.test.ts`）。

### 指标埋点

每轮记录：首字延迟（TTFT）、整轮墙钟、Judge 耗时、NPC 链耗时、两者重叠时间、乱序分片数。
游戏页头部显示「首字延迟」，点击可展开完整指标。

这些数字是「模型推理占用户感知等待比例」这类结论的唯一依据——不埋点就只能靠猜。

```bash
npm test        # 流式解码层回归测试（16 项）
```

---

## 体验指南

### 第一步：进入游戏

打开 `http://localhost:3000`，你会看到黑客终端风格的首页：

```
  FAKE
  To fake is to make.
  你没有被给一个身份。你必须用语言伪造一个。

  🎭 每轮你 构造一个新的自己 ——身份只有一句话的寿命
  💬 用NPC的词汇和节奏说话，让他们以为 你是自己人
  ❓ 被质疑时不解释， 只重塑 ——你没义务保持前后一致
  💀 身份崩解 = 流亡结束
```

### 第二步：配置 AI 引擎

点击 **API 配置** 展开面板，填入你的 DeepSeek API Key。密钥仅保存在浏览器本地，不会上传。

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
├── App.tsx              # UI 与游戏流程
├── types.ts             # TypeScript 类型定义
├── services/
│   ├── ai.ts            # Agent 运行时：并发调度、流式消费、指标埋点
│   ├── llm.ts           # LLM 适配层：配置、连通性探测、流式/非流式调用
│   ├── stream.ts        # 纯函数流式解码：顺序守卫、分片解析、JSON 容错
│   └── prompts.ts       # 提示词资产：人格、群聊规则、评分维度、复盘模板
├── main.tsx             # React 渲染入口
└── index.css            # Tailwind CSS 入口
tests/                   # 85 项，按架构分层
├── stream.test.ts       # L1 纯函数解码：顺序守卫、丢帧兜底、JSON 容错
├── shuffle.test.ts      # L1 随机性：卡方差分测试
├── transport.test.ts    # L2 传输层：注入式 SSE 夹具，测挂起/取消/错误分类
├── runtime.test.ts      # L3 运行时：并发契约、依赖契约、取消契约
├── app.dom.test.tsx     # L4/L5 组件层：流式中间态、状态契约（happy-dom）
├── sse-inspector.test.ts # 元测试：用已知根因验证判定工具本身
└── fixtures/
    └── mock-transport.ts # SSE 注入夹具（stallAfter / reorder / duplicate…）
tools/
├── sse-capture-proxy.ts # SSE 抓包代理
├── sse-inspector.ts     # 乱序根因判定核心（纯函数）
├── sse-inspect-cli.ts   # 体检 CLI
├── sse-fault-injector.ts # 6 个已知根因的故障样本
└── bench-turn.ts        # 一轮耗时基线（并发 vs 串行）
server.ts                # Express 静态文件服务器 / Vite 开发代理
survival_demo.ts         # 离线跑批：AI 玩家自动打 10 轮，输出 生存典范.md
index.html               # HTML 入口
```

分层原则：`prompts.ts` 是产品表达，`stream.ts` 是纯函数，`llm.ts` 是供应商适配，
`ai.ts` 是调度。改人格不会碰到流式代码，改流式不会碰到提示词。

### 关键函数速查（ai.ts）

| 函数 | 用途 |
|------|------|
| `startTurn(input)` | **一轮的调度入口**。返回 `TurnPlan`：Judge 与 NPC 链两条 promise 路径、逐条可消费、可 abort |
| `generateGameStart(difficulty, customTheme)` | 生成话题、NPC 名字、开场闲聊 |
| `judgeRound(params)` | 身份审判——三维评分 + 暴露指数变动 |
| `generateGameRecap(...)` | 游戏结束复盘报告 |
| `generateTopics()` | LLM 动态生成 6 类 12 个话题 |
| `profileNameOf(npcId)` | 查人格原型名 |

### 关键类型速查（ai.ts）

| 类型 | 说明 |
|------|------|
| `TurnPlan` | `judge` / `npcReplies[]` / `metrics` / `abort` |
| `TurnMetrics` | `ttftMs` `totalMs` `judgeMs` `npcChainMs` `overlapMs` `outOfOrderChunks` |
| `StreamMetrics` | 单条消息：`ttftMs` `totalMs` `chunks` `visibleInMs` |

### Prompt 体系

所有 prompt 位于 `src/services/prompts.ts`：

| Prompt | 说明 |
|--------|------|
| `NPC_PROFILES` | 4 个 NPC 人格描述 |
| `INTERACTION_RULES` | 8 条群聊行为规则 |
| `DISCUSSION_PROTOCOL` | 7 条深度讨论约束 |
| `buildNPCPrompt()` | 拼接 NPC prompt（规则 → 人格 → 协议 → 上下文） |
| `buildJudgePrompt()` | 身份审判——场景感知 → 圈内感/身份自洽/存在感 → 分数计算 |
| `buildStartPrompt()` / `TOPICS_PROMPT` / `buildRecapPrompt()` | 开场、话题池、复盘 |


---

## 调优指南

### 想让游戏更简单？
- `App.tsx` → 降低 `VICTORY` 中的存活轮次要求
- `App.tsx` → 调小 `DIFF_WEIGHT`

### 想让游戏更难？
- `App.tsx` → 提高 `VICTORY.requiredRounds`
- `App.tsx` → 调大 `DIFF_WEIGHT`

### 想调整 NPC 性格？
- `prompts.ts` → `NPC_PROFILES`：人格描述
- `prompts.ts` → `INTERACTION_RULES`：群聊行为规则
- `prompts.ts` → `DISCUSSION_PROTOCOL`：讨论深度约束

### 想改变评分维度？
- `prompts.ts` → `buildJudgePrompt()`：评分维度、权重、加分逻辑
- `types.ts` 的 `JudgeResult.breakdown`：同步更新字段
- `App.tsx` 的 `DIFF_WEIGHT` / `VICTORY`：同步分数到暴露指数的映射

### 想换模型 / 换服务商？
- 模型名：`src/services/llm.ts` 的 `DEFAULT_MODEL`
- 也可在浏览器 localStorage 用 `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` 覆盖
- 只要服务商兼容 OpenAI 的 `/chat/completions`（含 `stream: true`），无需改代码

---

## 技术栈

| 层 | 技术 |
|-----|------|
| 前端框架 | React 19 + TypeScript |
| 构建 | Vite 6 |
| 样式 | Tailwind CSS 4 |
| 动画 | Motion (ex-Framer Motion) |
| AI SDK | OpenAI SDK（指向 DeepSeek 的 OpenAI 兼容接口） |
| 图标 | Lucide React |
| 服务端 | Express (静态文件 + Vite 中间件) |

---

## 已知问题 & 贡献指南

欢迎提交 PR 共同优化。以下列出目前已知的架构漏洞、性能瓶颈和功能缺陷，标注了优先级（🔴严重 🟠高 🟡中 🟢低）和修复难度。

> **已解决（本轮迭代）**：A7 NPC 链与 Judge 的串行等待已改为并发调度；P1 的「串行链累计 ~10.8s」已由流式增量渲染消除大半——首字出现即可读，不再等整条链跑完；R1 已加入统一超时（45s）、AbortController 与 JSON 解析兜底；**D1 流式挂起导致 UI 永久锁死已修复**（根因是 SDK 的 `timeout` 与 abort `signal` 都只覆盖到建连阶段，不覆盖响应体读取）；E1 已有 85 项分层测试，含「用已知根因验证判定工具」的元测试。
> 下面保留原始条目以便追溯，并在状态列标注。

### 🏗 架构

| # | 问题 | 优先级 | 难度 | 状态 | 说明 |
|---|------|--------|------|------|------|
| A1 | 单体 `App.tsx` 无组件拆分 | 🔴 | 大 | 待办 | 状态、渲染、逻辑全部耦合，每次 `setState` 重跑全部代码。建议拆出 `HomePage` / `GamePage` / `GameOverPage` |
| A2 | API Key 纯前端明文传输 | 🟠 | 中 | 待办 | `dangerouslyAllowBrowser: true`，XSS 下可被窃取。建议通过 Express 后端代理 API 请求 |
| A3 | `localStorage` 每次 `setState` 同步写盘 | 🟠 | 小 | 待办 | 每轮 5+ 次 `JSON.stringify` + `setItem` 阻塞主线程。建议用 `useRef` + debounce 1s 写入 |
| A4 | 无 Error Boundary | 🟠 | 小 | 待办 | 任何未捕获异常直接白屏。建议在 `main.tsx` 包裹 `<ErrorBoundary>` |
| A5 | 消息数组无限增长无裁剪 | 🟡 | 小 | 待办 | 20 轮后 DOM 节点 100+。建议只渲染最近 50 条，完整历史存 `useRef` |
| A6 | 游戏状态无迁移策略 | 🟡 | 小 | 待办 | `fakeExpert_save` 格式变更后旧存档会崩溃。建议加 `version` 字段 |
| A7 | ~~NPC 链串行依赖 `prevContent`~~ | 🟡 | 大 | ✅ 已并发 | Judge 与 NPC 链已完全重叠（`judgeMs` / `npcChainMs` / `overlapMs` 可在指标面板核对）。链内串行是产品语义，保留 |

### ⚡ 性能

| # | 问题 | 优先级 | 难度 | 状态 | 说明 |
|---|------|--------|------|------|------|
| P1 | 模型推理占用户感知等待的 ~95% | 🔴 | 大 | ✅ 部分解决 | 流式增量渲染已把「首字等待」从「整条链跑完」降到「首个 chunk 到达」。剩余等待是模型首字延迟本身，只能靠更小模型或缓存继续压缩 |
| P2 | 零 `React.memo` / `useMemo` / `useCallback` | 🟠 | 大 | 待办 | 每次键盘输入都重跑整个 `App`。建议拆分组件后对 `MessageList`、`ParticleBg` 加 memo |
| P3 | 60 颗粒子的随机位置每次渲染重新 `Math.random()` | 🟡 | 小 | 待办 | 打字时不断重算 60 个 inline style。建议移入 `useRef` 仅挂载时生成一次 |
| P4 | 多处 `backdrop-filter: blur()` 叠加 | 🟡 | 小 | 待办 | header、footer、rules card、glow orbs 同时 blur，GPU 合成层开销大 |
| P5 | `AnimatePresence` + `layout` 动画在消息列表上 | 🟡 | 中 | 待办 | 每条新消息触发 FLIP 计算。建议移除消息气泡的 `layout` prop |
| P6 | 流式增量触发高频 `setState` | 🟡 | 中 | 待办 | 每个 chunk 一次 `setState`，长回复会连续触发渲染。建议按 ~16ms 批量合并增量后再刷 |

### 🛡 健壮性

| # | 问题 | 优先级 | 难度 | 状态 | 说明 |
|---|------|--------|------|------|------|
| R1 | ~~API 调用无统一超时/重试~~ | 🟠 | 小 | ✅ 已解决 | 统一 45s 超时 + AbortController；JSON 解析失败重试一次，二次失败回落中性评分而非崩溃 |
| R2 | `generateTopics()` 无缓存 | 🟡 | 小 | 待办 | 每次点击重复调用 LLM，浪费额度。建议 `sessionStorage` 缓存 5min TTL |
| R3 | `generateGameRecap()` 无降级 | 🟡 | 小 | 待办 | 复盘失败时只显示一行文本。建议基于 `judgeHistory` 本地生成基础分析 |
| R4 | 无 TypeScript strict 模式 | 🟢 | 小 | 待办 | `tsconfig.json` 未开 `strict`。开启后需修复若干类型错误 |
| R5 | 硬编码投降关键词 `["我认输", "我不知道"]` | 🟢 | 小 | 待办 | 建议扩展为可配置列表或关键词包含匹配 |

### 🎨 UI / 体验

| # | 问题 | 优先级 | 难度 | 状态 | 说明 |
|---|------|--------|------|------|------|
| U1 | 无移动端适配 | 🟠 | 中 | 待办 | 群聊窗口和复盘页在小屏上布局混乱。建议加 breakpoint 适配 + 输入框吸底 |
| U2 | 无可访问性（a11y） | 🟡 | 中 | 待办 | 无 ARIA 标签、无键盘导航。建议从无障碍名称与实时区域播报开始 |
| U3 | 复盘图表 SVG 无数据时空白 | 🟡 | 小 | 待办 | `timeline.length <= 1` 时不渲染折线，但占位区域仍在 |
| U4 | 无音效/震动反馈 | 🟢 | 小 | 待办 | 暴露指数涨跌无感官反馈。可用 Web Audio API 或 `navigator.vibrate` |
| U5 | 无深色/浅色主题切换 | 🟢 | 小 | 待办 | 可加浅色主题作为备选，用 CSS 变量切换 |

### 🔬 工程化

| # | 问题 | 优先级 | 难度 | 状态 | 说明 |
|---|------|--------|------|------|------|
| E1 | 测试覆盖不足 | 🟠 | 中 | 🟡 部分完成 | `tests/stream.test.ts` 已覆盖流式解码与顺序守卫（16 项）。仍缺 `startTurn` 调度与 `parseJsonLoose` 之外的评分计算测试 |
| E2 | 无 CI/CD | 🟡 | 小 | 待办 | 建议加 GitHub Actions：`npm run lint` → `npm test` → `npm run build` |
| E3 | `motion` 包体内含 `framer-motion` 残留 | 🟢 | 小 | 待办 | 检查 `package-lock.json` 去重 |
| E4 | 无 `CHANGELOG` / 版本号管理 | 🟢 | 小 | 待办 | 建议用 `changesets` 或手动维护 |

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
| 10 分钟 | A3 localStorage debounce、P3 粒子 useRef、R4 tsconfig strict |
| 1 小时 | A4 ErrorBoundary、R2 topics 缓存、E2 CI/CD、U3 空状态 |
| 半天 | A2 API 代理、U1 移动端适配、P6 增量批量合并、E1 补充调度测试 |
| 1-2 天 | A1 组件拆分 + P2 memo、U2 a11y |

---

## 许可证 & 社区

本项目基于 **MIT License** 开源。详见 [LICENSE](./LICENSE)。

- 🐛 [报告 Bug](https://github.com/jiale-li-orion/FAKE/issues)
- 💡 [提议新功能](https://github.com/jiale-li-orion/FAKE/issues)
- 📖 [贡献指南](./CONTRIBUTING.md)
- 🔒 隐私：本项目不收集任何用户数据，API Key 仅保存在浏览器本地 localStorage

---

