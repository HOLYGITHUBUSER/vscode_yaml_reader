import fs from 'fs';
import os from 'os';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');

export interface HarnessConfig {
  yamlSource: string;
  mode?: 'split' | 'source' | 'tree';
  defaultExpandDepth?: number;
  maxNodes?: number;
}

function parseForHarness(source: string, maxNodes = 5000) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const eng = require(path.join(REPO_ROOT, 'out', 'yamlParser.js'));
    return eng.parseYamlToTree(source, { maxNodes });
  } catch (e) {
    return { ok: false, error: String(e), roots: [] };
  }
}

export function writeHarnessHtml(cfg: HarnessConfig): { url: string; dir: string } {
  const mainJs = fs.readFileSync(
    path.join(REPO_ROOT, '02-webview-阅读界面', 'webview-main.js'),
    'utf8'
  );
  const stylesCss = fs.readFileSync(
    path.join(REPO_ROOT, '02-webview-阅读界面', 'webview-styles.css'),
    'utf8'
  );
  const parse = parseForHarness(cfg.yamlSource, cfg.maxNodes ?? 5000);
  const mode = cfg.mode || 'split';
  const depth = cfg.defaultExpandDepth ?? 2;

  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><title>YAML Reader e2e</title>
<style>${stylesCss}</style>
<script>
  window.__posted = [];
  window.acquireVsCodeApi = function () {
    return { postMessage: function (m) { window.__posted.push(m); }, setState: function () {}, getState: function () {} };
  };
</script>
</head>
<body class="yaml-shell vscode-dark" data-mode="${mode}">
  <header class="yaml-header">
    <nav class="yaml-tabs">
      <button type="button" class="yaml-tab" data-mode="split">分栏</button>
      <button type="button" class="yaml-tab" data-mode="tree">树形</button>
      <button type="button" class="yaml-tab" data-mode="source">源码</button>
    </nav>
    <div class="yaml-toolbar" id="yaml-toolbar">
      <div class="yaml-search-wrap">
        <input type="search" id="yaml-search" class="yaml-search" />
        <button type="button" id="yaml-search-clear" class="yaml-search-clear" hidden>×</button>
      </div>
      <button type="button" id="yaml-expand-all" class="yaml-btn">展开</button>
      <button type="button" id="yaml-collapse-all" class="yaml-btn">折叠</button>
      <button type="button" id="yaml-format" class="yaml-btn">格式化</button>
      <button type="button" id="yaml-wrap" class="yaml-btn">换行</button>
      <span id="yaml-meta" class="yaml-meta"></span>
    </div>
  </header>
  <main class="yaml-main" id="yaml-main">
    <section class="yaml-pane yaml-pane-tree" id="yaml-pane-tree">
      <div class="yaml-pane-title">结构</div>
      <div id="yaml-error" class="yaml-error" hidden></div>
      <div id="yaml-breadcrumb" class="yaml-breadcrumb"></div>
      <div id="yaml-tree" class="yaml-tree" role="tree"></div>
    </section>
    <div class="yaml-splitter" id="yaml-splitter"></div>
    <section class="yaml-pane yaml-pane-source" id="yaml-pane-source">
      <div class="yaml-pane-title">源码</div>
      <textarea id="yaml-source" class="yaml-source"></textarea>
    </section>
  </main>
  <script>${mainJs}</script>
  <script>
    window.addEventListener('load', function () {
      if (window.YamlReaderWebview) {
        window.YamlReaderWebview.applyDocument({
          source: ${JSON.stringify(cfg.yamlSource)},
          parse: ${JSON.stringify(parse)},
          mode: ${JSON.stringify(mode)},
          defaultExpandDepth: ${depth}
        });
      }
    });
  </script>
</body></html>`;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yaml-reader-e2e-'));
  const file = path.join(dir, 'index.html');
  fs.writeFileSync(file, html, 'utf8');
  return { url: 'file://' + file, dir };
}

export function cleanupHarness(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
