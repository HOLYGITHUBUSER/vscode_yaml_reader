import * as vscode from 'vscode';
import {
  EditorMode,
  getStatusBarText,
  parseViewMode,
  toggleView,
  ViewMode,
} from './viewMode';

export {
  EditorMode,
  getStatusBarText,
  parseViewMode,
  toggleView,
  ViewMode,
  toEditorMode,
} from './viewMode';

type ModeListener = (mode: ViewMode) => void;

export class StatusBarController implements vscode.Disposable {
  private item: vscode.StatusBarItem;
  private currentMode: ViewMode;
  private readonly listeners = new Set<ModeListener>();

  constructor(initial: ViewMode = ViewMode.Split) {
    this.currentMode = initial;
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    this.item.command = 'yaml-reader.toggleView';
    this.updateDisplay();
    this.item.show();
  }

  private updateDisplay(): void {
    this.item.text = getStatusBarText(this.currentMode);
    this.item.tooltip = '点击切换：分栏(左树右码) → 仅源码 → 仅树形';
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.currentMode);
      } catch {
        /* ignore */
      }
    }
  }

  onModeChange(listener: ModeListener): vscode.Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  toggle(): ViewMode {
    this.currentMode = toggleView(this.currentMode);
    this.updateDisplay();
    this.notify();
    return this.currentMode;
  }

  getMode(): ViewMode {
    return this.currentMode;
  }

  setMode(mode: ViewMode, opts?: { silent?: boolean }): void {
    this.currentMode = mode;
    this.updateDisplay();
    if (!opts?.silent) this.notify();
  }

  syncFromWebview(mode: EditorMode | string): void {
    this.currentMode = parseViewMode(mode, this.currentMode);
    this.updateDisplay();
  }

  dispose(): void {
    this.listeners.clear();
    this.item.dispose();
  }
}
