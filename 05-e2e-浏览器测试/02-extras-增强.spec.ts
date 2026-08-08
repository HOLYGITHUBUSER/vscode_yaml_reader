import { test, expect } from '@playwright/test';
import { cleanupHarness, writeHarnessHtml } from './harness-脚手架';

test.describe('增强能力', () => {
  test('搜索匹配高亮与复制菜单', async ({ page }) => {
    const { url, dir } = writeHarnessHtml({
      yamlSource: 'app:\n  name: demo\n  port: 80\n',
      mode: 'split',
      defaultExpandDepth: 3,
    });
    await page.goto(url);
    await page.fill('#yaml-search', 'demo');
    await expect(page.locator('.yaml-row.is-match').first()).toBeVisible();
    await expect(page.locator('#yaml-search-clear')).toBeVisible();
    await page.hover('.yaml-row >> text=name');
    await expect(page.locator('.yaml-copy', { hasText: 'JSON' }).first()).toBeVisible();
    cleanupHarness(dir);
  });

  test('格式化按钮发消息', async ({ page }) => {
    const { url, dir } = writeHarnessHtml({ yamlSource: 'a:  1\n', mode: 'split' });
    await page.goto(url);
    await page.click('#yaml-format');
    const posted = await page.evaluate(() => (window as any).__posted || []);
    expect(posted.some((m: any) => m.type === 'formatYaml')).toBeTruthy();
    cleanupHarness(dir);
  });

  test('换行开关', async ({ page }) => {
    const { url, dir } = writeHarnessHtml({ yamlSource: 'x: 1\n', mode: 'split' });
    await page.goto(url);
    await page.click('#yaml-wrap');
    await expect(page.locator('#yaml-source')).toHaveClass(/is-wrap/);
    cleanupHarness(dir);
  });
});
