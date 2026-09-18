import { defineConfig, devices } from '@playwright/test';

/**
 * FAKE E2E 配置。
 *
 * 几个刻意为之的决定：
 *
 * 1. 走生产模式（build + start）而不是 npm run dev。
 *    dev 模式是 tsx + Vite 中间件，模块按需编译，首屏会有几秒抖动；
 *    E2E 要的是确定性，生产包加载完就是稳定状态。
 *
 * 2. workers: 1。游戏本身有随机性（NPC 出场顺序是 shuffle 的），
 *    并行 worker 会争抢同一个 Express 实例和同一个 mock 状态，
 *    排查失败时的噪音远大于省下的时间。
 *
 * 3. baseURL 用 127.0.0.1 而不是 localhost。
 *    这台机器有 http_proxy=127.0.0.1:7897，localhost 在部分解析路径下
 *    会被送进代理导致 502。127.0.0.1 在 NO_PROXY 里，稳定。
 *
 * 4. launchOptions.args 里的 --no-proxy-server 是必需的：
 *    Chromium 会读 http_proxy 环境变量，把对 127.0.0.1:3000 和
 *    api.deepseek.com 的请求都丢给代理。前者会 502，
 *    后者会让 route 拦截失效（请求根本没走浏览器网络栈）。
 */
export default defineConfig({
  testDir: './e2e',

  // 单 worker：见上
  workers: 1,
  fullyParallel: false,

  // 失败重试 1 次：区分「真 bug」和「偶发」。
  // 注意 stall 用例是必然失败（代码没有超时保护），重试只是浪费 1 倍时间，
  // 所以它在文件里用 test.fail() 显式标注（见 e2e/game.spec.ts）。
  retries: 1,

  // 每轮游戏要跑好几次流式生成，单用例给足时间
  timeout: 90_000,
  expect: { timeout: 15_000 },

  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list']],

  use: {
    baseURL: 'http://127.0.0.1:3000',
    headless: true,

    // 失败时留证据
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',

    launchOptions: {
      args: ['--no-proxy-server', '--disable-dev-shm-usage'],
    },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /**
   * webServer 用生产模式。
   * npm start 依赖 dist/server.cjs，所以命令里带 build；
   * E2E_NO_BUILD=1 可以跳过重建（本地反复跑用例时省 1 分钟）。
   */
  webServer: {
    command: process.env.E2E_NO_BUILD
      ? 'npm run start'
      : 'npm run build && npm run start',
    url: 'http://127.0.0.1:3000/api/health',
    // 一律自己起服务：reuseExistingServer 曾在「探测失败 → 复用到的却是
    // 上一次遗留的旧进程」之间踩到竞态，导致第一次跑连不上、第二次跑才发现
    // 用的是旧构建。E2E 必须跑在自己刚构建出来的产物上。
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      NODE_ENV: 'production',
      // 双保险：即使 --no-proxy-server 没生效，也让 Node 侧绕过代理
      NO_PROXY: '127.0.0.1,localhost',
      no_proxy: '127.0.0.1,localhost',
    },
  },
});
