# Prompt Overhaul: 降低术语难度 + 思维链引导

## 🎯 OBJECTIVE
修改 `/mnt/c/Users/29461/Desktop/假装专家/src/services/ai.ts` 中的四个 Prompt，使游戏对高中生知识水平的用户友好。

## 📁 FILES TO MODIFY
- `/mnt/c/Users/29461/Desktop/假装专家/src/services/ai.ts` — 唯一需要修改的文件

## ✅ SUCCESS CRITERIA

### 1. SYSTEM_PROMPT 替换（约第 11-30 行）
完整替换为包含以下内容的版本：
- **核心调性**：可理解性优先，逻辑构建高于术语堆砌，启发式教学
- **术语难度分级表**（严格遵守）：
  - Round 1-2：零术语。日常语言。禁止缩写/生僻词。如需引入概念，用括号解释。（如"糖度梯度——也就是糖的浓度在不同位置的差异"）
  - Round 3-4：最多 1-2 个基础术语，附带语境暗示或简短解释
  - Round 5-6：术语密度适度提升，保持可推导性
  - Round 7+：可进入专业讨论
- **思维链奖励机制**（玩家使用以下模式加分/降低怀疑度）：
  1. 先观察再推断："我注意到...这可能意味着..."
  2. 限定性结论："在X条件下，我倾向于认为Y，尽管Z可能是一个干扰因素"
  3. 主动承认边界："目前的数据还不足以完全证实，但如果...的假设成立，那么..."
  4. 类比解释："这有点类似于...的现象，只是在这个系统中表现为..."

### 2. generateGameStart prompt 修改（约第 78-101 行）
- 新增指令 #0：生成 `thinkingChainExample` 字段
- 强化指令 #2：前三条帖子和术语表使用高中水平语言，术语解释不超过 30 字，无英文缩写
- JSON schema 中新增 `"thinkingChainExample": "一个完整的回答范例，展示结构化思维，用日常语言，150字以内"`
- 返回值解构新增 `thinkingChainExample`：把 `const { field, topic, initialExperts, glossary }` 改为 `const { field, topic, initialExperts, glossary, thinkingChainExample }`
- return 语句加上 `thinkingChainExample`

### 3. judgePlayerTurn prompt 修改（约第 119-154 行）
替换要求 #1 和 #2：
- #1：严格术语分级（Round 1-2 NPC 用日常语言，括号解释陌生概念，禁止缩写。Round 3-4 1-2个基础术语带解释。Round 5+ 逐步增加密度）
- #2：NPC 回复必须包含至少一个结构化思维示范（如"你提出的观点让我想到..."、"基于你的观察，如果我们假设..."、"不过需要注意..."）

### 4. generateHint prompt 修改（约第 170-187 行）
- #2 改为三段式思维链模板：
  - 第一步（观察）："我注意到...（描述现象）"
  - 第二步（推导）："这可能是因为...（因果解释）"
  - 第三步（限定）："当然，如果...（承认边界），结论可能需要调整"
- 字数限制从 180 改为 250

## 🚫 CONSTRAINTS
- 不修改 `callAI` 函数
- 不修改 `getStoredKey` 函数
- 不修改 TypeScript 类型导入
- 不增删函数——只修改四个函数内的 prompt 字符串和返回值解构
- 文件必须保持语法正确的 TypeScript

## 🔗 PATTERNS TO FOLLOW
- 所有 prompt 用模板字面量（反引号）——与现有代码风格一致
- JSON schema 格式保持 `key: value` 风格
- SYSTEM_PROMPT 常量保持反引号赋值

## 📝 VERIFICATION
修改后检查：
- SYSTEM_PROMPT 包含 "术语难度分级" 和 "思维链奖励机制"
- generateGameStart 返回中包含 `thinkingChainExample`
- judgePlayerTurn prompt 包含 "Round 1-2：" 零术语约束
- generateHint prompt 包含 "第一步" 或 "观察"
