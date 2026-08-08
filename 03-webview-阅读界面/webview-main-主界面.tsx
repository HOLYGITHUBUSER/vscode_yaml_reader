import { render, type JSX } from "preact";
import {
  useEffect,
  useMemo,
  useRef,
  useState
} from "preact/hooks";
import {
  isExtensionToWebviewMessage,
  type DocumentPayload
} from "../02-core-核心能力/reader-model-阅读模型";
import {
  applyTreeScalarEdit,
  allExpandableIds,
  createNodeIndex,
  expandedIdsForDepth,
  findAdjacentSelection,
  flattenVisibleNodeIds,
  getBreadcrumbs,
  retainExistingIds,
  searchNodeProjection
} from "../02-core-核心能力/reader-model-阅读模型";
import type {
  BreadcrumbItem,
  ParseIssue,
  PersistedReaderState,
  ReaderSettings,
  SourceRange,
  WebviewToExtensionMessage,
  YamlParseResult,
  YamlReaderNode
} from "../02-core-核心能力/reader-model-阅读模型";
import {
  getVirtualWindow,
  type NodeIndex,
  type ParserWorkerRequest,
  type ParserWorkerResponse
} from "../02-core-核心能力/reader-model-阅读模型";
import ParserWorker from "./parser-worker-解析线程.ts?worker&inline";
import "./webview-style-页面样式.css";

const DEFAULT_SETTINGS: ReaderSettings = {
  defaultExpandDepth: 3,
  rowHeight: 18,
  rememberExpansion: true,
  searchDebounceMs: 120
};

export function App(): JSX.Element {
  const vscodeApi = useMemo(() => getVsCodeApi(), []);
  const workerRef = useRef<ParserWorkerClient | null>(null);
  const sourceEditorRef = useRef<HTMLTextAreaElement>(null);
  const latestRequestRef = useRef(0);
  const currentUriRef = useRef("");
  const resultRef = useRef<YamlParseResult | null>(null);
  const resultSourceRef = useRef("");
  const sourceGenerationRef = useRef(0);
  const treeEditInFlightRef = useRef(false);

  const [mode, setMode] = useState<"reader" | "workbench">("reader");
  const [sourceText, setSourceText] = useState("");
  const [syncedSourceText, setSyncedSourceText] = useState("");
  const [documentUri, setDocumentUri] = useState("");
  const [settings, setSettings] =
    useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [result, setResult] = useState<YamlParseResult | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [parsing, setParsing] = useState(true);
  const [parseError, setParseError] = useState<string | null>(null);
  const [sourceUpdateCount, setSourceUpdateCount] = useState(0);
  const [toast, setToast] = useState("");
  const [treeEditNodeId, setTreeEditNodeId] = useState<string | null>(null);
  const [treeEditKey, setTreeEditKey] = useState("");
  const [treeEditValue, setTreeEditValue] = useState("");
  const [treeEditError, setTreeEditError] = useState("");
  const [treeEditInFlight, setTreeEditInFlight] = useState(false);

  useEffect(() => {
    let disposed = false;
    let worker: ParserWorkerClient;
    try {
      worker = new ParserWorkerClient();
      workerRef.current = worker;
    } catch (error) {
      const message = readableError(error);
      setParseError(message);
      setParsing(false);
      vscodeApi.postMessage({
        type: "error/report",
        message: `Parser worker startup failed: ${message}`
      });
      return;
    }

    const parsePayload = async (
      payload: DocumentPayload,
      changed: boolean
    ): Promise<void> => {
      if (payload.version < latestRequestRef.current) {
        return;
      }
      latestRequestRef.current = payload.version;
      const requestVersion = payload.version;
      setMode(payload.mode);
      sourceGenerationRef.current += 1;
      setSourceText(payload.text);
      setSyncedSourceText(payload.text);
      setDocumentUri(payload.uri);
      setSettings(payload.settings);
      setParsing(true);
      setParseError(null);

      try {
        const nextResult = await worker.parse(payload.text);
        if (disposed || requestVersion !== latestRequestRef.current) {
          return;
        }
        const nextIndex = createNodeIndex(nextResult.nodes);
        const isSameDocument = currentUriRef.current === payload.uri;
        const persisted = vscodeApi.getState();
        const canRestore =
          payload.settings.rememberExpansion &&
          persisted?.uri === payload.uri;

        setExpandedIds((current) => {
          if (isSameDocument && resultRef.current !== null) {
            return retainExistingIds(current, nextIndex);
          }
          if (canRestore) {
            return retainExistingIds(
              new Set(persisted.reader.expandedIds),
              nextIndex
            );
          }
          return allExpandableIds(nextResult.nodes);
        });
        setSelectedId((current) => {
          if (isSameDocument && current !== null && nextIndex.has(current)) {
            return current;
          }
          const restoredId = canRestore
            ? persisted.reader.selectedId
            : null;
          return restoredId !== null && nextIndex.has(restoredId)
            ? restoredId
            : nextResult.rootIds[0] ?? null;
        });

        currentUriRef.current = payload.uri;
        resultRef.current = nextResult;
        resultSourceRef.current = payload.text;
        setResult(nextResult);
        setTreeEditNodeId(null);
        setTreeEditError("");
        treeEditInFlightRef.current = false;
        setTreeEditInFlight(false);
        setParsing(false);
        if (changed) {
          setSourceUpdateCount((count) => count + 1);
        }
      } catch (error) {
        if (disposed || requestVersion !== latestRequestRef.current) {
          return;
        }
        const message = readableError(error);
        setParseError(message);
        setParsing(false);
        vscodeApi.postMessage({
          type: "error/report",
          message: `YAML parse failed: ${message}`
        });
      }
    };

    const handleMessage = (event: MessageEvent<unknown>): void => {
      if (!isExtensionToWebviewMessage(event.data)) {
        return;
      }
      const message = event.data;
      if (message.type === "settings/changed") {
        setSettings(message.settings);
        return;
      }
      void parsePayload(
        message.payload,
        message.type === "document/changed"
      );
    };

    window.addEventListener("message", handleMessage);
    vscodeApi.postMessage({ type: "webview/ready" });

    return () => {
      disposed = true;
      window.removeEventListener("message", handleMessage);
      worker.dispose();
      workerRef.current = null;
    };
  }, [vscodeApi]);

  useEffect(() => {
    if (
      documentUri.length === 0 ||
      result === null ||
      !settings.rememberExpansion
    ) {
      return;
    }
    vscodeApi.setState({
      uri: documentUri,
      reader: {
        expandedIds: [...expandedIds],
        selectedId
      },
      settings
    });
  }, [
    documentUri,
    expandedIds,
    result,
    selectedId,
    settings,
    vscodeApi
  ]);

  useEffect(() => {
    if (toast.length === 0) {
      return;
    }
    const timer = window.setTimeout(() => {
      setToast("");
    }, 1_600);
    return () => {
      window.clearTimeout(timer);
    };
  }, [toast]);

  useEffect(() => {
    if (selectedId === null || result === null) return;
    const node = result.nodes.find((candidate) => candidate.id === selectedId);
    const editor = sourceEditorRef.current;
    if (node === undefined || editor === null) return;
    const start = positionSourceCursor(editor, node.range, sourceText);
    const line = sourceText.slice(0, start).split("\n").length - 1;
    const lineHeight = Number.parseFloat(getComputedStyle(editor).lineHeight) || 20;
    editor.scrollTop = Math.max(0, (line - 3) * lineHeight);
    // Deliberately do not depend on sourceText: every keystroke updates it,
    // and re-positioning here would make the cursor jump while editing.
  }, [result, selectedId]);

  const debouncedQuery = useDebouncedValue(
    query,
    settings.searchDebounceMs
  );
  const nodeIndex = useMemo(
    () => createNodeIndex(result?.nodes ?? []),
    [result]
  );
  const searchProjection = useMemo(
    () =>
      searchNodeProjection(
        nodeIndex,
        result?.rootIds ?? [],
        debouncedQuery
      ),
    [debouncedQuery, nodeIndex, result]
  );
  const searchActive = debouncedQuery.trim().length > 0;
  const visibleIds = useMemo(
    () =>
      searchActive
        ? searchProjection.visibleIds
        : flattenVisibleNodeIds(
            nodeIndex,
            result?.rootIds ?? [],
            expandedIds
          ),
    [
      expandedIds,
      nodeIndex,
      result,
      searchActive,
      searchProjection.visibleIds
    ]
  );
  const breadcrumbs = useMemo(
    () => getBreadcrumbs(nodeIndex, selectedId),
    [nodeIndex, selectedId]
  );
  const activeMatchIndex = Math.max(
    0,
    searchProjection.orderedMatchIds.indexOf(selectedId ?? "")
  );

  useEffect(() => {
    if (
      !searchActive ||
      searchProjection.orderedMatchIds.length === 0 ||
      (selectedId !== null && searchProjection.matchIds.has(selectedId))
    ) {
      return;
    }
    setSelectedId(searchProjection.orderedMatchIds[0] ?? null);
  }, [
    searchActive,
    searchProjection.matchIds,
    searchProjection.orderedMatchIds,
    selectedId
  ]);

  const toggleNode = (id: string): void => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const applyExpansionPreset = (depth: ExpansionPreset): void => {
    if (result !== null) setExpandedIds(expandedIdsForDepth(result.nodes, depth));
  };

  const revealRange = (
    item: Pick<YamlReaderNode | ParseIssue, "range">
  ): void => {
    vscodeApi.postMessage({
      type: "source/reveal",
      range: item.range
    });
  };

  const copyText = (text: string, announcement: string): void => {
    vscodeApi.postMessage({
      type: "clipboard/write",
      value: { kind: "text", text }
    });
    setToast(announcement);
  };

  const copySource = (node: YamlReaderNode): void => {
    vscodeApi.postMessage({
      type: "clipboard/write",
      value: { kind: "source", range: node.range }
    });
    setToast("已复制当前子树源码");
  };

  const selectNodeForSourceOffset = (offset: number): void => {
    if (result === null) return;
    const node = result.nodes
      .filter((candidate) => candidate.range.start.offset <= offset && offset <= candidate.range.end.offset)
      .sort((left, right) => right.depth - left.depth)[0];
    if (node !== undefined) setSelectedId(node.id);
  };

  const moveMatch = (delta: -1 | 1): void => {
    const matches = searchProjection.orderedMatchIds;
    if (matches.length === 0) {
      return;
    }
    const currentIndex = matches.indexOf(selectedId ?? "");
    const baseIndex = currentIndex < 0 ? (delta > 0 ? -1 : 0) : currentIndex;
    const nextIndex = (baseIndex + delta + matches.length) % matches.length;
    setSelectedId(matches[nextIndex] ?? null);
  };

  const handleTreeKeyDown = (
    event: JSX.TargetedKeyboardEvent<HTMLDivElement>
  ): void => {
    if (result === null) {
      return;
    }
    const selectedNode =
      selectedId === null ? undefined : nodeIndex.get(selectedId);
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        setSelectedId(
          findAdjacentSelection(visibleIds, selectedId, delta)
        );
        return;
      }
      case "ArrowLeft":
        event.preventDefault();
        if (selectedNode === undefined) {
          return;
        }
        if (expandedIds.has(selectedNode.id)) {
          toggleNode(selectedNode.id);
        } else {
          setSelectedId(selectedNode.parentId);
        }
        return;
      case "ArrowRight":
        event.preventDefault();
        if (selectedNode === undefined || selectedNode.childIds.length === 0) {
          return;
        }
        if (!expandedIds.has(selectedNode.id)) {
          toggleNode(selectedNode.id);
        } else {
          setSelectedId(selectedNode.childIds[0] ?? selectedNode.id);
        }
        return;
      case "Enter":
        event.preventDefault();
        if (selectedNode?.childIds.length) {
          toggleNode(selectedNode.id);
        } else if (selectedNode !== undefined) {
          revealRange(selectedNode);
        }
        return;
      case "/":
        event.preventDefault();
        document.querySelector<HTMLInputElement>(
          "#yaml-reader-search"
        )?.focus();
    }
  };

  const startTreeEdit = (node: YamlReaderNode): void => {
    if (
      mode !== "workbench" ||
      node.treeEdit === undefined ||
      treeEditInFlightRef.current
    ) {
      return;
    }
    if (sourceText !== resultSourceRef.current) {
      setToast("右侧源码有未解析的修改，请先保存或刷新后再编辑树");
      return;
    }
    setTreeEditNodeId(node.id);
    setTreeEditKey(node.treeEdit.kind === "mapping" ? node.treeEdit.key : "");
    setTreeEditValue(node.treeEdit.value);
    setTreeEditError("");
  };

  const applyTreeEdit = (): void => {
    if (treeEditNodeId === null) {
      return;
    }
    const node = nodeIndex.get(treeEditNodeId);
    if (node === undefined || node.treeEdit === undefined) {
      setTreeEditNodeId(null);
      return;
    }
    if (sourceText !== resultSourceRef.current) {
      setTreeEditError("右侧源码已变更，请先保存或刷新后再编辑树。");
      return;
    }
    if (treeEditInFlightRef.current) {
      return;
    }
    const edit = applyTreeScalarEdit(sourceText, node, {
      ...(node.treeEdit.kind === "mapping" ? { key: treeEditKey } : {}),
      value: treeEditValue
    });
    if (!edit.ok) {
      setTreeEditError(edit.error);
      return;
    }
    treeEditInFlightRef.current = true;
    setTreeEditInFlight(true);
    void reparseTreeEditedSource(edit.text);
  };

  const reparseTreeEditedSource = async (nextSource: string): Promise<void> => {
    const worker = workerRef.current;
    if (worker === null) {
      setTreeEditError("解析线程尚未就绪，请稍后重试。");
      treeEditInFlightRef.current = false;
      setTreeEditInFlight(false);
      return;
    }
    const sourceVersion = latestRequestRef.current;
    const sourceGeneration = sourceGenerationRef.current;
    setParsing(true);
    setParseError(null);
    try {
      const nextResult = await worker.parse(nextSource);
      if (
        sourceVersion !== latestRequestRef.current ||
        sourceGeneration !== sourceGenerationRef.current
      ) {
        treeEditInFlightRef.current = false;
        setTreeEditInFlight(false);
        setTreeEditNodeId(null);
        setTreeEditError("");
        setParsing(false);
        setToast("源码已在解析期间变更，未应用左侧修改");
        return;
      }
      const duplicateKey = nextResult.issues.find(
        (issue) => issue.code === "DUPLICATE_KEY"
      );
      if (duplicateKey !== undefined) {
        treeEditInFlightRef.current = false;
        setTreeEditInFlight(false);
        setTreeEditError("同一映射不能包含重复键。");
        setParsing(false);
        return;
      }
      const nextIndex = createNodeIndex(nextResult.nodes);
      resultSourceRef.current = nextSource;
      resultRef.current = nextResult;
      sourceGenerationRef.current += 1;
      setSourceText(nextSource);
      setResult(nextResult);
      setExpandedIds((current) => retainExistingIds(current, nextIndex));
      setSelectedId((current) =>
        current !== null && nextIndex.has(current)
          ? current
          : nextResult.rootIds[0] ?? null
      );
      setTreeEditNodeId(null);
      setTreeEditError("");
      treeEditInFlightRef.current = false;
      setTreeEditInFlight(false);
      setParsing(false);
      setToast("左侧修改已同步到源码，点击保存写入文件");
    } catch (error) {
      setTreeEditError(`无法解析修改后的 YAML：${readableError(error)}`);
      treeEditInFlightRef.current = false;
      setTreeEditInFlight(false);
      setParsing(false);
    }
  };

  const updateSourceText = (nextSource: string): void => {
    sourceGenerationRef.current += 1;
    setSourceText(nextSource);
  };

  const saveSource = (): void => {
    vscodeApi.postMessage({
      type: "document/save",
      text: sourceText,
      version: latestRequestRef.current
    });
    setToast("已请求保存，正在同步文件");
  };

  const formatSource = (): void => {
    vscodeApi.postMessage({
      type: "document/format",
      text: sourceText,
      version: latestRequestRef.current
    });
  };

  if (result === null && parseError !== null) {
    return <FatalState message={parseError} />;
  }

  if (result === null) {
    return <LoadingState />;
  }

  const activeTreeEditNode =
    treeEditNodeId === null ? undefined : nodeIndex.get(treeEditNodeId);
  const treeEditingEnabled =
    mode === "workbench" &&
    sourceText === resultSourceRef.current &&
    treeEditNodeId === null &&
    !treeEditInFlight;

  return (
    <main class="app-shell">
      {breadcrumbs.length > 1 ? <Breadcrumbs items={breadcrumbs} onSelect={setSelectedId} /> : null}
      <IssuePanel issues={result.issues} onReveal={revealRange} />
      {sourceUpdateCount > 0 ? (
        <div class="update-banner" role="status">
          <span aria-hidden="true">↻</span>
          已同步源码变更
        </div>
      ) : null}
      {parseError !== null ? (
        <div class="inline-error" role="alert">
          后台刷新失败：{parseError}
        </div>
      ) : null}
      <section class="reader-surface reader-surface--workbench" aria-busy={parsing}>
        {parsing ? (
          <div class="parsing-indicator" role="status">
            正在后台解析…
          </div>
        ) : null}
        <div class="tree-pane">{visibleIds.length > 0 ? (
          <VirtualTree
            nodeIndex={nodeIndex}
            visibleIds={visibleIds}
            expandedIds={expandedIds}
            selectedId={selectedId}
            matchIds={searchProjection.matchIds}
            rowHeight={settings.rowHeight}
            onToggle={toggleNode}
            onSelect={setSelectedId}
            onReveal={revealRange}
            onCopyValue={(node) => {
              copyText(node.valuePreview, "已复制显示值");
            }}
            onCopyPath={(node) => {
              copyText(node.path, "已复制 YAML 路径");
            }}
            onCopySource={copySource}
            onKeyDown={handleTreeKeyDown}
            editable={treeEditingEnabled}
            onEdit={startTreeEdit}
          />
        ) : (
          <div class="empty-state">
            <span aria-hidden="true">⌕</span>
            <strong>没有匹配节点</strong>
            <p>尝试缩短关键词，或使用 key:、value:、type:、path:。</p>
          </div>
        )}{activeTreeEditNode !== undefined ? (
          <TreeEditForm
            node={activeTreeEditNode}
            keyValue={treeEditKey}
            value={treeEditValue}
            error={treeEditError}
            busy={treeEditInFlight}
            onKeyChange={setTreeEditKey}
            onValueChange={setTreeEditValue}
            onApply={applyTreeEdit}
            onCancel={() => {
              setTreeEditNodeId(null);
              setTreeEditError("");
            }}
          />
        ) : null}<TreeSearch query={query} matchCount={searchProjection.orderedMatchIds.length} activeMatchNumber={searchProjection.orderedMatchIds.length === 0 ? 0 : activeMatchIndex + 1} onQueryChange={setQuery} onSetExpansion={applyExpansionPreset} onPreviousMatch={() => moveMatch(-1)} onNextMatch={() => moveMatch(1)} /></div>
        <SourceEditor editorRef={(editor) => { sourceEditorRef.current = editor; }} source={sourceText} readOnly allowSave={mode === "workbench"} sourceDirty={sourceText !== syncedSourceText} onInput={updateSourceText} onCursorChange={selectNodeForSourceOffset} onSave={saveSource} onFormat={formatSource} />
      </section>
      {toast.length > 0 ? (
        <div class="toast" role="status">
          ✓ {toast}
        </div>
      ) : null}
    </main>
  );
}

function LoadingState(): JSX.Element {
  return (
    <main class="startup-state" aria-busy="true">
      <span class="startup-state__mark">Y</span>
      <strong>正在准备 YAML Reader</strong>
      <span>解析将在本地后台线程中完成</span>
      <span class="startup-state__pulse" aria-hidden="true" />
    </main>
  );
}

function FatalState({ message }: { readonly message: string }): JSX.Element {
  return (
    <main class="startup-state startup-state--error" role="alert">
      <span class="startup-state__mark">!</span>
      <strong>无法启动 YAML 阅读器</strong>
      <span>{message}</span>
      <span>源文件没有被修改，可以继续使用普通文本编辑器打开。</span>
    </main>
  );
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), Math.max(0, delayMs));
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);
  return debouncedValue;
}

interface WebviewState {
  readonly uri: string;
  readonly reader: PersistedReaderState;
  readonly settings: ReaderSettings;
}

interface VsCodeApi<State> {
  postMessage(message: WebviewToExtensionMessage): void;
  getState(): State | undefined;
  setState(state: State): State;
}

declare global {
  function acquireVsCodeApi<State = unknown>(): VsCodeApi<State>;
}

let cachedApi: VsCodeApi<WebviewState> | undefined;

function getVsCodeApi(): VsCodeApi<WebviewState> {
  if (cachedApi !== undefined) return cachedApi;
  if (typeof acquireVsCodeApi === "function") {
    cachedApi = acquireVsCodeApi<WebviewState>();
    return cachedApi;
  }
  let fallbackState: WebviewState | undefined;
  cachedApi = {
    postMessage: () => {},
    getState: () => fallbackState,
    setState: (state) => {
      fallbackState = state;
      return state;
    }
  };
  return cachedApi;
}

interface PendingRequest {
  readonly resolve: (result: YamlParseResult) => void;
  readonly reject: (error: Error) => void;
}

class ParserWorkerClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private disposed = false;

  public constructor() {
    // Inline workers are required because Remote SSH webviews cannot load a
    // worker directly from a vscode-resource URL.
    this.worker = new ParserWorker({ name: "yaml-reader-parser" });
    this.worker.addEventListener("message", this.handleMessage);
    this.worker.addEventListener("error", this.handleWorkerError);
  }

  public parse(text: string): Promise<YamlParseResult> {
    if (this.disposed) return Promise.reject(new Error("Parser worker is already disposed"));
    const requestId = this.nextRequestId++;
    return new Promise<YamlParseResult>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.worker.postMessage({ type: "parse", requestId, text } satisfies ParserWorkerRequest);
    });
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.removeEventListener("message", this.handleMessage);
    this.worker.removeEventListener("error", this.handleWorkerError);
    this.worker.terminate();
    this.rejectAll(new Error("Parser worker was disposed"));
  }

  private readonly handleMessage = (event: MessageEvent<ParserWorkerResponse>): void => {
    const response = event.data;
    if (response === null || typeof response !== "object" || !Number.isInteger(response.requestId)) return;
    const pending = this.pending.get(response.requestId);
    if (pending === undefined) return;
    this.pending.delete(response.requestId);
    if (response.type === "parse/success") pending.resolve(response.result);
    else pending.reject(new Error(response.message));
  };

  private readonly handleWorkerError = (event: ErrorEvent): void => {
    this.rejectAll(new Error(event.message || "YAML parser worker stopped unexpectedly"));
  };

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

type ExpansionPreset = 1 | 2 | 3 | 4 | 5;
const EXPANSION_PRESETS: readonly ExpansionPreset[] = [1, 2, 3, 4, 5];

export function TreeSearch({ query, matchCount, activeMatchNumber, onQueryChange, onSetExpansion, onPreviousMatch, onNextMatch }: { readonly query: string; readonly matchCount: number; readonly activeMatchNumber: number; readonly onQueryChange: (value: string) => void; readonly onSetExpansion: (depth: ExpansionPreset) => void; readonly onPreviousMatch: () => void; readonly onNextMatch: () => void }): JSX.Element {
  return <div class="tree-search"><div class="tree-search__field"><span aria-hidden="true">⌕</span><input id="yaml-reader-search" type="search" value={query} onInput={(event) => onQueryChange(event.currentTarget.value)} placeholder="搜索树…" aria-label="搜索 YAML 节点" spellcheck={false} />{query.length > 0 ? <><span aria-label={`${matchCount} 个搜索结果`}>{matchCount === 0 ? "无" : `${activeMatchNumber}/${matchCount}`}</span><button type="button" aria-label="上一个搜索结果" disabled={matchCount === 0} onClick={onPreviousMatch}>↑</button><button type="button" aria-label="下一个搜索结果" disabled={matchCount === 0} onClick={onNextMatch}>↓</button><button type="button" aria-label="清空搜索" onClick={() => onQueryChange("")}>×</button></> : null}</div><div class="tree-search__depth" aria-label="展开层级">{EXPANSION_PRESETS.map((depth) => <button key={depth} type="button" title={`展开到第 ${depth} 层`} onClick={() => onSetExpansion(depth)}>{depth}</button>)}</div></div>;
}

export function SourceEditor({ editorRef = () => undefined, source, readOnly = false, allowSave = false, sourceDirty = false, onInput, onCursorChange, onSave, onFormat }: { readonly editorRef?: (editor: HTMLTextAreaElement | null) => void; readonly source: string; readonly readOnly?: boolean; readonly allowSave?: boolean; readonly sourceDirty?: boolean; readonly onInput: (value: string) => void; readonly onCursorChange: (offset: number) => void; readonly onSave: () => void; readonly onFormat: () => void }): JSX.Element {
  return <section class="source-pane" aria-label={readOnly ? "YAML 只读源码" : "YAML 源码编辑器"}><div class="source-pane__header"><span>YAML 源码</span>{readOnly ? <span><span>只读</span>{allowSave ? <button type="button" onClick={onSave}>{sourceDirty ? "保存*" : "保存"}</button> : null}</span> : <span><button type="button" onClick={onFormat}>格式化</button><button type="button" onClick={onSave}>{sourceDirty ? "保存*" : "保存"}</button></span>}</div><textarea ref={editorRef} class="source-pane__input" value={source} readOnly={readOnly} spellcheck={false} aria-label={readOnly ? "YAML 只读源码" : "YAML 源码"} onInput={(event) => onInput(event.currentTarget.value)} onSelect={(event) => onCursorChange(event.currentTarget.selectionStart)} onKeyUp={(event) => onCursorChange(event.currentTarget.selectionStart)} onKeyDown={(event) => { if (!readOnly && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") { event.preventDefault(); onSave(); } }} /></section>;
}

function clampSourceOffset(offset: number, sourceLength: number): number {
  return Math.min(Math.max(offset, 0), sourceLength);
}

/** Moves to a tree node without leaving a replaceable source selection behind. */
export function positionSourceCursor(
  editor: HTMLTextAreaElement,
  range: SourceRange,
  sourceText: string
): number {
  const start = clampSourceOffset(range.start.offset, sourceText.length);
  editor.setSelectionRange(start, start);
  return start;
}

interface BreadcrumbsProps { readonly items: readonly BreadcrumbItem[]; readonly onSelect: (id: string) => void; }
export function Breadcrumbs({ items, onSelect }: BreadcrumbsProps): JSX.Element {
  return <nav class="breadcrumbs" aria-label="YAML 节点路径">{items.length === 0 ? <span class="breadcrumbs__empty">选择节点后在这里显示层级路径</span> : items.map((item, index) => <span class="breadcrumbs__segment" key={item.id}>{index > 0 ? <span class="breadcrumbs__separator" aria-hidden="true">›</span> : null}<button type="button" title={item.label} onClick={() => onSelect(item.id)}>{item.label}</button></span>)}</nav>;
}

interface IssuePanelProps { readonly issues: readonly ParseIssue[]; readonly onReveal: (issue: ParseIssue) => void; }
export function IssuePanel({ issues, onReveal }: IssuePanelProps): JSX.Element | null {
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  if (errorCount === 0) return null;
  return <details class="issue-panel" open={errorCount > 0}><summary><span class="issue-panel__icon" aria-hidden="true">{errorCount > 0 ? "!" : "△"}</span>{errorCount > 0 ? `${errorCount} 个 YAML 错误` : `${issues.length} 个 YAML 警告`}</summary><ul>{issues.map((issue, index) => <li key={`${issue.code}-${issue.range.start.offset}-${index}`}><button type="button" onClick={() => onReveal(issue)}><span class={`issue-panel__severity issue-panel__severity--${issue.severity}`}>{issue.severity === "error" ? "错误" : "警告"}</span><span class="issue-panel__message">{issue.message}</span><span class="issue-panel__location">L{issue.range.start.line}:{issue.range.start.column}</span></button></li>)}</ul></details>;
}

interface VirtualTreeProps {
  readonly nodeIndex: NodeIndex;
  readonly visibleIds: readonly string[];
  readonly expandedIds: ReadonlySet<string>;
  readonly selectedId: string | null;
  readonly matchIds: ReadonlySet<string>;
  readonly rowHeight: number;
  readonly onToggle: (id: string) => void;
  readonly onSelect: (id: string) => void;
  readonly onReveal: (node: YamlReaderNode) => void;
  readonly onCopyValue: (node: YamlReaderNode) => void;
  readonly onCopyPath: (node: YamlReaderNode) => void;
  readonly onCopySource: (node: YamlReaderNode) => void;
  readonly onKeyDown: (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => void;
  readonly editable?: boolean;
  readonly onEdit?: (node: YamlReaderNode) => void;
}

const DEFAULT_VIEWPORT_HEIGHT = 600;
const OVERSCAN_ROWS = 10;

export function VirtualTree({ nodeIndex, visibleIds, expandedIds, selectedId, matchIds, rowHeight, onToggle, onSelect, onReveal, onCopyValue, onCopyPath, onCopySource, onKeyDown, editable = false, onEdit = () => undefined }: VirtualTreeProps): JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(DEFAULT_VIEWPORT_HEIGHT);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) return;
    const updateSize = (): void => { if (viewport.clientHeight > 0) setViewportHeight(viewport.clientHeight); };
    updateSize();
    if (typeof ResizeObserver !== "function") {
      window.addEventListener("resize", updateSize);
      return () => window.removeEventListener("resize", updateSize);
    }
    const observer = new ResizeObserver(updateSize);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (selectedId === null) return;
    const viewport = viewportRef.current;
    const selectedIndex = visibleIds.indexOf(selectedId);
    if (viewport === null || selectedIndex < 0) return;
    const rowTop = selectedIndex * rowHeight;
    const rowBottom = rowTop + rowHeight;
    if (rowTop < viewport.scrollTop) viewport.scrollTop = rowTop;
    else if (rowBottom > viewport.scrollTop + viewport.clientHeight) viewport.scrollTop = rowBottom - viewport.clientHeight;
  }, [rowHeight, selectedId, visibleIds]);
  const virtualWindow = useMemo(() => getVirtualWindow(visibleIds.length, scrollTop, viewportHeight, rowHeight, OVERSCAN_ROWS), [rowHeight, scrollTop, viewportHeight, visibleIds.length]);
  const renderedIds = visibleIds.slice(virtualWindow.startIndex, virtualWindow.endIndex);
  return <div ref={viewportRef} class="virtual-tree" role="tree" aria-label="YAML 层级阅读树" aria-activedescendant={selectedId === null ? undefined : `yaml-node-${selectedId}`} tabIndex={0} onKeyDown={onKeyDown} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}><div class="virtual-tree__canvas" style={{ height: `${virtualWindow.totalHeight}px` }}><div class="virtual-tree__window" style={{ transform: `translateY(${virtualWindow.offsetTop}px)` }}>{renderedIds.map((id) => {
    const node = nodeIndex.get(id);
    return node === undefined ? null : <TreeRow key={id} node={node} rowHeight={rowHeight} expanded={expandedIds.has(id)} selected={selectedId === id} matched={matchIds.has(id)} editable={editable} onEdit={onEdit} onToggle={onToggle} onSelect={onSelect} onReveal={onReveal} onCopyValue={onCopyValue} onCopyPath={onCopyPath} onCopySource={onCopySource} />;
  })}</div></div></div>;
}

interface TreeRowProps {
  readonly node: YamlReaderNode;
  readonly rowHeight: number;
  readonly expanded: boolean;
  readonly selected: boolean;
  readonly matched: boolean;
  readonly onToggle: (id: string) => void;
  readonly onSelect: (id: string) => void;
  readonly onReveal: (node: YamlReaderNode) => void;
  readonly onCopyValue: (node: YamlReaderNode) => void;
  readonly onCopyPath: (node: YamlReaderNode) => void;
  readonly onCopySource: (node: YamlReaderNode) => void;
  readonly editable?: boolean;
  readonly onEdit?: (node: YamlReaderNode) => void;
}

const TYPE_LABELS: Readonly<Record<YamlReaderNode["type"], string>> = {
  document: "DOC", map: "{}", list: "[]", string: "Aa", number: "#", boolean: "TF", null: "∅", alias: "&*", unknown: "?"
};

export function TreeRow({ node, rowHeight, expanded, selected, matched, onToggle, onSelect, onReveal, onCopyValue, onCopyPath, onCopySource, editable = false, onEdit = () => undefined }: TreeRowProps): JSX.Element {
  const expandable = node.childIds.length > 0;
  const rowClass = ["tree-row", `tree-row--depth-${node.depth % 6}`, `tree-row--type-${node.type}`, selected ? "is-selected" : "", matched ? "is-match" : ""].filter(Boolean).join(" ");
  const rowStyle = { "--node-indent": `${node.depth * 9}px`, "--connector-indent": `${Math.max(0, node.depth - 1) * 9}px`, "--row-height": `${rowHeight}px` } as JSX.CSSProperties;
  const selectOrToggle = (): void => {
    onSelect(node.id);
    if (expandable) onToggle(node.id);
  };
  return <div id={`yaml-node-${node.id}`} class={rowClass} style={rowStyle} role="treeitem" aria-level={node.depth + 1} aria-selected={selected} aria-expanded={expandable ? expanded : undefined} data-node-id={node.id} data-depth={node.depth} onClick={selectOrToggle} onDblClick={(event) => { if (!editable || node.treeEdit === undefined) return; event.stopPropagation(); onEdit(node); }}>
    <span class="tree-row__guides" aria-hidden="true">{Array.from({ length: node.depth }, (_, level) => <span key={level} class="tree-row__guide" style={{ left: `${level * 9}px` }} />)}</span><span class="tree-row__depth" title={`层级 ${node.depth}`}>L{node.depth}</span>
    {expandable ? <button class={`tree-row__toggle ${expanded ? "is-expanded" : ""}`} type="button" aria-label={expanded ? `收起 ${node.key}` : `展开 ${node.key}`} onClick={(event) => { event.stopPropagation(); onToggle(node.id); }} /> : <span class="tree-row__toggle-spacer" aria-hidden="true" />}
    <span class="tree-row__type" title={`类型：${node.type}`}>{TYPE_LABELS[node.type]}</span><span class="tree-row__key" title={node.key}>{node.key}</span>
    {node.valuePreview.length > 0 ? <span class={`tree-row__value tree-row__value--${node.type}`} title={node.valuePreview}>{node.valuePreview}</span> : null}
    {node.itemCount > 0 ? <span class="tree-row__count">{node.itemCount} 项</span> : null}{node.anchor.length > 0 ? <span class="tree-row__annotation" title={`锚点：${node.anchor}`}>&amp;{node.anchor}</span> : null}{node.tag.length > 0 ? <span class="tree-row__annotation" title={`标签：${node.tag}`}>{node.tag}</span> : null}{node.comment.length > 0 ? <span class="tree-row__comment" title={node.comment}>#</span> : null}
    <span class="tree-row__spacer" /><div class="tree-row__actions">{node.valuePreview.length > 0 ? <ActionButton label="复制显示值" text="值" onClick={() => onCopyValue(node)} /> : null}<ActionButton label="复制 YAML 路径" text="路径" onClick={() => onCopyPath(node)} /><ActionButton label="复制当前子树源码" text="子树" onClick={() => onCopySource(node)} /></div>
    <button class="tree-row__line" type="button" title={`在源码中打开第 ${node.range.start.line} 行`} onClick={(event) => { event.stopPropagation(); onReveal(node); }}>L{node.range.start.line}</button>
  </div>;
}

interface TreeEditFormProps {
  readonly node: YamlReaderNode;
  readonly keyValue: string;
  readonly value: string;
  readonly error: string;
  readonly busy?: boolean;
  readonly onKeyChange: (value: string) => void;
  readonly onValueChange: (value: string) => void;
  readonly onApply: () => void;
  readonly onCancel: () => void;
}

export function TreeEditForm({ node, keyValue, value, error, busy = false, onKeyChange, onValueChange, onApply, onCancel }: TreeEditFormProps): JSX.Element | null {
  const descriptor = node.treeEdit;
  const firstInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!busy) firstInputRef.current?.focus();
  }, [busy, node.id]);
  if (descriptor === undefined) return null;
  const isMapping = descriptor.kind === "mapping";
  return <form class="tree-edit-form" aria-label="左侧树编辑器" aria-busy={busy} onSubmit={(event) => { event.preventDefault(); if (!busy) onApply(); }} onKeyDown={(event) => { if (event.key === "Escape" && !busy) { event.preventDefault(); onCancel(); } }}>
    <div class="tree-edit-form__title">编辑 {node.path}</div>
    {isMapping ? <label class="tree-edit-form__field">键名<input ref={firstInputRef} aria-label="YAML 键名" value={keyValue} disabled={busy} onInput={(event) => onKeyChange(event.currentTarget.value)} /></label> : null}
    <label class="tree-edit-form__field">值<input ref={isMapping ? () => undefined : firstInputRef} aria-label="YAML 值" value={value} disabled={busy} onInput={(event) => onValueChange(event.currentTarget.value)} /></label>
    <div class="tree-edit-form__actions"><button type="submit" disabled={busy}>应用修改</button><button type="button" disabled={busy} onClick={onCancel}>取消</button></div>
    {error.length > 0 ? <div class="tree-edit-form__error" role="alert">{error}</div> : null}
  </form>;
}

function ActionButton({ label, text, onClick }: { readonly label: string; readonly text: string; readonly onClick: () => void }): JSX.Element {
  return <button class="tree-row__action" type="button" aria-label={label} title={label} onClick={(event) => { event.stopPropagation(); onClick(); }}>{text}</button>;
}

const root = document.getElementById("app");
if (root !== null) render(<App />, root);
