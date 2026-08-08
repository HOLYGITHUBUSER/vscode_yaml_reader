/** 树节点值类型 */
export type YamlValueType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'object'
  | 'array'
  | 'unknown'
  | 'document'
  | 'error';

/**
 * 路径是第一公民：所有导航/复制围绕 path。
 * range 为文档内字符偏移 [start, end)，用于跳转高亮。
 */
export interface YamlNode {
  id: string;
  key: string;
  type: YamlValueType;
  /** 标量展示；容器可为空 */
  valueText: string;
  path: string;
  /** 字符偏移 [start, end) */
  range?: { start: number; end: number };
  children: YamlNode[];
  childCount: number;
  truncated?: boolean;
}

export interface ParseOk {
  ok: true;
  roots: YamlNode[];
  documentCount: number;
  nodeCount: number;
  truncated: boolean;
  maxNodes: number;
}

export interface ParseErr {
  ok: false;
  error: string;
  line?: number;
  column?: number;
  /** 错误时也可挂一个 error 根节点供树展示 */
  roots: YamlNode[];
}

export type ParseResult = ParseOk | ParseErr;

export interface ParseOptions {
  maxNodes?: number;
}
