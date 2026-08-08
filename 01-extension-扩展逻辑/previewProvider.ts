import * as path from 'path';
import * as vscode from 'vscode';
import { formatYaml, parseYamlToTree } from './yamlParser';
import {
  EditorMode,
  parseViewMode,
  StatusBarController,
  toEditorMode,
  ViewMode,
} from './statusBarController';

/**
 * Custom Text Editor：默认左右分栏 — 左结构树，右可编辑源码。
 */
export class PreviewProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'yaml-reader.editor';

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly statusBar: StatusBarController
  ) {}

  public static register(
    context: vscode.ExtensionContext,
    statusBar: StatusBarController
  ): vscode.Disposable {
    const provider = new PreviewProvider(context, statusBar);
    return vscode.window.registerCustomEditorProvider(PreviewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    });
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const docDir = vscode.Uri.file(path.dirname(document.uri.fsPath));
    const roots = [
      vscode.Uri.joinPath(this.context.extensionUri, '02-webview-阅读界面'),
      docDir,
    ];
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (folder) roots.push(folder.uri);

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: roots,
    };

    const config = vscode.workspace.getConfiguration('yaml-reader');
    let mode: EditorMode = toEditorMode(
      parseViewMode(config.get<string>('defaultView', 'split'), ViewMode.Split)
    );
    this.statusBar.setMode(
      mode === 'source' ? ViewMode.Source : mode === 'tree' ? ViewMode.Tree : ViewMode.Split,
      { silent: true }
    );

    webviewPanel.webview.html = this.getHtml(webviewPanel.webview, mode);

    let ignoreDocEchoUntil = 0;
    let editChain: Promise<void> = Promise.resolve();
    let pendingSource: string | null = null;

    const maxNodes = () =>
      vscode.workspace.getConfiguration('yaml-reader').get<number>('maxNodes', 5000);
    const defaultExpandDepth = () =>
      vscode.workspace.getConfiguration('yaml-reader').get<number>('defaultExpandDepth', 2);

    const postDoc = () => {
      const source = document.getText();
      const parse = parseYamlToTree(source, { maxNodes: maxNodes() });
      webviewPanel.webview.postMessage({
        type: 'updateDocument',
        source,
        parse,
        mode,
        defaultExpandDepth: defaultExpandDepth(),
      });
    };

    const postTheme = () => {
      const kind = vscode.window.activeColorTheme.kind;
      const dark =
        kind === vscode.ColorThemeKind.Dark || kind === vscode.ColorThemeKind.HighContrast;
      const themeClass =
        kind === vscode.ColorThemeKind.HighContrast
          ? 'vscode-high-contrast'
          : kind === vscode.ColorThemeKind.HighContrastLight
            ? 'vscode-high-contrast-light'
            : dark
              ? 'vscode-dark'
              : 'vscode-light';
      webviewPanel.webview.postMessage({ type: 'updateTheme', themeClass });
    };

    const applyMode = (next: EditorMode) => {
      mode = next;
      webviewPanel.webview.postMessage({ type: 'setMode', mode });
    };

    const changeDocSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return;
      if (Date.now() < ignoreDocEchoUntil) return;
      postDoc();
    });

    const themeSub = vscode.window.onDidChangeActiveColorTheme(() => postTheme());

    const modeSub = this.statusBar.onModeChange((next) => {
      if (!webviewPanel.visible) return;
      const m = toEditorMode(next);
      if (m === mode) return;
      applyMode(m);
    });

    const flushSourceEdit = async (source: string) => {
      if (source === document.getText()) return;
      ignoreDocEchoUntil = Date.now() + 400;
      const edit = new vscode.WorkspaceEdit();
      const full = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length)
      );
      edit.replace(document.uri, full, source);
      await vscode.workspace.applyEdit(edit);
    };

    const enqueueSourceEdit = (source: string) => {
      pendingSource = source;
      editChain = editChain
        .then(async () => {
          const latest = pendingSource;
          pendingSource = null;
          if (latest == null) return;
          await flushSourceEdit(latest);
          while (pendingSource != null) {
            const again = pendingSource;
            pendingSource = null;
            await flushSourceEdit(again);
          }
        })
        .catch(() => {
          /* keep chain */
        });
    };

    const msgSub = webviewPanel.webview.onDidReceiveMessage(async (msg) => {
      if (!msg || typeof msg.type !== 'string') return;
      switch (msg.type) {
        case 'webviewReady':
          postDoc();
          postTheme();
          break;
        case 'setMode': {
          const next = parseViewMode(msg.mode as string, ViewMode.Split);
          mode = toEditorMode(next);
          this.statusBar.syncFromWebview(mode);
          webviewPanel.webview.postMessage({ type: 'setMode', mode });
          break;
        }
        case 'sourceEdit': {
          if (typeof msg.source === 'string') enqueueSourceEdit(msg.source);
          break;
        }
        case 'copyPath': {
          if (typeof msg.path === 'string' && msg.path) {
            await vscode.env.clipboard.writeText(msg.path);
            void vscode.window.setStatusBarMessage(`已复制路径: ${msg.path}`, 2000);
          }
          break;
        }
        case 'copyText': {
          if (typeof msg.text === 'string') {
            await vscode.env.clipboard.writeText(msg.text);
            const label = typeof msg.label === 'string' ? msg.label : '已复制';
            void vscode.window.setStatusBarMessage(label, 2000);
          }
          break;
        }
        case 'formatYaml': {
          const src =
            typeof msg.source === 'string' ? msg.source : document.getText();
          const result = formatYaml(src);
          if (!result.ok) {
            void vscode.window.showWarningMessage(`格式化失败: ${result.error}`);
            break;
          }
          if (result.text !== document.getText()) {
            enqueueSourceEdit(result.text);
          }
          void vscode.window.setStatusBarMessage('YAML 已格式化', 2000);
          break;
        }
      }
    });

    const viewStateSub = webviewPanel.onDidChangeViewState((e) => {
      if (e.webviewPanel.active) {
        this.statusBar.syncFromWebview(mode);
      }
    });

    const cfgSub = vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration('yaml-reader.maxNodes') ||
        e.affectsConfiguration('yaml-reader.defaultExpandDepth')
      ) {
        postDoc();
      }
    });

    webviewPanel.onDidDispose(() => {
      changeDocSub.dispose();
      themeSub.dispose();
      modeSub.dispose();
      msgSub.dispose();
      viewStateSub.dispose();
      cfgSub.dispose();
    });
  }

  private getHtml(webview: vscode.Webview, initialMode: EditorMode): string {
    const base = vscode.Uri.joinPath(this.context.extensionUri, '02-webview-阅读界面');
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(base, 'webview-styles.css'));
    const mainJsUri = webview.asWebviewUri(vscode.Uri.joinPath(base, 'webview-main.js'));
    const csp = webview.cspSource;
    const mode = initialMode || 'split';

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src ${csp};">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="${cssUri}">
</head>
<body class="yaml-shell" data-mode="${mode}">
  <header class="yaml-header">
    <nav class="yaml-tabs" role="tablist" aria-label="布局">
      <button type="button" class="yaml-tab" role="tab" data-mode="split" title="左结构 · 右源码">分栏</button>
      <button type="button" class="yaml-tab" role="tab" data-mode="tree" title="仅结构树">树形</button>
      <button type="button" class="yaml-tab" role="tab" data-mode="source" title="仅源码">源码</button>
    </nav>
    <div class="yaml-toolbar" id="yaml-toolbar">
      <div class="yaml-search-wrap">
        <span class="yaml-search-icon" aria-hidden="true">⌕</span>
        <input type="search" id="yaml-search" class="yaml-search" placeholder="搜索 key / value / path… (⌘/Ctrl+F)" aria-label="搜索" />
        <button type="button" id="yaml-search-clear" class="yaml-search-clear" title="清除搜索" hidden aria-label="清除">×</button>
      </div>
      <button type="button" id="yaml-expand-all" class="yaml-btn" title="展开全部">展开</button>
      <button type="button" id="yaml-collapse-all" class="yaml-btn" title="折叠全部">折叠</button>
      <button type="button" id="yaml-format" class="yaml-btn" title="格式化 YAML">格式化</button>
      <button type="button" id="yaml-wrap" class="yaml-btn" title="源码自动换行">换行</button>
      <span id="yaml-meta" class="yaml-meta" aria-live="polite"></span>
    </div>
  </header>
  <main class="yaml-main" id="yaml-main">
    <section class="yaml-pane yaml-pane-tree" id="yaml-pane-tree" aria-label="结构">
      <div class="yaml-pane-title">结构</div>
      <div id="yaml-error" class="yaml-error" hidden role="alert"></div>
      <div id="yaml-breadcrumb" class="yaml-breadcrumb" aria-live="polite"></div>
      <div id="yaml-tree" class="yaml-tree" role="tree" aria-label="YAML 树"></div>
    </section>
    <div class="yaml-splitter" id="yaml-splitter" role="separator" aria-orientation="vertical" aria-label="拖动调整宽度" tabindex="0"></div>
    <section class="yaml-pane yaml-pane-source" id="yaml-pane-source" aria-label="源码">
      <div class="yaml-pane-title">源码 <span class="yaml-pane-sub">可编辑</span></div>
      <textarea id="yaml-source" class="yaml-source" spellcheck="false" wrap="off" aria-label="YAML 源码"></textarea>
    </section>
  </main>
  <footer class="yaml-footer">
    <span id="yaml-hint">点树定位源码 · 悬停复制路径/值/JSON · ⌘/Ctrl+F 搜索 · 格式化 · 拖分隔条</span>
  </footer>
  <script src="${mainJsUri}"></script>
</body>
</html>`;
  }
}
