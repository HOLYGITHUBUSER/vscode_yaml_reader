import { test, expect } from '@playwright/test';
import { writeHarnessHtml } from './harness-脚手架';
import fs from 'fs';

test('copy menu and match highlight on search', async ({ page }) => {
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
  await expect(page.locator('.yaml-copy-group').first()).toBeVisible();
  await expect(page.locator('.yaml-copy', { hasText: 'JSON' }).first()).toBeVisible();
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

test('format button posts formatYaml', async ({ page }) => {
  const { url, dir } = writeHarnessHtml({
    yamlSource: 'a:  1\n',
    mode: 'split',
  });
  await page.goto(url);
  await page.click('#yaml-format');
  const posted = await page.evaluate(() => (window as any).__posted || []);
  expect(posted.some((m: any) => m.type === 'formatYaml')).toBeTruthy();
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

test('wrap toggle toggles class', async ({ page }) => {
  const { url, dir } = writeHarnessHtml({ yamlSource: 'x: 1\n', mode: 'split' });
  await page.goto(url);
  await page.click('#yaml-wrap');
  await expect(page.locator('#yaml-source')).toHaveClass(/is-wrap/);
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});
