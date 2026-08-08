export enum ViewMode {
  /** 左树右源码（默认，推荐） */
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

/** 分栏 → 源码 → 树形 → 分栏 */
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
