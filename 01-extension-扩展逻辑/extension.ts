import * as vscode from 'vscode';
import { PreviewProvider } from './previewProvider';
import { parseViewMode, StatusBarController, ViewMode } from './statusBarController';

const VIEW_TYPE = PreviewProvider.viewType;
const YAML_GLOBS = ['*.yaml', '*.yml'] as const;

let statusBarController: StatusBarController;
const reopening = new Set<string>();

export async function activate(context: vscode.ExtensionContext) {
  const defaultMode = parseViewMode(
    vscode.workspace.getConfiguration('yaml-reader').get<string>('defaultView', 'split'),
    ViewMode.Split
  );
  statusBarController = new StatusBarController(defaultMode);

  context.subscriptions.push(PreviewProvider.register(context, statusBarController));

  await syncEditorAssociations();

  context.subscriptions.push(
    vscode.commands.registerCommand('yaml-reader.openReader', async () => {
      const doc = await resolveYamlDocument();
      if (!doc) {
        void vscode.window.showInformationMessage('请先打开一个 YAML 文件');
        return;
      }
      await openWithReader(doc.uri);
    }),
    vscode.commands.registerCommand('yaml-reader.toggleView', () => {
      statusBarController.toggle();
    }),
    vscode.window.tabGroups.onDidChangeTabs(async (e) => {
      if (!isAutoEnabled()) return;
      for (const tab of e.opened) {
        await maybeReopenTextTabAsReader(tab);
      }
    }),
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration('yaml-reader.autoOpenReader')) {
        await syncEditorAssociations();
      }
    }),
    statusBarController
  );

  if (isAutoEnabled()) {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        void maybeReopenTextTabAsReader(tab);
      }
    }
  }
}

async function syncEditorAssociations(): Promise<void> {
  const config = vscode.workspace.getConfiguration('workbench');
  const current = { ...(config.get<Record<string, string>>('editorAssociations') ?? {}) };
  let changed = false;

  if (isAutoEnabled()) {
    for (const g of YAML_GLOBS) {
      if (current[g] !== VIEW_TYPE) {
        current[g] = VIEW_TYPE;
        changed = true;
      }
    }
  } else {
    for (const g of YAML_GLOBS) {
      if (current[g] === VIEW_TYPE) {
        delete current[g];
        changed = true;
      }
    }
  }
  if (!changed) return;

  try {
    await config.update('editorAssociations', current, vscode.ConfigurationTarget.Global);
  } catch {
    try {
      await config.update('editorAssociations', current, vscode.ConfigurationTarget.Workspace);
    } catch {
      /* ignore */
    }
  }
}

function isAutoEnabled(): boolean {
  return (
    vscode.workspace.getConfiguration('yaml-reader').get<boolean>('autoOpenReader', true) !== false
  );
}

function isYamlUri(uri: vscode.Uri): boolean {
  const f = uri.fsPath.toLowerCase();
  return f.endsWith('.yaml') || f.endsWith('.yml');
}

function isOpenAsReader(uri: vscode.Uri): boolean {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (
        input instanceof vscode.TabInputCustom &&
        input.viewType === VIEW_TYPE &&
        input.uri.toString() === uri.toString()
      ) {
        return true;
      }
    }
  }
  return false;
}

async function maybeReopenTextTabAsReader(tab: vscode.Tab): Promise<void> {
  const input = tab.input;
  if (!(input instanceof vscode.TabInputText)) return;
  if (!isYamlUri(input.uri)) return;
  if (isOpenAsReader(input.uri)) return;

  const key = input.uri.toString();
  if (reopening.has(key)) return;
  reopening.add(key);
  try {
    await openWithReader(input.uri, tab.group.viewColumn);
  } finally {
    setTimeout(() => reopening.delete(key), 800);
  }
}

async function openWithReader(uri: vscode.Uri, column?: vscode.ViewColumn): Promise<void> {
  await vscode.commands.executeCommand(
    'vscode.openWith',
    uri,
    VIEW_TYPE,
    column ?? vscode.ViewColumn.Active
  );
}

async function resolveYamlDocument(): Promise<vscode.TextDocument | undefined> {
  const active = vscode.window.activeTextEditor?.document;
  if (active && isYamlDoc(active)) return active;
  for (const e of vscode.window.visibleTextEditors) {
    if (isYamlDoc(e.document)) return e.document;
  }
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (input instanceof vscode.TabInputCustom && input.viewType === VIEW_TYPE) {
        try {
          return await vscode.workspace.openTextDocument(input.uri);
        } catch {
          /* continue */
        }
      }
      if (input instanceof vscode.TabInputText && isYamlUri(input.uri)) {
        try {
          return await vscode.workspace.openTextDocument(input.uri);
        } catch {
          /* continue */
        }
      }
    }
  }
  return undefined;
}

function isYamlDoc(doc: vscode.TextDocument): boolean {
  return (
    doc.languageId === 'yaml' ||
    doc.fileName.endsWith('.yaml') ||
    doc.fileName.endsWith('.yml')
  );
}

export function deactivate() {
  statusBarController?.dispose();
}
