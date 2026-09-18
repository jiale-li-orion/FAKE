import { test, expect } from '@playwright/test';
import { installMockLlm, seedApiKey, startGame } from './fixtures/mock-llm';

/**
 * 冒烟：确认 E2E 地基是通的（生产服务能起、能打开页面、mock 能拦到请求）。
 * 如果这个文件都跑不过，别去查业务用例。
 */
test('冒烟：页面能打开，mock 能拦到开局请求', async ({ page }) => {
  await seedApiKey(page);
  const llm = await installMockLlm(page);

  await startGame(page);

  // 开局应该恰好发一次 start 请求
  expect(llm.countOf('start')).toBe(1);
  // 四条开场消息都渲染出来了
  for (const exp of llm.state.start.initialExperts) {
    await expect(page.getByText(exp.content)).toBeVisible();
  }
});
