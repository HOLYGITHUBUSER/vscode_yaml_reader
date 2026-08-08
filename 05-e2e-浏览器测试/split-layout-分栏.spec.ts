import { test, expect } from '@playwright/test';
import { writeHarnessHtml } from './harness-脚手架';
import fs from 'fs';

const SAMPLE = `
app:
  name: demo
  ports:
    - 80
`;

test('split layout shows tree and source side by side', async ({ page }) => {
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
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

test('editing source updates value in textarea', async ({ page }) => {
  const { url, dir } = writeHarnessHtml({ yamlSource: 'a: 1\n', mode: 'split' });
  await page.goto(url);
  await page.fill('#yaml-source', 'a: 2\nb: 3\n');
  await expect(page.locator('#yaml-source')).toHaveValue(/b:\s*3/);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});
