/** 布局模式（无 vscode 依赖，便于单测） */
export enum ViewMode {
  Split = 'split',
  Source = 'source',
  Tree = 'tree',
}

export type EditorMode = 'split' | 'source' | 'tree';

export function parseViewMode(raw: string | undefined | null, fallback: ViewMode): ViewMode {
  if (raw === 'source') return ViewMode.Source;
  if (raw === 'tree' || raw === 'preview') return ViewMode.Tree;
  if (raw === 'split' || raw === 'both') return ViewMode.Split;
  return fallback;
}

export function toggleView(mode: ViewMode): ViewMode {
  if (mode === ViewMode.Split) return ViewMode.Source;
  if (mode === ViewMode.Source) return ViewMode.Tree;
  return ViewMode.Split;
}

export function getStatusBarText(mode: ViewMode): string {
  if (mode === ViewMode.Source) return '$(code) YAML 源码';
  if (mode === ViewMode.Tree) return '$(list-tree) YAML 树形';
  return '$(split-horizontal) YAML 分栏';
}

export function toEditorMode(mode: ViewMode): EditorMode {
  if (mode === ViewMode.Source) return 'source';
  if (mode === ViewMode.Tree) return 'tree';
  return 'split';
}
