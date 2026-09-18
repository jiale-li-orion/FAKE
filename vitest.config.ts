import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * 测试分层配置。
 *
 * 分两个 project 的原因：纯函数层（解码/提示词/调度）不需要 DOM，
 * 跑在 node 环境下启动快、无 jsdom 的怪癖；只有组件层需要浏览器环境。
 * 混在一起会让 L1 的测试无谓地承担 jsdom 的启动开销与差异。
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    projects: [
      {
        // ── L1/L2/L3：纯函数与传输/调度层，node 环境 ──
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/**/*.dom.test.ts'],
        },
      },
      {
        // ── L4/L5：组件与渲染层，jsdom 环境 ──
        // 组件测试含 JSX，故同时匹配 .ts 与 .tsx
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['tests/**/*.dom.test.{ts,tsx}'],
          setupFiles: ['tests/setup.dom.ts'],
          // jsdom + React 19 + motion 的模块图较大，在 WSL 挂载盘上
          // 冷启动容易超过默认 worker 就绪超时；单线程 + 放宽超时更稳
          pool: 'threads',
          maxWorkers: 1,
          testTimeout: 20_000,
          hookTimeout: 20_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/services/**', 'src/types.ts'],
      // 门槛只增不减：当前实测值就是地板，任何新代码不允许拉低
      thresholds: {
        'src/services/stream.ts': { statements: 80, branches: 70 },
        'src/services/llm.ts': { statements: 60, branches: 50 },
      },
    },
  },
});
