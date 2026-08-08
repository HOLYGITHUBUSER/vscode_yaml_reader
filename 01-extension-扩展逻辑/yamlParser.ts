/**
 * 用 eemeli/yaml 解析，保留 range，构建阅读用树。
 * 参考：Red Hat vscode-yaml 亦采用 eemeli/yaml。
 */
import {
  isMap,
  isPair,
  isScalar,
  isSeq,
  parseAllDocuments,
  type ParsedNode,
  type Pair,
  type YAMLMap,
  type YAMLSeq,
} from 'yaml';
import type { ParseOptions, ParseResult, YamlNode, YamlValueType } from './yamlModel';

export type {
  ParseErr,
  ParseOk,
  ParseOptions,
  ParseResult,
  YamlNode,
  YamlValueType,
} from './yamlModel';

let idSeq = 0;

export function resetIdSeqForTests(): void {
  idSeq = 0;
}

function nextId(): string {
  idSeq += 1;
  return `n${idSeq}`;
}

export function detectType(value: unknown): YamlValueType {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'string') return 'string';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'object') return 'object';
  return 'unknown';
}

export function formatScalar(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'NaN';
    if (!Number.isFinite(value)) return value > 0 ? 'Infinity' : '-Infinity';
    return String(value);
  }
  return String(value);
}

export function joinPath(parent: string, key: string): string {
  if (!parent) return key;
  if (/^\d+$/.test(key)) return `${parent}[${key}]`;
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return `${parent}.${key}`;
  return `${parent}[${JSON.stringify(key)}]`;
}

function rangeOf(node: { range?: number[] | null } | null | undefined): YamlNode['range'] {
  const r = node?.range;
  if (!r || r.length < 2) return undefined;
  const start = r[0];
  const end = r[1] ?? r[0];
  if (typeof start !== 'number' || typeof end !== 'number') return undefined;
  return { start, end: Math.max(start, end) };
}

interface BuildCtx {
  maxNodes: number;
  nodeCount: number;
  truncated: boolean;
}

function typeOfParsed(node: ParsedNode | null | undefined): YamlValueType {
  if (node == null) return 'null';
  if (isMap(node)) return 'object';
  if (isSeq(node)) return 'array';
  if (isScalar(node)) {
    const v = node.toJSON();
    return detectType(v);
  }
  return 'unknown';
}

function buildFromParsed(
  key: string,
  node: ParsedNode | null | undefined,
  parentPath: string,
  ctx: BuildCtx
): YamlNode | null {
  if (ctx.nodeCount >= ctx.maxNodes) {
    ctx.truncated = true;
    return null;
  }
  ctx.nodeCount += 1;

  const path = joinPath(parentPath, key);
  const id = nextId();
  const range = rangeOf(node ?? undefined);
  const type = typeOfParsed(node);

  if (isMap(node)) {
    const map = node as YAMLMap;
    const items = map.items.filter((it): it is Pair => isPair(it));
    const children: YamlNode[] = [];
    for (const pair of items) {
      if (ctx.nodeCount >= ctx.maxNodes) {
        ctx.truncated = true;
        break;
      }
      const kNode = pair.key;
      let k = '';
      if (isScalar(kNode)) k = String(kNode.toJSON() ?? '');
      else if (kNode != null) k = String(kNode.toString());
      const child = buildFromParsed(k, pair.value as ParsedNode | null, path, ctx);
      if (child) {
        // 优先用 pair 的 range 覆盖 key 区域以便点 key 能跳到键
        const pr = rangeOf(pair as { range?: number[] });
        if (pr) child.range = pr;
        children.push(child);
      }
    }
    return {
      id,
      key,
      type: 'object',
      valueText: '',
      path,
      range,
      children,
      childCount: items.length,
      truncated: children.length < items.length,
    };
  }

  if (isSeq(node)) {
    const seq = node as YAMLSeq;
    const children: YamlNode[] = [];
    for (let i = 0; i < seq.items.length; i++) {
      if (ctx.nodeCount >= ctx.maxNodes) {
        ctx.truncated = true;
        break;
      }
      const item = seq.items[i] as ParsedNode | null;
      const child = buildFromParsed(String(i), item, path, ctx);
      if (child) children.push(child);
    }
    return {
      id,
      key,
      type: 'array',
      valueText: '',
      path,
      range,
      children,
      childCount: seq.items.length,
      truncated: children.length < seq.items.length,
    };
  }

  // scalar / null
  let valueText = 'null';
  if (isScalar(node)) {
    valueText = formatScalar(node.toJSON());
  } else if (node != null) {
    valueText = String(node.toString());
  }

  return {
    id,
    key,
    type,
    valueText,
    path,
    range,
    children: [],
    childCount: 0,
  };
}

/**
 * 解析 YAML 源码为阅读树。支持 --- 多文档。
 */
export function parseYamlToTree(source: string, options: ParseOptions = {}): ParseResult {
  const maxNodes = options.maxNodes ?? 5000;
  idSeq = 0;
  const trimmed = source.replace(/^\uFEFF/, '');

  if (trimmed.trim() === '') {
    return {
      ok: true,
      roots: [],
      documentCount: 0,
      nodeCount: 0,
      truncated: false,
      maxNodes,
    };
  }

  let docs;
  try {
    docs = parseAllDocuments(trimmed, {
      prettyErrors: true,
      uniqueKeys: false,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      error: msg,
      roots: [
        {
          id: nextId(),
          key: '⚠ 解析错误',
          type: 'error',
          valueText: msg,
          path: '',
          children: [],
          childCount: 0,
        },
      ],
    };
  }

  // 收集文档级错误
  const docErrors = docs
    .map((d, i) => ({ i, errs: d.errors }))
    .filter((x) => x.errs.length > 0);

  if (docErrors.length && docs.every((d) => d.errors.length > 0 && !d.contents)) {
    const first = docErrors[0].errs[0];
    const msg = first?.message || 'YAML parse error';
    const line = first?.linePos?.[0].line;
    const column = first?.linePos?.[0].col;
    return {
      ok: false,
      error: msg,
      line,
      column,
      roots: [
        {
          id: nextId(),
          key: '⚠ 解析错误',
          type: 'error',
          valueText: msg,
          path: '',
          children: [],
          childCount: 0,
        },
      ],
    };
  }

  const validDocs = docs.filter((d) => d.contents != null || d.errors.length === 0);
  const ctx: BuildCtx = { maxNodes, nodeCount: 0, truncated: false };
  const roots: YamlNode[] = [];

  if (validDocs.length === 0) {
    return {
      ok: true,
      roots: [],
      documentCount: 0,
      nodeCount: 0,
      truncated: false,
      maxNodes,
    };
  }

  if (validDocs.length === 1) {
    const only = validDocs[0].contents as ParsedNode | null;
    const t = typeOfParsed(only);
    if (t === 'object' && isMap(only)) {
      const map = only as YAMLMap;
      for (const pair of map.items) {
        if (!isPair(pair)) continue;
        const kNode = pair.key;
        let k = '';
        if (isScalar(kNode)) k = String(kNode.toJSON() ?? '');
        else if (kNode != null) k = String(kNode.toString());
        const child = buildFromParsed(k, pair.value as ParsedNode | null, '', ctx);
        if (child) {
          const pr = rangeOf(pair as { range?: number[] });
          if (pr) child.range = pr;
          roots.push(child);
        }
      }
    } else if (t === 'array' && isSeq(only)) {
      const seq = only as YAMLSeq;
      for (let i = 0; i < seq.items.length; i++) {
        const child = buildFromParsed(String(i), seq.items[i] as ParsedNode, '', ctx);
        if (child) roots.push(child);
      }
    } else {
      const child = buildFromParsed('(root)', only, '', ctx);
      if (child) roots.push(child);
    }
  } else {
    for (let d = 0; d < validDocs.length; d++) {
      const contents = validDocs[d].contents as ParsedNode | null;
      const child = buildFromParsed(`document[${d}]`, contents, '', ctx);
      if (child) {
        child.type = child.type === 'error' ? 'error' : 'document';
        // document 根标为 document 类型以便图标
        if (child.type !== 'error') {
          // keep object/array/scalar but path starts with document[i]
        }
        roots.push(child);
      }
    }
  }

  // 部分文档有错误时附加提示节点
  if (docErrors.length > 0) {
    const msgs = docErrors.map((e) => `doc${e.i}: ${e.errs[0]?.message || 'error'}`).join('; ');
    roots.unshift({
      id: nextId(),
      key: '⚠ 部分解析警告',
      type: 'error',
      valueText: msgs,
      path: '',
      children: [],
      childCount: 0,
    });
  }

  return {
    ok: true,
    roots,
    documentCount: validDocs.length,
    nodeCount: ctx.nodeCount,
    truncated: ctx.truncated,
    maxNodes,
  };
}

/** 过滤树：匹配 key/value/path，保留祖先 */
export function filterTree(nodes: YamlNode[], query: string): YamlNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;

  function clone(n: YamlNode): YamlNode {
    return { ...n, children: n.children.map(clone) };
  }

  function match(n: YamlNode): YamlNode | null {
    const kids = n.children.map(match).filter((c): c is YamlNode => c !== null);
    const self =
      n.key.toLowerCase().includes(q) ||
      n.valueText.toLowerCase().includes(q) ||
      n.path.toLowerCase().includes(q);
    if (self || kids.length > 0) {
      return { ...n, children: self ? n.children.map(clone) : kids };
    }
    return null;
  }

  return nodes.map(match).filter((n): n is YamlNode => n !== null);
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 展示文案（单测 / 状态） */
export function nodeLabel(n: YamlNode): string {
  if (n.type === 'error') return n.key;
  return n.key || '(root)';
}

export function nodeDescription(n: YamlNode): string {
  if (n.type === 'error') {
    const v = n.valueText || '';
    return v.length > 60 ? v.slice(0, 57) + '…' : v;
  }
  if (n.type === 'object') return `{${n.childCount}}${n.truncated ? '…' : ''}`;
  if (n.type === 'array') return `[${n.childCount}]${n.truncated ? '…' : ''}`;
  if (n.type === 'document') return 'document';
  if (n.type === 'string') {
    const shown = n.valueText.length > 48 ? n.valueText.slice(0, 45) + '…' : n.valueText;
    return `"${shown}"`;
  }
  return n.valueText;
}

export function nodeTooltip(n: YamlNode): string {
  const lines = [n.path ? `路径: ${n.path}` : '（根）', `类型: ${n.type}`];
  if (n.valueText && n.type !== 'object' && n.type !== 'array') {
    lines.push(`值: ${n.valueText}`);
  }
  if (n.truncated) lines.push('（子节点已截断）');
  return lines.join('\n');
}

/** 树节点还原为 JS 值（用于复制 JSON；截断树可能不完整） */
export function nodeToJs(n: YamlNode): unknown {
  if (n.type === 'object' || n.type === 'document') {
    const o: Record<string, unknown> = {};
    for (const c of n.children) {
      o[c.key] = nodeToJs(c);
    }
    return o;
  }
  if (n.type === 'array') {
    return n.children.map(nodeToJs);
  }
  if (n.type === 'null' || n.type === 'error') {
    if (n.type === 'null') return null;
    return n.valueText;
  }
  if (n.type === 'boolean') return n.valueText === 'true';
  if (n.type === 'number') {
    const num = Number(n.valueText);
    return Number.isFinite(num) ? num : n.valueText;
  }
  return n.valueText;
}

export function nodeToJson(n: YamlNode, pretty = true): string {
  return JSON.stringify(nodeToJs(n), null, pretty ? 2 : undefined);
}

/**
 * 格式化 YAML（保留多文档）。失败返回 error。
 */
export function formatYaml(source: string): { ok: true; text: string } | { ok: false; error: string } {
  const trimmed = source.replace(/^\uFEFF/, '');
  if (trimmed.trim() === '') {
    return { ok: true, text: '' };
  }
  try {
    const docs = parseAllDocuments(trimmed, { prettyErrors: true, uniqueKeys: false });
    const hardFail = docs.every((d) => d.errors.length > 0 && d.contents == null);
    if (hardFail && docs[0]?.errors[0]) {
      return { ok: false, error: docs[0].errors[0].message };
    }
    const chunks = docs
      .filter((d) => d.contents != null || d.errors.length === 0)
      .map((d) => d.toString({ lineWidth: 120 }).replace(/\s+$/, ''));
    if (chunks.length === 0) {
      return { ok: false, error: docs[0]?.errors[0]?.message || '无法格式化' };
    }
    let text = chunks.join('\n---\n');
    if (!text.endsWith('\n')) text += '\n';
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
