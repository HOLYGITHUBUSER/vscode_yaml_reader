import { test, expect } from '@playwright/test';
import { writeHarnessHtml } from './harness-脚手架';
import fs from 'fs';

const SAMPLE = `
app:
  name: demo
  ports:
    - 80
    - 443
  enabled: true
`;

test('renders tree keys and types', async ({ page }) => {
  const { url, dir } = writeHarnessHtml({ yamlSource: SAMPLE, defaultExpandDepth: 3 });
  await page.goto(url);
  await expect(page.locator('.yaml-key', { hasText: 'app' })).toBeVisible();
  await expect(page.locator('.yaml-key', { hasText: 'name' })).toBeVisible();
  await expect(page.locator('.yaml-value', { hasText: 'demo' })).toBeVisible();
  await expect(page.locator('.yaml-type.t-array').first()).toBeVisible();
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

test('expand and collapse all', async ({ page }) => {
  const { url, dir } = writeHarnessHtml({ yamlSource: SAMPLE, defaultExpandDepth: 0 });
  await page.goto(url);
  // depth 0: nested keys hidden
  await expect(page.locator('.yaml-key', { hasText: 'name' })).toHaveCount(0);
  await page.click('#yaml-expand-all');
  await expect(page.locator('.yaml-key', { hasText: 'name' })).toBeVisible();
  await page.click('#yaml-collapse-all');
  await expect(page.locator('.yaml-key', { hasText: 'name' })).toHaveCount(0);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

test('search filters nodes', async ({ page }) => {
  const { url, dir } = writeHarnessHtml({ yamlSource: SAMPLE, defaultExpandDepth: 5 });
  await page.goto(url);
  await page.fill('#yaml-search', '443');
  await expect(page.locator('.yaml-value', { hasText: '443' })).toBeVisible();
  // name may disappear depending on filter (self match on ports keeps tree)
  await page.fill('#yaml-search', 'zzz-no-match');
  await expect(page.locator('.yaml-empty')).toBeVisible();
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

test('shows parse warning or error for broken yaml', async ({ page }) => {
  const { url, dir } = writeHarnessHtml({
    yamlSource: 'foo: [1, 2\nbar: x',
    defaultExpandDepth: 2,
  });
  await page.goto(url);
  // eemeli 常 soft-parse：错误横幅 或 树上警告节点
  const err = page.locator('#yaml-error');
  const warnNode = page.locator('.yaml-key', { hasText: '解析' });
  const any =
    (await err.isVisible().catch(() => false)) ||
    (await warnNode.count()) > 0 ||
    (await page.locator('.yaml-type.t-error').count()) > 0 ||
    (await page.locator('.yaml-key', { hasText: '⚠' }).count()) > 0;
  expect(any).toBeTruthy();
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});
