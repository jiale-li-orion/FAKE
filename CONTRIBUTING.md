# Contributing to FAKE | 身份流亡

欢迎贡献！本项目旨在探索"语言即身份"的边界，任何形式的贡献都欢迎。

## 如何贡献

### 🐛 报告 Bug
- 在 Issues 中描述：预期行为、实际行为、复现步骤、截图/日志
- 如果是 API 相关问题，附上使用的模型和 difficulty 设置

### 💡 提出新功能
- 先开 Issue 讨论方案，避免重复劳动
- 说清楚：解决什么问题、用户怎么用、影响哪些现有功能

### 🔧 提交代码

1. **Fork** 本仓库
2. 创建 feature 分支：`git checkout -b feat/your-feature`
3. 遵循现有代码风格：
   - TypeScript strict 友好
   - 组件用函数式 + hooks
   - Tailwind CSS 类优先于 inline style
4. 提交前确保通过 lint：`npm run lint`
5. 提交 PR，描述清楚改了什么、为什么改

### 🎨 UI 贡献

如果涉及 UI 改动，项目已集成 **Open UI Scout skill**：
- 先在 707 个 GitHub 资源池中匹配 2-3 个参考源
- 不默认黑紫 AI 科技风
- 方案标注技术栈匹配、风格匹配、依赖成本

## 开发环境

```bash
npm install
npm run dev:vite     # 纯前端开发（跳过 Express）
npm run dev          # 完整栈（含 API 路由）
npm run lint         # TypeScript 类型检查
```

## 分支管理

- `main` — 稳定分支，随时可部署
- `feat/*` — 新功能
- `fix/*` — Bug 修复
- `chore/*` — 工程化改动

## 行为准则

- 友善、包容、尊重
- 就事论事，不人身攻击
- 欢迎新手，耐心解答
