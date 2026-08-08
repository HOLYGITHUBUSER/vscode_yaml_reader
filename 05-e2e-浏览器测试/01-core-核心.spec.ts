import { test, expect } from '@playwright/test';
import { cleanupHarness, writeHarnessHtml } from './harness-脚手架';

const SAMPLE = `
app:
  name: demo
  ports:
    - 80
    - 443
  enabled: true
`;

test.describe('分栏与树', () => {
  test('左右分栏同时可见', async ({ page }) => {
    const { url, dir } = writeHarnessHtml({
      yamlSource: SAMPLE,
      mode: 'split',
      defaultExpandDepth: 3,
    });
    await page.goto(url);
    await expect(page.locator('#yaml-pane-tree')).toBeVisible();
    await expect(page.locator('#yaml-pane-source')).toBeVisible();
    await expect(page.locator('#yaml-splitter')).toBeVisible();
    await expect(page.locator('.yaml-key', { hasText: 'app' })).toBeVisible();
    await expect(page.locator('#yaml-source')).toHaveValue(/name:\s*demo/);
    cleanupHarness(dir);
  });

  test('渲染类型与展开折叠', async ({ page }) => {
    const { url, dir } = writeHarnessHtml({ yamlSource: SAMPLE, defaultExpandDepth: 0 });
    await page.goto(url);
    await expect(page.locator('.yaml-key', { hasText: 'name' })).toHaveCount(0);
    await page.click('#yaml-expand-all');
    await expect(page.locator('.yaml-key', { hasText: 'name' })).toBeVisible();
    await expect(page.locator('.yaml-type.t-array').first()).toBeVisible();
    await page.click('#yaml-collapse-all');
    await expect(page.locator('.yaml-key', { hasText: 'name' })).toHaveCount(0);
    cleanupHarness(dir);
  });

  test('搜索过滤', async ({ page }) => {
    const { url, dir } = writeHarnessHtml({ yamlSource: SAMPLE, defaultExpandDepth: 5 });
    await page.goto(url);
    await page.fill('#yaml-search', '443');
    await expect(page.locator('.yaml-value', { hasText: '443' })).toBeVisible();
    await page.fill('#yaml-search', 'zzz-no-match');
    await expect(page.locator('.yaml-empty')).toBeVisible();
    cleanupHarness(dir);
  });

  test('源码可编辑', async ({ page }) => {
    const { url, dir } = writeHarnessHtml({ yamlSource: 'a: 1\n', mode: 'split' });
    await page.goto(url);
    await page.fill('#yaml-source', 'a: 2\nb: 3\n');
    await expect(page.locator('#yaml-source')).toHaveValue(/b:\s*3/);
    cleanupHarness(dir);
  });
});

test.describe('模式与多文档', () => {
  test('多文档根节点', async ({ page }) => {
    const { url, dir } = writeHarnessHtml({
      yamlSource: 'a: 1\n---\nb: 2\n',
      defaultExpandDepth: 2,
    });
    await page.goto(url);
    await expect(page.locator('.yaml-key', { hasText: 'document[0]' })).toBeVisible();
    await expect(page.locator('.yaml-key', { hasText: 'document[1]' })).toBeVisible();
    cleanupHarness(dir);
  });

  test('分栏/树形/源码切换', async ({ page }) => {
    const { url, dir } = writeHarnessHtml({
      yamlSource: 'hello: world\n',
      mode: 'split',
      defaultExpandDepth: 2,
    });
    await page.goto(url);
    await page.click('.yaml-tab[data-mode="source"]');
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'source');
    await page.click('.yaml-tab[data-mode="tree"]');
    await expect(page.locator('.yaml-key', { hasText: 'hello' })).toBeVisible();
    await page.click('.yaml-tab[data-mode="split"]');
    await expect(page.locator('body')).toHaveAttribute('data-mode', 'split');
    cleanupHarness(dir);
  });

  test('解析失败保留上次树', async ({ page }) => {
    const { url, dir } = writeHarnessHtml({
      yamlSource: 'ok: true\n',
      defaultExpandDepth: 2,
    });
    await page.goto(url);
    await expect(page.locator('.yaml-key', { hasText: 'ok' })).toBeVisible();
    await page.evaluate(() => {
      (window as any).YamlReaderWebview.applyDocument({
        source: 'bad: [1, 2\n',
        parse: { ok: false, error: 'bad indent', line: 1, column: 1 },
        mode: 'tree',
        defaultExpandDepth: 2,
      });
    });
    await expect(page.locator('#yaml-error')).toBeVisible();
    await expect(page.locator('.yaml-key', { hasText: 'ok' })).toBeVisible();
    cleanupHarness(dir);
  });

  test('非法 YAML 有错误或警告', async ({ page }) => {
    const { url, dir } = writeHarnessHtml({
      yamlSource: 'foo: [1, 2\nbar: x',
      defaultExpandDepth: 2,
    });
    await page.goto(url);
    const any =
      (await page.locator('#yaml-error').isVisible().catch(() => false)) ||
      (await page.locator('.yaml-key', { hasText: '⚠' }).count()) > 0 ||
      (await page.locator('.yaml-type.t-error').count()) > 0;
    expect(any).toBeTruthy();
    cleanupHarness(dir);
  });
});
