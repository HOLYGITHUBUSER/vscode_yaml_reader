export type YamlNodeType =
  | "document"
  | "map"
  | "list"
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "alias"
  | "unknown";

export interface SourcePosition {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

export interface SourceRange {
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

export type TreeScalarEdit =
  | {
      readonly kind: "mapping";
      readonly key: string;
      readonly value: string;
      readonly keyRange: SourceRange;
      readonly valueRange: SourceRange;
    }
  | {
      readonly kind: "sequence" | "document";
      readonly value: string;
      readonly valueRange: SourceRange;
    };

export interface TreeScalarEditInput {
  readonly key?: string;
  readonly value: string;
}

export type TreeScalarEditResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly error: string };

export interface YamlReaderNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly childIds: string[];
  readonly key: string;
  readonly path: string;
  readonly type: YamlNodeType;
  readonly depth: number;
  readonly range: SourceRange;
  readonly valuePreview: string;
  readonly itemCount: number;
  readonly tag: string;
  readonly anchor: string;
  readonly comment: string;
  readonly treeEdit?: TreeScalarEdit;
}

export type ParseIssueSeverity = "error" | "warning";

export interface ParseIssue {
  readonly severity: ParseIssueSeverity;
  readonly code: string;
  readonly message: string;
  readonly range: SourceRange;
}

export interface YamlParseStats {
  readonly nodeCount: number;
  readonly dataNodeCount: number;
  readonly documentCount: number;
  readonly maxDepth: number;
  readonly sourceBytes: number;
  readonly typeCounts: Record<YamlNodeType, number>;
  readonly parseDurationMs: number;
}

export interface YamlParseResult {
  readonly nodes: YamlReaderNode[];
  readonly rootIds: string[];
  readonly issues: ParseIssue[];
  readonly stats: YamlParseStats;
}

export interface ReaderSettings {
  readonly defaultExpandDepth: number;
  readonly rowHeight: number;
  readonly rememberExpansion: boolean;
  readonly searchDebounceMs: number;
}

export interface PersistedReaderState {
  readonly expandedIds: string[];
  readonly selectedId: string | null;
}

export interface BreadcrumbItem {
  readonly id: string;
  readonly label: string;
}

export interface SearchProjection {
  readonly orderedMatchIds: string[];
  readonly matchIds: ReadonlySet<string>;
  readonly visibleIds: string[];
}

export interface VirtualWindow {
  readonly startIndex: number;
  readonly endIndex: number;
  readonly offsetTop: number;
  readonly totalHeight: number;
}

export interface DocumentPayload {
  readonly uri: string;
  readonly fileName: string;
  readonly version: number;
  readonly text: string;
  readonly mode: "reader" | "workbench";
  readonly settings: ReaderSettings;
}

export type ExtensionToWebviewMessage =
  | { readonly type: "document/open"; readonly payload: DocumentPayload }
  | { readonly type: "document/changed"; readonly payload: DocumentPayload }
  | { readonly type: "settings/changed"; readonly settings: ReaderSettings };

export type WebviewToExtensionMessage =
  | { readonly type: "webview/ready" }
  | { readonly type: "source/reveal"; readonly range: SourceRange }
  | {
      readonly type: "clipboard/write";
      readonly value:
        | { readonly kind: "text"; readonly text: string }
        | { readonly kind: "source"; readonly range: SourceRange };
    }
  | { readonly type: "error/report"; readonly message: string }
  | { readonly type: "document/save"; readonly text: string; readonly version: number }
  | { readonly type: "document/format"; readonly text: string; readonly version: number };

export type ParserWorkerRequest = {
  readonly type: "parse";
  readonly requestId: number;
  readonly text: string;
};

export type ParserWorkerResponse =
  | { readonly type: "parse/success"; readonly requestId: number; readonly result: YamlParseResult }
  | { readonly type: "parse/failure"; readonly requestId: number; readonly message: string };

type UnknownRecord = Record<string, unknown>;

export function isWebviewToExtensionMessage(
  value: unknown
): value is WebviewToExtensionMessage {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "webview/ready":
      return true;
    case "source/reveal":
      return isSourceRange(value.range);
    case "clipboard/write":
      if (!isRecord(value.value) || typeof value.value.kind !== "string") return false;
      return value.value.kind === "text"
        ? typeof value.value.text === "string"
        : value.value.kind === "source" && isSourceRange(value.value.range);
    case "error/report":
      return typeof value.message === "string";
    case "document/save":
    case "document/format":
      return typeof value.text === "string" && isFiniteNumber(value.version) && value.version >= 1;
    default:
      return false;
  }
}

export function isExtensionToWebviewMessage(
  value: unknown
): value is ExtensionToWebviewMessage {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "settings/changed") return isReaderSettings(value.settings);
  if (value.type !== "document/open" && value.type !== "document/changed") return false;
  return isRecord(value.payload) &&
    typeof value.payload.uri === "string" &&
    typeof value.payload.fileName === "string" &&
    isFiniteNumber(value.payload.version) &&
    typeof value.payload.text === "string" &&
    (value.payload.mode === "reader" || value.payload.mode === "workbench") &&
    isReaderSettings(value.payload.settings);
}

export function isReaderSettings(value: unknown): value is ReaderSettings {
  return isRecord(value) &&
    isFiniteNumber(value.defaultExpandDepth) && value.defaultExpandDepth >= 0 && value.defaultExpandDepth <= 6 &&
    isFiniteNumber(value.rowHeight) && value.rowHeight >= 18 && value.rowHeight <= 44 &&
    typeof value.rememberExpansion === "boolean" &&
    isFiniteNumber(value.searchDebounceMs) && value.searchDebounceMs >= 0 && value.searchDebounceMs <= 1000;
}

export type NodeIndex = ReadonlyMap<string, YamlReaderNode>;
type SearchField = "any" | "key" | "value" | "type" | "path";
interface SearchToken { readonly field: SearchField; readonly value: string; }

export function createNodeIndex(nodes: readonly YamlReaderNode[]): Map<string, YamlReaderNode> {
  return new Map(nodes.map((node) => [node.id, node]));
}

export function expandedIdsForDepth(nodes: readonly YamlReaderNode[], depth: number): Set<string> {
  const normalizedDepth = Math.max(0, Math.trunc(depth));
  return new Set(nodes.filter((node) => node.childIds.length > 0 && node.depth < normalizedDepth).map((node) => node.id));
}

export function allExpandableIds(nodes: readonly YamlReaderNode[]): Set<string> {
  return new Set(nodes.filter((node) => node.childIds.length > 0).map((node) => node.id));
}

export function flattenVisibleNodeIds(nodeIndex: NodeIndex, rootIds: readonly string[], expandedIds: ReadonlySet<string>): string[] {
  const visibleIds: string[] = [];
  const stack = [...rootIds].reverse();
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined) continue;
    const node = nodeIndex.get(id);
    if (node === undefined) continue;
    visibleIds.push(id);
    if (expandedIds.has(id)) {
      for (let index = node.childIds.length - 1; index >= 0; index -= 1) {
        const childId = node.childIds[index];
        if (childId !== undefined) stack.push(childId);
      }
    }
  }
  return visibleIds;
}

export function flattenAllNodeIds(nodeIndex: NodeIndex, rootIds: readonly string[]): string[] {
  return flattenVisibleNodeIds(nodeIndex, rootIds, allExpandableIds([...nodeIndex.values()]));
}

export function searchNodeProjection(nodeIndex: NodeIndex, rootIds: readonly string[], rawQuery: string): SearchProjection {
  const tokens = parseSearchTokens(rawQuery);
  if (tokens.length === 0) return { orderedMatchIds: [], matchIds: new Set(), visibleIds: [] };
  const allIds = flattenAllNodeIds(nodeIndex, rootIds);
  const orderedMatchIds = allIds.filter((id) => {
    const node = nodeIndex.get(id);
    return node !== undefined && tokens.every((token) => matches(node, token));
  });
  const matchIds = new Set(orderedMatchIds);
  const contextIds = new Set<string>();
  for (const matchId of orderedMatchIds) {
    let currentId: string | null = matchId;
    while (currentId !== null && !contextIds.has(currentId)) {
      contextIds.add(currentId);
      currentId = nodeIndex.get(currentId)?.parentId ?? null;
    }
  }
  return { orderedMatchIds, matchIds, visibleIds: allIds.filter((id) => contextIds.has(id)) };
}

export function getBreadcrumbs(nodeIndex: NodeIndex, selectedId: string | null): BreadcrumbItem[] {
  if (selectedId === null) return [];
  const breadcrumbs: BreadcrumbItem[] = [];
  let currentId: string | null = selectedId;
  const visited = new Set<string>();
  while (currentId !== null && !visited.has(currentId)) {
    visited.add(currentId);
    const node = nodeIndex.get(currentId);
    if (node === undefined) break;
    breadcrumbs.push({ id: node.id, label: node.key });
    currentId = node.parentId;
  }
  return breadcrumbs.reverse();
}

export function retainExistingIds(ids: ReadonlySet<string>, nodeIndex: NodeIndex): Set<string> {
  return new Set([...ids].filter((id) => nodeIndex.has(id)));
}

export function getVirtualWindow(totalItems: number, scrollTop: number, viewportHeight: number, rowHeight: number, overscan = 8): VirtualWindow {
  const safeTotal = Math.max(0, Math.trunc(totalItems));
  const safeRowHeight = Math.max(1, rowHeight);
  const safeViewportHeight = Math.max(0, viewportHeight);
  const safeScrollTop = Math.max(0, scrollTop);
  const safeOverscan = Math.max(0, Math.trunc(overscan));
  const firstVisibleIndex = Math.floor(safeScrollTop / safeRowHeight);
  const visibleCount = Math.ceil(safeViewportHeight / safeRowHeight);
  const startIndex = Math.max(0, firstVisibleIndex - safeOverscan);
  const endIndex = Math.min(safeTotal, firstVisibleIndex + visibleCount + safeOverscan);
  return { startIndex, endIndex: Math.max(startIndex, endIndex), offsetTop: startIndex * safeRowHeight, totalHeight: safeTotal * safeRowHeight };
}

export function findAdjacentSelection(visibleIds: readonly string[], currentId: string | null, delta: -1 | 1): string | null {
  if (visibleIds.length === 0) return null;
  const currentIndex = currentId === null ? -1 : visibleIds.indexOf(currentId);
  if (currentIndex < 0) return delta > 0 ? visibleIds[0] ?? null : visibleIds[visibleIds.length - 1] ?? null;
  return visibleIds[Math.min(visibleIds.length - 1, Math.max(0, currentIndex + delta))] ?? null;
}

export function applyTreeScalarEdit(
  source: string,
  node: YamlReaderNode,
  input: TreeScalarEditInput
): TreeScalarEditResult {
  const descriptor = node.treeEdit;
  if (descriptor === undefined) {
    return { ok: false, error: "该节点需在右侧源码中编辑。" };
  }
  const scalar = serializeTreeScalar(node.type, input.value);
  if (typeof scalar !== "string") {
    return scalar;
  }

  const replacements: Array<{ readonly range: SourceRange; readonly text: string }> = [
    { range: descriptor.valueRange, text: scalar }
  ];
  if (descriptor.kind === "mapping") {
    const key = input.key ?? descriptor.key;
    if (key.trim().length === 0) {
      return { ok: false, error: "键名不能为空。" };
    }
    replacements.push({
      range: descriptor.keyRange,
      text: serializeMappingKey(key)
    });
  }
  const validated = validateSourceReplacements(source, replacements);
  if (!validated.ok) return validated;
  return {
    ok: true,
    text: replacements
      .slice()
      .sort((left, right) => right.range.start.offset - left.range.start.offset)
      .reduce(
        (text, replacement) =>
          `${text.slice(0, replacement.range.start.offset)}${replacement.text}${text.slice(replacement.range.end.offset)}`,
        source
      )
  };
}

function isRecord(value: unknown): value is UnknownRecord { return typeof value === "object" && value !== null; }
function isFiniteNumber(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function isSourceRange(value: unknown): value is SourceRange {
  return isRecord(value) && isRecord(value.start) && isRecord(value.end) &&
    [value.start, value.end].every((position) => isFiniteNumber(position.offset) && isFiniteNumber(position.line) && isFiniteNumber(position.column));
}
function parseSearchTokens(rawQuery: string): SearchToken[] {
  const fragments = rawQuery.match(/(?:[^\s"]+|"[^"]*")+/gu) ?? [];
  return fragments.map((fragment): SearchToken | null => {
    const unquoted = fragment.replace(/^"(.*)"$/u, "$1").trim();
    if (unquoted.length === 0) return null;
    const separatorIndex = unquoted.indexOf(":");
    if (separatorIndex > 0) {
      const prefix = unquoted.slice(0, separatorIndex).toLowerCase();
      const value = unquoted.slice(separatorIndex + 1).toLowerCase();
      if (value.length > 0 && (prefix === "key" || prefix === "value" || prefix === "type" || prefix === "path")) return { field: prefix, value };
    }
    return { field: "any", value: unquoted.toLowerCase() };
  }).filter((token): token is SearchToken => token !== null);
}
function matches(node: YamlReaderNode, token: SearchToken): boolean {
  const key = node.key.toLowerCase();
  const value = node.valuePreview.toLowerCase();
  const type = node.type.toLowerCase();
  const path = node.path.toLowerCase();
  switch (token.field) {
    case "key": return key.includes(token.value);
    case "value": return value.includes(token.value);
    case "type": return type.includes(token.value);
    case "path": return path.includes(token.value);
    case "any": return [key, value, type, path].some((candidate) => candidate.includes(token.value));
  }
}

function serializeTreeScalar(
  type: YamlNodeType,
  rawValue: string
): string | Extract<TreeScalarEditResult, { readonly ok: false }> {
  switch (type) {
    case "string":
      return JSON.stringify(rawValue);
    case "number": {
      const value = rawValue.trim();
      if (
        !/^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/u.test(value) ||
        !Number.isFinite(Number(value))
      ) {
        return { ok: false, error: "数字必须是有限的十进制值。" };
      }
      return value;
    }
    case "boolean": {
      const value = rawValue.trim().toLowerCase();
      if (value !== "true" && value !== "false") {
        return { ok: false, error: "布尔值只能是 true 或 false。" };
      }
      return value;
    }
    default:
      return { ok: false, error: "该节点需在右侧源码中编辑。" };
  }
}

function serializeMappingKey(key: string): string {
  const plain = key === key.trim() && /^[\p{L}_$][\p{L}\p{N}_$-]*$/u.test(key);
  const ambiguous = /^(?:null|true|false|yes|no|on|off|~)$/iu.test(key);
  return plain && !ambiguous ? key : JSON.stringify(key);
}

function validateSourceReplacements(
  source: string,
  replacements: readonly { readonly range: SourceRange; readonly text: string }[]
): Extract<TreeScalarEditResult, { readonly ok: false }> | { readonly ok: true } {
  const ranges = replacements
    .map(({ range }) => ({ start: range.start.offset, end: range.end.offset }))
    .sort((left, right) => left.start - right.start);
  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index];
    const previous = ranges[index - 1];
    if (
      range === undefined ||
      !Number.isInteger(range.start) ||
      !Number.isInteger(range.end) ||
      range.start < 0 ||
      range.end < range.start ||
      range.end > source.length ||
      (previous !== undefined && previous.end > range.start)
    ) {
      return { ok: false, error: "节点源码范围无效，无法安全编辑。" };
    }
  }
  return { ok: true };
}
