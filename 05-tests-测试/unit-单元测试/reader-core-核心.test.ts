import { describe, expect, it } from "vitest";
import {
  applyTreeScalarEdit,
  allExpandableIds,
  createNodeIndex,
  expandedIdsForDepth,
  findAdjacentSelection,
  flattenAllNodeIds,
  flattenVisibleNodeIds,
  getBreadcrumbs,
  getVirtualWindow,
  isExtensionToWebviewMessage,
  isReaderSettings,
  isWebviewToExtensionMessage,
  retainExistingIds,
  searchNodeProjection
} from "../../02-core-核心能力/reader-model-阅读模型";
import { parseYamlDocument } from "../../02-core-核心能力/yaml-parser-YAML解析器";

const settings = {
  defaultExpandDepth: 1,
  rowHeight: 32,
  rememberExpansion: true,
  searchDebounceMs: 120
};
const range = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 5, line: 1, column: 6 }
};

describe("message guards", () => {
  it("accepts every supported webview message variant", () => {
    expect(isWebviewToExtensionMessage({ type: "webview/ready" })).toBe(true);
    expect(
      isWebviewToExtensionMessage({ type: "source/reveal", range })
    ).toBe(true);
    expect(
      isWebviewToExtensionMessage({
        type: "clipboard/write",
        value: { kind: "text", text: "$.path" }
      })
    ).toBe(true);
    expect(
      isWebviewToExtensionMessage({
        type: "clipboard/write",
        value: { kind: "source", range }
      })
    ).toBe(true);
    expect(
      isWebviewToExtensionMessage({
        type: "document/save",
        text: "name: reader\n",
        version: 1
      })
    ).toBe(true);
    expect(
      isWebviewToExtensionMessage({
        type: "document/format",
        text: "name: reader",
        version: 2
      })
    ).toBe(true);
    expect(
      isWebviewToExtensionMessage({
        type: "error/report",
        message: "safe diagnostic"
      })
    ).toBe(true);
  });

  it("rejects unknown commands, malformed ranges and prototype tricks", () => {
    expect(isWebviewToExtensionMessage(null)).toBe(false);
    expect(isWebviewToExtensionMessage({ type: "command/run", command: "x" }))
      .toBe(false);
    expect(
      isWebviewToExtensionMessage({
        type: "source/reveal",
        range: {
          start: { offset: Number.NaN, line: 1, column: 1 },
          end: range.end
        }
      })
    ).toBe(false);
    expect(
      isWebviewToExtensionMessage({
        type: "clipboard/write",
        value: { kind: "text", text: 1 }
      })
    ).toBe(false);
    expect(
      isWebviewToExtensionMessage({
        type: "document/save",
        text: "name: reader",
        version: 0
      })
    ).toBe(false);
  });

  it("validates extension payloads and settings bounds", () => {
    const payload = {
      uri: "file:///sample.yaml",
      fileName: "sample.yaml",
      version: 1,
      text: "key: value",
      mode: "reader",
      settings
    };

    expect(
      isExtensionToWebviewMessage({ type: "document/open", payload })
    ).toBe(true);
    expect(
      isExtensionToWebviewMessage({ type: "document/changed", payload })
    ).toBe(true);
    expect(
      isExtensionToWebviewMessage({
        type: "settings/changed",
        settings
      })
    ).toBe(true);
    expect(isReaderSettings(settings)).toBe(true);
    expect(isReaderSettings({ ...settings, rowHeight: 100 })).toBe(false);
    expect(
      isReaderSettings({ ...settings, defaultExpandDepth: -1 })
    ).toBe(false);
    expect(
      isExtensionToWebviewMessage({
        type: "document/open",
        payload: { ...payload, text: 42 }
      })
    ).toBe(false);
    expect(isExtensionToWebviewMessage({ type: "unknown" })).toBe(false);
  });
});


const result = parseYamlDocument(
  [
    "applications:",
    "  Launcher:",
    "    owner: UI Team",
    "    migrated: true",
    "  Settings:",
    "    owner: Platform",
    "numbers:",
    "  - 10",
    "  - 20"
  ].join("\n")
);
const index = createNodeIndex(result.nodes);

describe("tree state", () => {
  it("expands the requested depth and preserves source order", () => {
    const depthOne = expandedIdsForDepth(result.nodes, 1);
    const depthTwo = expandedIdsForDepth(result.nodes, 2);
    const depthOneVisible = flattenVisibleNodeIds(
      index,
      result.rootIds,
      depthOne
    );
    const depthTwoVisible = flattenVisibleNodeIds(
      index,
      result.rootIds,
      depthTwo
    );

    expect(depthOne).toHaveLength(1);
    expect(depthOneVisible.map((id) => index.get(id)?.key)).toEqual([
      "Document 1",
      "applications",
      "numbers"
    ]);
    expect(depthTwoVisible.map((id) => index.get(id)?.key)).toEqual([
      "Document 1",
      "applications",
      "Launcher",
      "Settings",
      "numbers",
      "[0]",
      "[1]"
    ]);
    expect(flattenAllNodeIds(index, result.rootIds)).toHaveLength(
      result.nodes.length
    );
    expect(allExpandableIds(result.nodes).size).toBe(5);
  });

  it("searches all fields and returns matches with ancestor context", () => {
    const ownerSearch = searchNodeProjection(
      index,
      result.rootIds,
      "key:owner value:platform"
    );
    const typeSearch = searchNodeProjection(
      index,
      result.rootIds,
      "type:boolean"
    );
    const quotedSearch = searchNodeProjection(
      index,
      result.rootIds,
      '"UI Team"'
    );
    const pathSearch = searchNodeProjection(
      index,
      result.rootIds,
      "path:applications.Launcher"
    );

    expect(ownerSearch.orderedMatchIds).toHaveLength(1);
    expect(index.get(ownerSearch.orderedMatchIds[0] ?? "")?.path).toBe(
      "$.applications.Settings.owner"
    );
    expect(ownerSearch.visibleIds.map((id) => index.get(id)?.key)).toEqual([
      "Document 1",
      "applications",
      "Settings",
      "owner"
    ]);
    expect(index.get(typeSearch.orderedMatchIds[0] ?? "")?.key).toBe(
      "migrated"
    );
    expect(quotedSearch.orderedMatchIds).toHaveLength(1);
    expect(pathSearch.orderedMatchIds.length).toBeGreaterThanOrEqual(3);
  });

  it("returns an empty projection for blank queries", () => {
    expect(searchNodeProjection(index, result.rootIds, "   ")).toEqual({
      orderedMatchIds: [],
      matchIds: new Set(),
      visibleIds: []
    });
  });

  it("creates breadcrumbs and prevents loops in corrupted parent links", () => {
    const owner = result.nodes.find(
      (node) => node.path === "$.applications.Launcher.owner"
    );

    expect(getBreadcrumbs(index, owner?.id ?? null).map((item) => item.label))
      .toEqual(["Document 1", "applications", "Launcher", "owner"]);
    expect(getBreadcrumbs(index, "missing")).toEqual([]);
  });

  it("calculates fixed-row virtual windows defensively", () => {
    expect(getVirtualWindow(20_000, 3200, 640, 32, 10)).toEqual({
      startIndex: 90,
      endIndex: 130,
      offsetTop: 2880,
      totalHeight: 640_000
    });
    expect(getVirtualWindow(-4, -10, -20, 0, -1)).toEqual({
      startIndex: 0,
      endIndex: 0,
      offsetTop: 0,
      totalHeight: 0
    });
  });

  it("moves selection at boundaries and retains only valid node IDs", () => {
    const ids = result.nodes.slice(0, 3).map((node) => node.id);

    expect(findAdjacentSelection(ids, null, 1)).toBe(ids[0]);
    expect(findAdjacentSelection(ids, null, -1)).toBe(ids[2]);
    expect(findAdjacentSelection(ids, ids[0] ?? null, -1)).toBe(ids[0]);
    expect(findAdjacentSelection(ids, ids[2] ?? null, 1)).toBe(ids[2]);
    expect(findAdjacentSelection([], null, 1)).toBeNull();
    expect(retainExistingIds(new Set([ids[0] ?? "", "missing"]), index))
      .toEqual(new Set([ids[0]]));
  });
});


describe("large document performance", () => {
  it("parses and searches a synthetic 20,000-node YAML within the target", () => {
    const source = Array.from(
      { length: 20_000 },
      (_, index) => `application_${index}: value_${index}`
    ).join("\n");

    const startedAt = performance.now();
    const result = parseYamlDocument(source);
    const parseElapsedMs = performance.now() - startedAt;
    const nodeIndex = createNodeIndex(result.nodes);
    const searchStartedAt = performance.now();
    const projection = searchNodeProjection(
      nodeIndex,
      result.rootIds,
      "key:application_19999"
    );
    const searchElapsedMs = performance.now() - searchStartedAt;
    const virtualWindow = getVirtualWindow(
      result.nodes.length,
      100_000,
      768,
      32,
      10
    );

    expect(result.issues).toEqual([]);
    expect(result.stats.dataNodeCount).toBe(20_000);
    expect(parseElapsedMs).toBeLessThan(2_000);
    expect(searchElapsedMs).toBeLessThan(250);
    expect(projection.orderedMatchIds).toHaveLength(1);
    expect(
      virtualWindow.endIndex - virtualWindow.startIndex
    ).toBeLessThan(200);
  }, 10_000);
});


describe("parseYamlDocument", () => {
  it("builds a flat, typed tree with paths and source locations", () => {
    const source = [
      "应用:",
      "  名称: Nomi",
      "  启用: true",
      "  重试: 3",
      "  说明: null",
      "  kits:",
      "    - name: rtckit",
      "      version: 1.2.0"
    ].join("\n");

    const result = parseYamlDocument(source);
    const byPath = new Map(result.nodes.map((node) => [node.path, node]));

    expect(result.issues).toEqual([]);
    expect(result.rootIds).toHaveLength(1);
    expect(result.stats.documentCount).toBe(1);
    expect(result.stats.sourceBytes).toBe(
      new TextEncoder().encode(source).byteLength
    );
    expect(byPath.get("$.应用")).toMatchObject({
      key: "应用",
      type: "map",
      depth: 1,
      itemCount: 5
    });
    expect(byPath.get("$.应用.名称")).toMatchObject({
      type: "string",
      valuePreview: '"Nomi"',
      depth: 2
    });
    expect(byPath.get("$.应用.启用")).toMatchObject({
      type: "boolean",
      valuePreview: "true"
    });
    expect(byPath.get("$.应用.重试")).toMatchObject({
      type: "number",
      valuePreview: "3"
    });
    expect(byPath.get("$.应用.说明")?.type).toBe("null");
    expect(byPath.get("$.应用.kits")).toMatchObject({
      type: "list",
      itemCount: 1
    });
    expect(byPath.get("$.应用.kits[0].version")).toMatchObject({
      valuePreview: '"1.2.0"',
      range: {
        start: { line: 8, column: 7 }
      }
    });
    expect(result.stats.typeCounts.map).toBe(2);
    expect(result.stats.typeCounts.list).toBe(1);
    expect(result.stats.maxDepth).toBe(4);
  });

  it("supports multiple documents, anchors, aliases, tags and comments", () => {
    const source = [
      "# 第一份文档",
      "defaults: &base",
      "  owner: platform",
      "service:",
      "  <<: *base",
      "  value: !custom safe-data # 行尾注释",
      "---",
      "items:",
      "  - one",
      "  - two"
    ].join("\n");

    const result = parseYamlDocument(source);
    const byPath = new Map(result.nodes.map((node) => [node.path, node]));

    expect(result.stats.documentCount).toBe(2);
    expect(result.rootIds).toHaveLength(2);
    expect(byPath.get("$doc[0].defaults")?.anchor).toBe("base");
    expect(byPath.get('$doc[0].service["<<"]')).toMatchObject({
      type: "alias",
      valuePreview: "*base"
    });
    expect(byPath.get("$doc[0].service.value")).toMatchObject({
      tag: "!custom",
      comment: "行尾注释"
    });
    expect(byPath.get("$doc[1].items[1]")?.valuePreview).toBe('"two"');
    expect(result.nodes.some((node) => node.comment.includes("第一份文档")))
      .toBe(true);
  });

  it("reports malformed YAML without throwing or fabricating executable data", () => {
    const result = parseYamlDocument("root:\n  child: [one, two\nnext: value");

    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0]).toMatchObject({
      severity: "error"
    });
    expect(result.issues[0]?.range.start.line).toBeGreaterThanOrEqual(2);
    expect(result.stats.documentCount).toBeGreaterThanOrEqual(1);
  });

  it("reports duplicate mapping keys with the linear-time validator", () => {
    const result = parseYamlDocument(
      ["application:", "  owner: platform", "  owner: cockpit"].join("\n")
    );

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "DUPLICATE_KEY",
        severity: "error",
        message: expect.stringContaining("owner")
      })
    );
  });

  it("keeps YAML scalar key types distinct when detecting duplicate keys", () => {
    const distinct = parseYamlDocument('1: numeric\n"1": text\n');
    const duplicate = parseYamlDocument("1: numeric\n1.0: decimal\n");

    expect(distinct.issues.some((issue) => issue.code === "DUPLICATE_KEY")).toBe(false);
    expect(duplicate.issues).toContainEqual(
      expect.objectContaining({ code: "DUPLICATE_KEY" })
    );
  });

  it("handles empty documents and explicit null sequence entries", () => {
    const empty = parseYamlDocument("");
    const values = parseYamlDocument("items:\n  -\n  - null\n");

    expect(empty.stats.documentCount).toBe(1);
    expect(empty.stats.dataNodeCount).toBe(0);
    expect(values.nodes.filter((node) => node.type === "null")).toHaveLength(2);
  });

  it("uses bracket notation for non-identifier keys and truncates previews", () => {
    const longValue = "x".repeat(260);
    const result = parseYamlDocument(
      `"key with spaces": ${longValue}\n"quote\\"key": value\n`
    );
    const scalarNodes = result.nodes.filter(
      (node) => node.type === "string"
    );

    expect(scalarNodes[0]?.path).toBe('$["key with spaces"]');
    expect(scalarNodes[0]?.valuePreview.length).toBeLessThanOrEqual(180);
    expect(scalarNodes[0]?.valuePreview.endsWith('…"')).toBe(true);
    expect(scalarNodes[1]?.path).toBe('$["quote\\"key"]');
  });

  it("parses a depth-200 document without overflowing the stack", () => {
    const lines: string[] = [];
    for (let depth = 0; depth < 200; depth += 1) {
      lines.push(`${"  ".repeat(depth)}level_${depth}:`);
    }
    lines.push(`${"  ".repeat(200)}value: done`);

    const result = parseYamlDocument(lines.join("\n"));

    expect(result.issues).toEqual([]);
    expect(result.stats.maxDepth).toBe(201);
    expect(result.stats.dataNodeCount).toBe(201);
    expect(result.nodes.at(-1)?.valuePreview).toBe('"done"');
  });
});

describe("Workbench tree scalar editing", () => {
  it("keeps untruncated edit metadata and replaces a mapping scalar without touching indentation or comments", () => {
    const longValue = "x".repeat(220);
    const source = `service:\n  \"display name\": \"${longValue}\" # keep this comment\n`;
    const result = parseYamlDocument(source);
    const node = result.nodes.find(
      (candidate) => candidate.path === '$.service["display name"]'
    );

    expect(node?.valuePreview.length).toBeLessThan(220);
    expect(node?.treeEdit).toMatchObject({
      kind: "mapping",
      key: "display name",
      value: longValue
    });
    expect(
      node === undefined
        ? undefined
        : applyTreeScalarEdit(source, node, {
            key: "label",
            value: "新版名称"
          })
    ).toEqual({
      ok: true,
      text: 'service:\n  label: "新版名称" # keep this comment\n'
    });
  });

  it("edits sequence scalar values but rejects invalid numeric input and empty mapping keys", () => {
    const source = "retries: 3 # keep\nitems:\n  - old\n";
    const result = parseYamlDocument(source);
    const retries = result.nodes.find(
      (candidate) => candidate.path === "$.retries"
    );
    const item = result.nodes.find(
      (candidate) => candidate.path === "$.items[0]"
    );

    expect(
      retries === undefined
        ? undefined
        : applyTreeScalarEdit(source, retries, { key: "", value: "4" })
    ).toEqual({ ok: false, error: "键名不能为空。" });
    expect(
      retries === undefined
        ? undefined
        : applyTreeScalarEdit(source, retries, {
            key: "retries",
            value: "not-a-number"
          })
    ).toEqual({ ok: false, error: "数字必须是有限的十进制值。" });
    expect(
      item === undefined
        ? undefined
        : applyTreeScalarEdit(source, item, { value: "new value" })
    ).toEqual({
      ok: true,
      text: 'retries: 3 # keep\nitems:\n  - "new value"\n'
    });
  });

  it("does not expose tree editing for aliases, tagged values, anchors or null", () => {
    const result = parseYamlDocument(
      [
        "defaults: &base value",
        "alias: *base",
        "tagged: !custom value",
        "missing: null"
      ].join("\n")
    );

    expect(result.nodes.find((node) => node.path === "$.defaults")?.treeEdit).toBeUndefined();
    expect(result.nodes.find((node) => node.path === "$.alias")?.treeEdit).toBeUndefined();
    expect(result.nodes.find((node) => node.path === "$.tagged")?.treeEdit).toBeUndefined();
    expect(result.nodes.find((node) => node.path === "$.missing")?.treeEdit).toBeUndefined();
  });

  it("does not expose tree editing for non-string mapping keys", () => {
    const result = parseYamlDocument("true: text\n42: text\nnull: text\n");

    expect(result.nodes.find((node) => node.key === "true")?.treeEdit).toBeUndefined();
    expect(result.nodes.find((node) => node.key === "42")?.treeEdit).toBeUndefined();
    expect(result.nodes.find((node) => node.key === "null")?.treeEdit).toBeUndefined();
  });

  it("preserves comment-only mapping layout and explicit-key syntax while editing tokens", () => {
    const source = [
      "name: # document this value",
      "  old",
      "? complex",
      ": value",
      ""
    ].join("\n");
    const result = parseYamlDocument(source);
    const name = result.nodes.find((node) => node.key === "name");
    const complex = result.nodes.find((node) => node.key === "complex");

    expect(
      name === undefined
        ? undefined
        : applyTreeScalarEdit(source, name, { key: "name", value: "new" })
    ).toEqual({
      ok: true,
      text: 'name: # document this value\n  "new"\n? complex\n: value\n'
    });
    expect(
      complex === undefined
        ? undefined
        : applyTreeScalarEdit(source, complex, {
            key: "renamed",
            value: "next"
          })
    ).toEqual({
      ok: true,
      text: 'name: # document this value\n  old\n? renamed\n: "next"\n'
    });
  });

  it("preserves the original numeric token for large integers on a no-op apply", () => {
    const source = "total: 9007199254740993\n";
    const node = parseYamlDocument(source).nodes.find(
      (candidate) => candidate.path === "$.total"
    );

    expect(node?.treeEdit).toMatchObject({ value: "9007199254740993" });
    expect(
      node === undefined || node.treeEdit === undefined
        ? undefined
        : applyTreeScalarEdit(source, node, {
            ...(node.treeEdit.kind === "mapping" ? { key: node.treeEdit.key } : {}),
            value: node.treeEdit.value
          })
    ).toEqual({ ok: true, text: source });
  });

  it("preserves significant whitespace in a mapping key while editing its value", () => {
    const source = '" foo ": old\n';
    const node = parseYamlDocument(source).nodes.find(
      (candidate) => candidate.path === '$[" foo "]'
    );

    expect(
      node === undefined
        ? undefined
        : applyTreeScalarEdit(source, node, {
            key: " foo ",
            value: "new"
          })
    ).toEqual({ ok: true, text: '" foo ": "new"\n' });
  });
});
