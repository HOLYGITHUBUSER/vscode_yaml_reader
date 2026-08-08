import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import {
  isWebviewToExtensionMessage,
  type DocumentPayload,
  type ExtensionToWebviewMessage,
  type WebviewToExtensionMessage,
  type ReaderSettings,
  type SourceRange
} from "../02-core-核心能力/reader-model-阅读模型";
import { formatYaml } from "../02-core-核心能力/yaml-formatter-YAML格式化器";

const OPEN_COMMAND = "yamlReader.openPreview";
const OPEN_WORKBENCH_COMMAND = "yamlReader.openWorkbench";
const YAML_EXTENSIONS = new Set([".yaml", ".yml"]);

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("YAML Reader", {
    log: true
  });
  const readerProvider = new YamlReaderProvider(
    context.extensionUri,
    output,
    "yamlReader.preview",
    "reader"
  );
  const workbenchProvider = new YamlReaderProvider(
    context.extensionUri,
    output,
    "yamlReader.workbench",
    "workbench"
  );

  context.subscriptions.push(
    output,
    vscode.window.registerCustomEditorProvider(
      readerProvider.viewType,
      readerProvider,
      {
        supportsMultipleEditorsPerDocument: true,
        webviewOptions: {
          retainContextWhenHidden: false
        }
      }
    ),
    vscode.window.registerCustomEditorProvider(
      workbenchProvider.viewType,
      workbenchProvider,
      {
        supportsMultipleEditorsPerDocument: true,
        webviewOptions: { retainContextWhenHidden: false }
      }
    ),
    vscode.commands.registerCommand(
      OPEN_COMMAND,
      async (resource?: vscode.Uri): Promise<void> => {
        const uri = resolveYamlResource(resource);
        if (uri === undefined) {
          await vscode.window.showInformationMessage(
            "请先打开或选择一个 .yaml / .yml 文件。"
          );
          return;
        }
        if (!isYamlUri(uri)) {
          await vscode.window.showWarningMessage(
            "YAML Reader 仅支持 .yaml 和 .yml 文件。"
          );
          return;
        }

        await vscode.commands.executeCommand(
          "vscode.openWith",
          uri,
          readerProvider.viewType,
          vscode.ViewColumn.Active
        );
      }
    ),
    vscode.commands.registerCommand(
      OPEN_WORKBENCH_COMMAND,
      async (resource?: vscode.Uri): Promise<void> => {
        const uri = resolveYamlResource(resource);
        if (uri === undefined || !isYamlUri(uri)) {
          await vscode.window.showWarningMessage("请先打开或选择一个 .yaml / .yml 文件。");
          return;
        }
        await vscode.commands.executeCommand(
          "vscode.openWith",
          uri,
          workbenchProvider.viewType,
          vscode.ViewColumn.Active
        );
      }
    )
  );

  output.appendLine("YAML Reader activated.");
}

export function deactivate(): void {
  // VS Code disposes extension subscriptions.
}

function resolveYamlResource(resource?: vscode.Uri): vscode.Uri | undefined {
  if (resource instanceof vscode.Uri) {
    return resource;
  }
  const activeTextEditorUri = vscode.window.activeTextEditor?.document.uri;
  if (activeTextEditorUri !== undefined) {
    return activeTextEditorUri;
  }
  const activeTabInput = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  if (activeTabInput instanceof vscode.TabInputCustom) {
    return activeTabInput.uri;
  }
  return undefined;
}

function isYamlUri(uri: vscode.Uri): boolean {
  const lowerPath = uri.path.toLowerCase();
  return [...YAML_EXTENSIONS].some((extension) =>
    lowerPath.endsWith(extension)
  );
}

const FILE_CHANGE_DEBOUNCE_MS = 250;
const MAX_REPORTED_ERROR_LENGTH = 2_000;
const CONFIGURATION_SECTION = "yamlReader";

class YamlReaderDocument implements vscode.CustomDocument {
  public constructor(
    public readonly uri: vscode.Uri,
    public readonly initialData: Uint8Array | undefined
  ) {}

  public dispose(): void {
    // Each editor panel owns its listeners.
  }
}

class YamlReaderProvider
  implements vscode.CustomReadonlyEditorProvider<YamlReaderDocument>
{
  public constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly output: vscode.OutputChannel,
    public readonly viewType: "yamlReader.preview" | "yamlReader.workbench",
    private readonly mode: "reader" | "workbench"
  ) {}

  public openCustomDocument(
    uri: vscode.Uri,
    openContext: vscode.CustomDocumentOpenContext
  ): YamlReaderDocument {
    return new YamlReaderDocument(uri, openContext.untitledDocumentData);
  }

  public async resolveCustomEditor(
    document: YamlReaderDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const panelDisposables: vscode.Disposable[] = [];
    let version = 0;
    let latestText = "";
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    webviewPanel.title = `${getFileName(document.uri)} · ${this.mode === "reader" ? "YAML Reader" : "YAML Workbench"}`;
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, "07-artifacts-安装包", "webview")
      ]
    };
    webviewPanel.webview.html = createWebviewHtml(
      webviewPanel.webview,
      this.extensionUri
    );

    const createPayload = async (
      preferredText?: string
    ): Promise<DocumentPayload> => {
      latestText =
        preferredText ??
        (await readDocumentText(document.uri, document.initialData));
      version += 1;
      return {
        uri: document.uri.toString(),
        fileName: getFileName(document.uri),
        version,
        text: latestText,
        mode: this.mode,
        settings: readReaderSettings(document.uri)
      };
    };

    const postDocument = async (
      type: "document/open" | "document/changed",
      preferredText?: string
    ): Promise<void> => {
      try {
        const payload = await createPayload(preferredText);
        if (!disposed) {
          await postMessage(webviewPanel.webview, { type, payload });
        }
      } catch (error) {
        this.reportError(`无法读取 ${document.uri.toString()}`, error);
        if (!disposed) {
          await vscode.window.showErrorMessage(
            `YAML Reader 无法读取文件：${errorMessage(error)}`
          );
        }
      }
    };

    const scheduleRefresh = (preferredText?: string): void => {
      if (refreshTimer !== undefined) {
        clearTimeout(refreshTimer);
      }
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        void postDocument("document/changed", preferredText);
      }, FILE_CHANGE_DEBOUNCE_MS);
    };

    panelDisposables.push(
      webviewPanel.webview.onDidReceiveMessage((message: unknown) => {
        if (!isWebviewToExtensionMessage(message)) {
          this.output.appendLine(
            `[warning] Ignored an invalid webview message for ${document.uri.toString()}`
          );
          return;
        }
        if (message.type === "webview/ready") {
          void postDocument("document/open");
          return;
        }
        void this.handleWebviewMessage(
          message,
          document.uri,
          () => latestText,
          version
        ).catch((error: unknown) => {
          this.reportError("处理阅读页消息失败", error);
        });
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (sameUri(event.document.uri, document.uri)) {
          scheduleRefresh(event.document.getText());
        }
      }),
      vscode.workspace.onDidSaveTextDocument((textDocument) => {
        if (sameUri(textDocument.uri, document.uri)) {
          scheduleRefresh(textDocument.getText());
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("yamlReader", document.uri)) {
          void postMessage(webviewPanel.webview, {
            type: "settings/changed",
            settings: readReaderSettings(document.uri)
          });
        }
      })
    );

    const watcher = createDocumentWatcher(document.uri);
    if (watcher !== undefined) {
      panelDisposables.push(
        watcher,
        watcher.onDidChange(() => {
          scheduleRefresh();
        }),
        watcher.onDidCreate(() => {
          scheduleRefresh();
        })
      );
    }

    panelDisposables.push(
      webviewPanel.onDidDispose(() => {
        disposed = true;
        if (refreshTimer !== undefined) {
          clearTimeout(refreshTimer);
          refreshTimer = undefined;
        }
        for (const disposable of panelDisposables.splice(0)) {
          disposable.dispose();
        }
      })
    );
  }

  private async handleWebviewMessage(
    message: Exclude<WebviewToExtensionMessage, { readonly type: "webview/ready" }>,
    uri: vscode.Uri,
    getLatestText: () => string,
    currentVersion: number
  ): Promise<void> {
    switch (message.type) {
      case "source/reveal":
        await revealSource(uri, message.range);
        return;
      case "clipboard/write":
        await copyToClipboard(message, getLatestText());
        return;
      case "error/report":
        this.output.appendLine(
          `[webview] ${message.message.slice(0, MAX_REPORTED_ERROR_LENGTH)}`
        );
        return;
      case "document/save":
        await this.saveWorkbenchDocument(uri, message, getLatestText(), currentVersion);
        return;
      case "document/format": {
        const formatted = formatYaml(message.text);
        if (!formatted.ok) {
          await vscode.window.showWarningMessage(`YAML 格式化失败：${formatted.error}`);
          return;
        }
        await this.saveWorkbenchDocument(
          uri,
          { type: "document/save", text: formatted.text, version: message.version },
          getLatestText(),
          currentVersion
        );
        return;
      }
    }
  }

  private async saveWorkbenchDocument(
    uri: vscode.Uri,
    message: Extract<WebviewToExtensionMessage, { readonly type: "document/save" }>,
    latestText: string,
    currentVersion: number
  ): Promise<void> {
    if (this.mode !== "workbench") {
      this.output.appendLine(`[warning] Blocked write request from read-only view: ${uri.toString()}`);
      return;
    }
    if (message.version !== currentVersion) {
      await vscode.window.showWarningMessage("文件已在其他位置变更，已拒绝覆盖；请等待 YAML Workbench 同步后重试。");
      return;
    }
    const valid = formatYaml(message.text);
    if (!valid.ok) {
      await vscode.window.showWarningMessage(`YAML 无法保存：${valid.error}`);
      return;
    }
    const document = await vscode.workspace.openTextDocument(uri);
    if (document.getText() !== latestText) {
      await vscode.window.showWarningMessage("文件已在其他位置变更，已拒绝覆盖；请等待 YAML Workbench 同步后重试。");
      return;
    }
    if (message.text === latestText) return;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, fullDocumentRange(document), message.text);
    if (!await vscode.workspace.applyEdit(edit)) {
      await vscode.window.showErrorMessage("YAML Workbench 未能写入文件。");
    }
  }

  private reportError(context: string, error: unknown): void {
    this.output.appendLine(`[error] ${context}: ${errorMessage(error)}`);
  }
}

function readReaderSettings(resource?: vscode.Uri): ReaderSettings {
  const configuration = vscode.workspace.getConfiguration(
    CONFIGURATION_SECTION,
    resource
  );
  return {
    defaultExpandDepth: clampInteger(
      configuration.get<number>("defaultExpandDepth", 3),
      0,
      6
    ),
    rowHeight: clampInteger(configuration.get<number>("rowHeight", 18), 18, 44),
    rememberExpansion: configuration.get<boolean>("rememberExpansion", true),
    searchDebounceMs: clampInteger(
      configuration.get<number>("searchDebounceMs", 120),
      0,
      1000
    )
  };
}

function createWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri
): string {
  const nonce = randomBytes(18).toString("base64url");
  const webviewRoot = vscode.Uri.joinPath(
    extensionUri,
    "07-artifacts-安装包",
    "webview"
  );
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(webviewRoot, "webview-main-主界面.js")
  );
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, "webview-style-页面样式.css"));
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `font-src ${webview.cspSource}`,
    `style-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}' ${webview.cspSource}`,
    `worker-src ${webview.cspSource} blob:`,
    "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'"
  ].join("; ");
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <link rel="stylesheet" href="${styleUri}">
    <title>YAML Reader</title>
  </head>
  <body>
    <div id="app" aria-live="polite"></div>
    <noscript>YAML Reader 需要启用 JavaScript 才能显示本地阅读界面。</noscript>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
}

async function postMessage(
  webview: vscode.Webview,
  message: ExtensionToWebviewMessage
): Promise<void> {
  await webview.postMessage(message);
}

async function readDocumentText(uri: vscode.Uri, initialData: Uint8Array | undefined): Promise<string> {
  const openDocument = vscode.workspace.textDocuments.find((candidate) => sameUri(candidate.uri, uri));
  if (openDocument !== undefined) return openDocument.getText();
  if (initialData !== undefined) return new TextDecoder("utf-8").decode(initialData);
  return new TextDecoder("utf-8").decode(await vscode.workspace.fs.readFile(uri));
}

async function revealSource(uri: vscode.Uri, range: SourceRange): Promise<void> {
  const textDocument = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(textDocument, {
    viewColumn: vscode.ViewColumn.Beside,
    preserveFocus: false,
    preview: true
  });
  const selection = toVscodeRange(textDocument, range);
  editor.selection = new vscode.Selection(selection.start, selection.start);
  editor.revealRange(selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

function fullDocumentRange(document: vscode.TextDocument): vscode.Range {
  return new vscode.Range(
    document.positionAt(0),
    document.positionAt(document.getText().length)
  );
}

async function copyToClipboard(
  message: Extract<WebviewToExtensionMessage, { readonly type: "clipboard/write" }>,
  latestText: string
): Promise<void> {
  if (message.value.kind === "text") {
    await vscode.env.clipboard.writeText(message.value.text);
    return;
  }
  const start = clampOffset(message.value.range.start.offset, latestText.length);
  const end = clampOffset(message.value.range.end.offset, latestText.length);
  await vscode.env.clipboard.writeText(latestText.slice(Math.min(start, end), Math.max(start, end)));
}

function toVscodeRange(document: vscode.TextDocument, range: SourceRange): vscode.Range {
  const textLength = document.getText().length;
  return new vscode.Range(
    document.positionAt(clampOffset(range.start.offset, textLength)),
    document.positionAt(clampOffset(range.end.offset, textLength))
  );
}

function createDocumentWatcher(uri: vscode.Uri): vscode.FileSystemWatcher | undefined {
  if (uri.scheme === "untitled") return undefined;
  const segments = uri.path.split("/");
  const fileName = segments.pop();
  if (fileName === undefined || fileName.length === 0) return undefined;
  return vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(uri.with({ path: segments.join("/") || "/" }), fileName),
    false,
    false,
    true
  );
}

function getFileName(uri: vscode.Uri): string {
  const fileName = uri.path.split("/").pop();
  return fileName === undefined || fileName.length === 0 ? "Untitled.yaml" : decodeURIComponent(fileName);
}

function sameUri(left: vscode.Uri, right: vscode.Uri): boolean {
  return left.toString() === right.toString();
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function clampOffset(offset: number, textLength: number): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.min(textLength, Math.max(0, Math.trunc(offset)));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
