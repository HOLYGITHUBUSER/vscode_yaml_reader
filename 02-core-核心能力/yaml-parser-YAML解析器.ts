import {
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseAllDocuments,
  type Node,
  type Pair,
  type Scalar
} from "yaml";
import type { YAMLError } from "yaml";
import type {
  ParseIssue,
  SourcePosition,
  SourceRange,
  TreeScalarEdit,
  YamlNodeType,
  YamlParseResult,
  YamlReaderNode
} from "./reader-model-阅读模型";
const VALUE_PREVIEW_LIMIT = 180;
const COMMENT_PREVIEW_LIMIT = 240;

interface VisitOptions {
  readonly parentId: string;
  readonly key: string;
  readonly path: string;
  readonly depth: number;
  readonly startOffset?: number;
  readonly leadingComment?: string;
  readonly treeEditContext?: TreeEditContext;
}

interface TreeEditContext {
  readonly kind: "mapping" | "sequence" | "document";
  readonly key?: string;
  readonly keyRange?: SourceRange;
}

interface MutableParseState {
  readonly text: string;
  readonly lineStarts: number[];
  readonly nodes: YamlReaderNode[];
  readonly rootIds: string[];
  readonly issues: ParseIssue[];
  readonly typeCounts: Record<YamlNodeType, number>;
  nextId: number;
  maxDepth: number;
}

const NODE_TYPES: readonly YamlNodeType[] = [
  "document",
  "map",
  "list",
  "string",
  "number",
  "boolean",
  "null",
  "alias",
  "unknown"
];

export function parseYamlDocument(text: string): YamlParseResult {
  const startedAt = performance.now();
  const state: MutableParseState = {
    text,
    lineStarts: buildLineStarts(text),
    nodes: [],
    rootIds: [],
    issues: [],
    typeCounts: createEmptyTypeCounts(),
    nextId: 0,
    maxDepth: 0
  };

  try {
    const documents = parseAllDocuments(text, {
      prettyErrors: false,
      strict: true,
      // yaml's built-in duplicate-key check is quadratic for very large maps.
      // We perform an equivalent linear check while building the flat model.
      uniqueKeys: false,
      // Keep integer source values exact while the tree is being built. The
      // Webview only receives strings, so a BigInt never crosses the worker
      // boundary, but it prevents an unsafe JS Number from changing YAML.
      intAsBigInt: true,
      version: "1.2"
    });

    if (documents.length === 0) {
      const emptyDocument = createNode(state, {
        id: nextNodeId(state),
        parentId: null,
        childIds: [],
        key: "Document 1",
        path: "$",
        type: "document",
        depth: 0,
        range: createRange(state.lineStarts, 0, text.length, text.length),
        valuePreview: "",
        itemCount: 0,
        tag: "",
        anchor: "",
        comment: ""
      });
      state.rootIds.push(emptyDocument.id);
    }

    documents.forEach((document, documentIndex) => {
      state.issues.push(
        ...document.errors.map((issue) =>
          convertIssue(issue, "error", state.lineStarts, text.length)
        ),
        ...document.warnings.map((issue) =>
          convertIssue(issue, "warning", state.lineStarts, text.length)
        )
      );

      const documentPath =
        documents.length === 1 ? "$" : `$doc[${documentIndex}]`;
      const documentRange = createRange(
        state.lineStarts,
        document.range?.[0] ?? 0,
        document.range?.[2] ?? text.length,
        text.length
      );
      const documentNode = createNode(state, {
        id: nextNodeId(state),
        parentId: null,
        childIds: [],
        key: `Document ${documentIndex + 1}`,
        path: documentPath,
        type: "document",
        depth: 0,
        range: documentRange,
        valuePreview: "",
        itemCount: getCollectionSize(document.contents),
        tag: "",
        anchor: "",
        comment: joinComments(
          document.commentBefore,
          document.contents?.commentBefore,
          document.contents?.comment,
          document.comment
        )
      });
      state.rootIds.push(documentNode.id);

      if (isMap(document.contents)) {
        appendMapChildren(state, document.contents.items, {
          parentId: documentNode.id,
          key: documentNode.key,
          path: documentPath,
          depth: 1
        });
      } else if (isSeq(document.contents)) {
        appendSequenceChildren(state, document.contents.items, {
          parentId: documentNode.id,
          key: documentNode.key,
          path: documentPath,
          depth: 1
        });
      } else if (document.contents !== null) {
        const childId = visitNode(state, document.contents, {
          parentId: documentNode.id,
          key: "value",
          path: `${documentPath}.value`,
          depth: 1
        });
        documentNode.childIds.push(childId);
      }
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown YAML parsing error";
    state.issues.push({
      severity: "error",
      code: "UNEXPECTED_PARSER_FAILURE",
      message,
      range: createRange(state.lineStarts, 0, 0, text.length)
    });
  }

  return {
    nodes: state.nodes,
    rootIds: state.rootIds,
    issues: state.issues,
    stats: {
      nodeCount: state.nodes.length,
      dataNodeCount: Math.max(0, state.nodes.length - state.rootIds.length),
      documentCount: state.rootIds.length,
      maxDepth: state.maxDepth,
      sourceBytes: new TextEncoder().encode(text).byteLength,
      typeCounts: state.typeCounts,
      parseDurationMs: performance.now() - startedAt
    }
  };
}

function appendMapChildren(
  state: MutableParseState,
  pairs: Pair<unknown, unknown>[],
  options: VisitOptions
): void {
  const parent = getNodeById(state, options.parentId);
  const seenScalarKeys = new Set<unknown>();

  pairs.forEach((pair) => {
    const key = formatKey(pair.key);
    const keyNode = isYamlNode(pair.key) ? pair.key : null;
    const editableKey =
      isScalar(pair.key) &&
      typeof pair.key.value === "string" &&
      pair.key.anchor === undefined &&
      pair.key.tag === undefined
        ? pair.key.value
        : undefined;
    const keyStart = keyNode?.range?.[0];
    const editableKeyRange = keyNode === null
      ? undefined
      : createTreeEditRange(state.lineStarts, keyNode, state.text.length);
    const value = isYamlNode(pair.value) ? pair.value : null;
    if (hasDuplicateScalarKey(seenScalarKeys, keyNode)) {
      state.issues.push({
        severity: "error",
        code: "DUPLICATE_KEY",
        message: `Map keys must be unique: ${key}`,
        range: createNodeRange(
          state.lineStarts,
          keyNode,
          state.text.length
        )
      });
    }
    const leadingComment = joinComments(
      keyNode?.commentBefore,
      keyNode?.comment
    );
    const childId = visitNode(state, value, {
      parentId: options.parentId,
      key,
      path: appendMapPath(options.path, key),
      depth: options.depth,
      ...(keyStart === undefined ? {} : { startOffset: keyStart }),
      ...(leadingComment.length === 0 ? {} : { leadingComment }),
      ...(editableKey === undefined || editableKeyRange === undefined
        ? {}
        : {
            treeEditContext: {
              kind: "mapping" as const,
              key: editableKey,
              keyRange: editableKeyRange
            }
          })
    });
    parent.childIds.push(childId);
  });
}

function appendSequenceChildren(
  state: MutableParseState,
  items: unknown[],
  options: VisitOptions
): void {
  const parent = getNodeById(state, options.parentId);

  items.forEach((item, index) => {
    const childId = visitNode(state, isYamlNode(item) ? item : null, {
      parentId: options.parentId,
      key: `[${index}]`,
      path: `${options.path}[${index}]`,
      depth: options.depth,
      treeEditContext: { kind: "sequence" }
    });
    parent.childIds.push(childId);
  });
}

function visitNode(
  state: MutableParseState,
  node: Node | null,
  options: VisitOptions
): string {
  const type = getNodeType(node);
  const sourceRange = createNodeRange(
    state.lineStarts,
    node,
    state.text.length,
    options.startOffset
  );
  const treeEdit = createTreeEdit(
    node,
    options.treeEditContext,
    createTreeEditRange(state.lineStarts, node, state.text.length),
    state.text
  );
  const readerNode = createNode(state, {
    id: nextNodeId(state),
    parentId: options.parentId,
    childIds: [],
    key: options.key,
    path: options.path,
    type,
    depth: options.depth,
    range: sourceRange,
    valuePreview: getValuePreview(node),
    itemCount: getCollectionSize(node),
    tag: node?.tag ?? "",
    anchor: getAnchor(node),
    comment: joinComments(options.leadingComment, getNodeComment(node)),
    ...(treeEdit === undefined ? {} : { treeEdit })
  });

  if (isMap(node)) {
    appendMapChildren(state, node.items, {
      parentId: readerNode.id,
      key: options.key,
      path: options.path,
      depth: options.depth + 1
    });
  } else if (isSeq(node)) {
    appendSequenceChildren(state, node.items, {
      parentId: readerNode.id,
      key: options.key,
      path: options.path,
      depth: options.depth + 1
    });
  }

  return readerNode.id;
}

function createTreeEdit(
  node: Node | null,
  context: TreeEditContext | undefined,
  valueRange: SourceRange,
  source: string
): TreeScalarEdit | undefined {
  if (
    context === undefined ||
    node === null ||
    !isScalar(node) ||
    node.anchor !== undefined ||
    node.tag !== undefined
  ) {
    return undefined;
  }
  if (rangeContainsLineBreak(source, valueRange)) {
    return undefined;
  }
  const value = node.value;
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "bigint" &&
    typeof value !== "boolean"
  ) {
    return undefined;
  }
  const rawValue = source.slice(valueRange.start.offset, valueRange.end.offset);
  if (typeof value === "number" || typeof value === "bigint") {
    if (!isEditableDecimalNumber(rawValue)) return undefined;
  }
  if (context.kind === "mapping") {
    if (context.key === undefined || context.keyRange === undefined) return undefined;
    if (rangeContainsLineBreak(source, context.keyRange)) return undefined;
    return {
      kind: "mapping",
      key: context.key,
      value: typeof value === "number" || typeof value === "bigint" ? rawValue : String(value),
      keyRange: context.keyRange,
      valueRange
    };
  }
  return {
    kind: context.kind,
    value: typeof value === "number" || typeof value === "bigint" ? rawValue : String(value),
    valueRange
  };
}

function hasDuplicateScalarKey(
  seenKeys: Set<unknown>,
  key: Node | null
): boolean {
  if (!isScalar(key)) return false;
  // yaml's native comparator uses ===, for which NaN never equals itself.
  if (typeof key.value === "number" && Number.isNaN(key.value)) return false;
  const identity = scalarKeyIdentity(key.value);
  if (seenKeys.has(identity)) return true;
  seenKeys.add(identity);
  return false;
}

function scalarKeyIdentity(value: unknown): unknown {
  // `intAsBigInt` protects large document values. Normalize only safe integral
  // Numbers so `1` and `1.0` retain the same duplicate-key behavior without
  // conflating a rounded unsafe Number with an exact BigInt.
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return BigInt(value);
  }
  return value;
}

function isEditableDecimalNumber(rawValue: string): boolean {
  return (
    /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?$/u.test(rawValue) &&
    Number.isFinite(Number(rawValue))
  );
}

function createNode(
  state: MutableParseState,
  node: YamlReaderNode
): YamlReaderNode {
  state.nodes.push(node);
  state.typeCounts[node.type] += 1;
  state.maxDepth = Math.max(state.maxDepth, node.depth);
  return node;
}

function getNodeById(
  state: MutableParseState,
  id: string
): YamlReaderNode {
  const numericId = Number(id.slice(1));
  const node = state.nodes[numericId];
  if (node?.id !== id) {
    throw new Error(`Internal node table is inconsistent for ${id}`);
  }
  return node;
}

function nextNodeId(state: MutableParseState): string {
  const id = `n${state.nextId}`;
  state.nextId += 1;
  return id;
}

function createEmptyTypeCounts(): Record<YamlNodeType, number> {
  return Object.fromEntries(NODE_TYPES.map((type) => [type, 0])) as Record<
    YamlNodeType,
    number
  >;
}

function buildLineStarts(text: string): number[] {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      starts.push(index + 1);
    }
  }
  return starts;
}

function offsetToPosition(
  lineStarts: readonly number[],
  rawOffset: number,
  sourceLength: number
): SourcePosition {
  const offset = clamp(Math.trunc(rawOffset), 0, sourceLength);
  let low = 0;
  let high = lineStarts.length - 1;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const lineStart = lineStarts[middle] ?? 0;
    const nextLineStart = lineStarts[middle + 1] ?? Number.POSITIVE_INFINITY;

    if (offset < lineStart) {
      high = middle - 1;
    } else if (offset >= nextLineStart) {
      low = middle + 1;
    } else {
      return {
        offset,
        line: middle + 1,
        column: offset - lineStart + 1
      };
    }
  }

  const lastLineIndex = Math.max(0, lineStarts.length - 1);
  return {
    offset,
    line: lastLineIndex + 1,
    column: offset - (lineStarts[lastLineIndex] ?? 0) + 1
  };
}

function createRange(
  lineStarts: readonly number[],
  rawStart: number,
  rawEnd: number,
  sourceLength: number
): SourceRange {
  const start = clamp(Math.trunc(rawStart), 0, sourceLength);
  const end = clamp(Math.max(start, Math.trunc(rawEnd)), start, sourceLength);
  return {
    start: offsetToPosition(lineStarts, start, sourceLength),
    end: offsetToPosition(lineStarts, end, sourceLength)
  };
}

function createNodeRange(
  lineStarts: readonly number[],
  node: Node | null,
  sourceLength: number,
  startOffset?: number
): SourceRange {
  const nodeStart = node?.range?.[0] ?? startOffset ?? 0;
  const start = startOffset ?? nodeStart;
  const end = node?.range?.[2] ?? node?.range?.[1] ?? start;
  return createRange(lineStarts, start, end, sourceLength);
}

function createTreeEditRange(
  lineStarts: readonly number[],
  node: Node | null,
  sourceLength: number
): SourceRange {
  const start = node?.range?.[0] ?? 0;
  const end = node?.range?.[1] ?? node?.range?.[0] ?? start;
  return createRange(lineStarts, start, end, sourceLength);
}

function rangeContainsLineBreak(source: string, range: SourceRange): boolean {
  return /[\r\n]/u.test(source.slice(range.start.offset, range.end.offset));
}

function convertIssue(
  issue: YAMLError,
  severity: "error" | "warning",
  lineStarts: readonly number[],
  sourceLength: number
): ParseIssue {
  return {
    severity,
    code: issue.code,
    message: issue.message,
    range: createRange(
      lineStarts,
      issue.pos[0],
      issue.pos[1],
      sourceLength
    )
  };
}

function getNodeType(node: Node | null): YamlNodeType {
  if (node === null) {
    return "null";
  }
  if (isMap(node)) {
    return "map";
  }
  if (isSeq(node)) {
    return "list";
  }
  if (isAlias(node)) {
    return "alias";
  }
  if (!isScalar(node)) {
    return "unknown";
  }

  if (node.value === null || node.value === undefined) {
    return "null";
  }
  switch (typeof node.value) {
    case "string":
      return "string";
    case "number":
    case "bigint":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "unknown";
  }
}

function getValuePreview(node: Node | null): string {
  if (node === null) {
    return "null";
  }
  if (isAlias(node)) {
    return `*${node.source}`;
  }
  if (!isScalar(node)) {
    return "";
  }

  const value = node.value;
  if (value === null || value === undefined) {
    return "null";
  }
  if (typeof value === "string") {
    const normalized = value.replace(/\s+/gu, " ").trim();
    return quoteAndTruncate(normalized, VALUE_PREVIEW_LIMIT);
  }
  if (
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  if (value instanceof Uint8Array) {
    return `<binary · ${value.byteLength} bytes>`;
  }
  return truncate(String(value), VALUE_PREVIEW_LIMIT);
}

function getCollectionSize(node: Node | null): number {
  if (isMap(node) || isSeq(node)) {
    return node.items.length;
  }
  return 0;
}

function getAnchor(node: Node | null): string {
  return node?.anchor ?? "";
}

function getNodeComment(node: Node | null): string {
  if (node === null) {
    return "";
  }
  return joinComments(node.commentBefore, node.comment);
}

function joinComments(
  ...comments: Array<string | null | undefined>
): string {
  return truncate(
    comments
      .filter((value): value is string => Boolean(value))
      .join("\n")
      .trim(),
    COMMENT_PREVIEW_LIMIT
  );
}

function formatKey(value: unknown): string {
  if (isScalar(value)) {
    return truncate(String(value.value ?? "null"), VALUE_PREVIEW_LIMIT);
  }
  if (isAlias(value)) {
    return `*${value.source}`;
  }
  if (isMap(value) || isSeq(value)) {
    return truncate(value.toString().replace(/\s+/gu, " "), VALUE_PREVIEW_LIMIT);
  }
  if (value === null || value === undefined) {
    return "null";
  }
  return truncate(String(value), VALUE_PREVIEW_LIMIT);
}

function appendMapPath(parentPath: string, key: string): string {
  if (/^[\p{L}_$][\p{L}\p{N}_$-]*$/u.test(key)) {
    return `${parentPath}.${key}`;
  }
  return `${parentPath}[${JSON.stringify(key)}]`;
}

function quoteAndTruncate(value: string, maxLength: number): string {
  const availableLength = Math.max(0, maxLength - 2);
  return `"${truncate(value, availableLength)}"`;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength <= 1) {
    return "…";
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function isYamlNode(value: unknown): value is Node {
  return (
    value !== null &&
    typeof value === "object" &&
    (isMap(value) || isSeq(value) || isScalar(value) || isAlias(value))
  );
}

export function scalarSourceValue(node: Scalar): string {
  return node.source ?? String(node.value ?? "");
}
