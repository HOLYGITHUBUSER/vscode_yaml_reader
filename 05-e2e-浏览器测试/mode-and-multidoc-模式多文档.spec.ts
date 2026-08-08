import { test, expect } from '@playwright/test';
import { writeHarnessHtml } from './harness-脚手架';
import fs from 'fs';

test('multi-document shows document roots', async ({ page }) => {
  const src = 'a: 1\n---\nb: 2\n';
  const { url, dir } = writeHarnessHtml({ yamlSource: src, defaultExpandDepth: 2 });
  await page.goto(url);
  await expect(page.locator('.yaml-key', { hasText: 'document[0]' })).toBeVisible();
  await expect(page.locator('.yaml-key', { hasText: 'document[1]' })).toBeVisible();
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

test('tab switch split/tree/source', async ({ page }) => {
  const { url, dir } = writeHarnessHtml({
    yamlSource: 'hello: world\n',
    mode: 'split',
    defaultExpandDepth: 2,
  });
  await page.goto(url);
  await expect(page.locator('#yaml-pane-tree')).toBeVisible();
  await expect(page.locator('#yaml-pane-source')).toBeVisible();
  await page.click('.yaml-tab[data-mode="source"]');
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'source');
  await page.click('.yaml-tab[data-mode="tree"]');
  await expect(page.locator('#yaml-tree')).toBeVisible();
  await expect(page.locator('.yaml-key', { hasText: 'hello' })).toBeVisible();
  await page.click('.yaml-tab[data-mode="split"]');
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'split');
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

test('keeps last good tree when parse fails after success', async ({ page }) => {
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
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});
