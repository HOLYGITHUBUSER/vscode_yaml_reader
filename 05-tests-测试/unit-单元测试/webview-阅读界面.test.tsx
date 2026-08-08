import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import {
  Breadcrumbs,
  IssuePanel,
  positionSourceCursor,
  SourceEditor,
  TreeEditForm,
  TreeSearch,
  TreeRow,
  VirtualTree
} from "../../03-webview-阅读界面/webview-main-主界面";
import {
  createNodeIndex,
  flattenAllNodeIds,
  type ParseIssue,
  type YamlReaderNode
} from "../../02-core-核心能力/reader-model-阅读模型";
import { parseYamlDocument } from "../../02-core-核心能力/yaml-parser-YAML解析器";

describe("TreeSearch", () => {
  it("emits search and navigation actions", () => {
    const onQueryChange = vi.fn();
    const onSetExpansion = vi.fn();
    const onPreviousMatch = vi.fn();
    const onNextMatch = vi.fn();

    render(
      <TreeSearch
        query="owner"
        matchCount={3}
        activeMatchNumber={2}
        onQueryChange={onQueryChange}
        onSetExpansion={onSetExpansion}
        onPreviousMatch={onPreviousMatch}
        onNextMatch={onNextMatch}
      />
    );

    expect(screen.getByText("2/3")).toBeInTheDocument();

    fireEvent.input(screen.getByRole("searchbox"), {
      target: { value: "key:name" }
    });
    fireEvent.click(screen.getByLabelText("上一个搜索结果"));
    fireEvent.click(screen.getByLabelText("下一个搜索结果"));
    fireEvent.click(screen.getByTitle("展开到第 3 层"));

    expect(onQueryChange).toHaveBeenCalledWith("key:name");
    expect(onPreviousMatch).toHaveBeenCalledOnce();
    expect(onNextMatch).toHaveBeenCalledOnce();
    expect(onSetExpansion).toHaveBeenCalledWith(3);
  });

  it("clears search and disables navigation when no results exist", () => {
    const onQueryChange = vi.fn();
    render(
      <TreeSearch
        query="missing"
        matchCount={0}
        activeMatchNumber={0}
        onQueryChange={onQueryChange}
        onSetExpansion={vi.fn()}
        onPreviousMatch={vi.fn()}
        onNextMatch={vi.fn()}
      />
    );

    expect(screen.getByText("无")).toBeInTheDocument();
    expect(screen.getByLabelText("上一个搜索结果")).toBeDisabled();
    fireEvent.click(screen.getByLabelText("清空搜索"));
    expect(onQueryChange).toHaveBeenCalledWith("");
  });
});

describe("Workbench source editor", () => {
  it("exposes format, save and keyboard save without affecting Reader mode", () => {
    const onSave = vi.fn();
    const onFormat = vi.fn();
    const onInput = vi.fn();
    const onCursorChange = vi.fn();
    render(
      <>
        <SourceEditor source="name: reader" sourceDirty onInput={onInput} onCursorChange={onCursorChange} onSave={onSave} onFormat={onFormat} />
      </>
    );
    fireEvent.click(screen.getByRole("button", { name: "格式化" }));
    fireEvent.click(screen.getByRole("button", { name: "保存*" }));
    const source = screen.getByRole("textbox", { name: "YAML 源码" });
    fireEvent.input(source, { target: { value: "name: workbench" } });
    fireEvent.select(source, { target: { selectionStart: 5 } });
    fireEvent.keyDown(source, { key: "s", ctrlKey: true });
    expect(onFormat).toHaveBeenCalledOnce();
    expect(onInput).toHaveBeenCalledWith("name: workbench");
    expect(onCursorChange).toHaveBeenCalledWith(5);
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it("moves from a tree node to a collapsed source cursor, never a replaceable range", () => {
    const editor = document.createElement("textarea");
    const source = "service:\n  name: reader\n  enabled: true\n";
    editor.value = source;
    editor.setSelectionRange(0, source.length);

    const start = positionSourceCursor(
      editor,
      {
        start: { offset: 11, line: 2, column: 3 },
        end: { offset: 23, line: 2, column: 15 }
      },
      source
    );

    expect(start).toBe(11);
    expect(editor.selectionStart).toBe(11);
    expect(editor.selectionEnd).toBe(11);
  });
});

describe("Reader source pane", () => {
  it("renders source in the same page without allowing edits", () => {
    render(<SourceEditor source="name: reader" readOnly onInput={vi.fn()} onCursorChange={vi.fn()} onSave={vi.fn()} onFormat={vi.fn()} />);
    const source = screen.getByRole("textbox", { name: "YAML 只读源码" });
    expect(source).toHaveAttribute("readonly");
    expect(screen.getByText("只读")).toBeInTheDocument();
  });

  it("keeps Workbench source read-only while allowing an explicit save after left-tree edits", () => {
    const onSave = vi.fn();
    render(<SourceEditor source="name: reader" readOnly allowSave sourceDirty onInput={vi.fn()} onCursorChange={vi.fn()} onSave={onSave} onFormat={vi.fn()} />);

    expect(screen.getByRole("textbox", { name: "YAML 只读源码" })).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: "格式化" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存*" }));
    expect(onSave).toHaveBeenCalledOnce();
  });
});


const node: YamlReaderNode = {
  id: "n3",
  parentId: "n2",
  childIds: ["n4"],
  key: "kits",
  path: "$.applications.Nomi.kits",
  type: "list",
  depth: 3,
  range: {
    start: { offset: 42, line: 8, column: 5 },
    end: { offset: 80, line: 10, column: 1 }
  },
  valuePreview: "",
  itemCount: 1,
  tag: "!list",
  anchor: "shared",
  comment: "Kit dependencies"
};

describe("tree components", () => {
  it("renders redundant hierarchy signals and row interactions", () => {
    const onToggle = vi.fn();
    const onSelect = vi.fn();
    const onReveal = vi.fn();
    const onCopyPath = vi.fn();
    const onCopySource = vi.fn();

    render(
      <TreeRow
        node={node}
        rowHeight={32}
        expanded={false}
        selected
        matched
        onToggle={onToggle}
        onSelect={onSelect}
        onReveal={onReveal}
        onCopyValue={vi.fn()}
        onCopyPath={onCopyPath}
        onCopySource={onCopySource}
      />
    );

    const row = screen.getByRole("treeitem");
    expect(row).toHaveAttribute("aria-level", "4");
    expect(row).toHaveAttribute("aria-expanded", "false");
    expect(row).toHaveAttribute("data-depth", "3");
    expect(screen.getByText("L3")).toBeInTheDocument();
    expect(screen.getByTitle("类型：list")).toHaveTextContent("[]");
    expect(screen.getByText("1 项")).toBeInTheDocument();
    expect(screen.getByText("&shared")).toBeInTheDocument();
    expect(screen.getByTitle("标签：!list")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("展开 kits"));
    fireEvent.click(row);
    fireEvent.dblClick(row);
    fireEvent.click(screen.getByLabelText("复制 YAML 路径"));
    fireEvent.click(screen.getByLabelText("复制当前子树源码"));
    fireEvent.click(screen.getByTitle("在源码中打开第 8 行"));

    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(onToggle).toHaveBeenLastCalledWith("n3");
    expect(onSelect).toHaveBeenCalled();
    expect(onReveal).toHaveBeenCalledOnce();
    expect(onCopyPath).toHaveBeenCalledWith(node);
    expect(onCopySource).toHaveBeenCalledWith(node);
  });

  it("navigates breadcrumbs", () => {
    const onSelect = vi.fn();
    render(
      <Breadcrumbs
        items={[
          { id: "n0", label: "Document 1" },
          { id: "n1", label: "applications" }
        ]}
        onSelect={onSelect}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "applications" }));
    expect(onSelect).toHaveBeenCalledWith("n1");
  });

  it("shows parser issues and reveals their source", () => {
    const onReveal = vi.fn();
    const issue: ParseIssue = {
      severity: "error",
      code: "BAD_INDENT",
      message: "Unexpected indentation",
      range: {
        start: { offset: 12, line: 3, column: 4 },
        end: { offset: 13, line: 3, column: 5 }
      }
    };
    const { rerender } = render(
      <IssuePanel issues={[issue]} onReveal={onReveal} />
    );

    expect(screen.getByText("1 个 YAML 错误")).toBeInTheDocument();
    expect(screen.getByText("L3:4")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Unexpected indentation"));
    expect(onReveal).toHaveBeenCalledWith(issue);

    rerender(<IssuePanel issues={[]} onReveal={onReveal} />);
    expect(screen.queryByText("1 个 YAML 错误")).not.toBeInTheDocument();
  });
});

describe("Workbench tree editor", () => {
  const editableNode = parseYamlDocument("service:\n  name: old\n").nodes.find(
    (candidate) => candidate.path === "$.service.name"
  );

  it("opens scalar editing by double-click only when Workbench enables the tree node", () => {
    expect(editableNode).toBeDefined();
    const onEdit = vi.fn();
    const { rerender } = render(
      <TreeRow
        node={editableNode as YamlReaderNode}
        rowHeight={32}
        expanded={false}
        selected={false}
        matched={false}
        editable
        onEdit={onEdit}
        onToggle={vi.fn()}
        onSelect={vi.fn()}
        onReveal={vi.fn()}
        onCopyValue={vi.fn()}
        onCopyPath={vi.fn()}
        onCopySource={vi.fn()}
      />
    );

    fireEvent.dblClick(screen.getByRole("treeitem"));
    expect(onEdit).toHaveBeenCalledWith(editableNode);

    rerender(
      <TreeRow
        node={editableNode as YamlReaderNode}
        rowHeight={32}
        expanded={false}
        selected={false}
        matched={false}
        onToggle={vi.fn()}
        onSelect={vi.fn()}
        onReveal={vi.fn()}
        onCopyValue={vi.fn()}
        onCopyPath={vi.fn()}
        onCopySource={vi.fn()}
      />
    );
    fireEvent.dblClick(screen.getByRole("treeitem"));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("edits mapping key and value with explicit apply and cancel actions", () => {
    const onKeyChange = vi.fn();
    const onValueChange = vi.fn();
    const onApply = vi.fn();
    const onCancel = vi.fn();
    render(
      <TreeEditForm
        node={editableNode as YamlReaderNode}
        keyValue="name"
        value="old"
        error="数字必须是有限的十进制值。"
        onKeyChange={onKeyChange}
        onValueChange={onValueChange}
        onApply={onApply}
        onCancel={onCancel}
      />
    );

    fireEvent.input(screen.getByLabelText("YAML 键名"), {
      target: { value: "title" }
    });
    fireEvent.input(screen.getByLabelText("YAML 值"), {
      target: { value: "new" }
    });
    fireEvent.click(screen.getByRole("button", { name: "应用修改" }));
    fireEvent.keyDown(screen.getByLabelText("YAML 键名"), { key: "Escape" });

    expect(onKeyChange).toHaveBeenCalledWith("title");
    expect(onValueChange).toHaveBeenCalledWith("new");
    expect(onApply).toHaveBeenCalledOnce();
    expect(onCancel).toHaveBeenCalledOnce();
    expect(screen.getByRole("alert")).toHaveTextContent("数字必须是有限的十进制值。");
  });

  it("locks the form while a tree edit is being parsed", () => {
    render(
      <TreeEditForm
        node={editableNode as YamlReaderNode}
        keyValue="name"
        value="old"
        error=""
        busy
        onKeyChange={vi.fn()}
        onValueChange={vi.fn()}
        onApply={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByLabelText("YAML 键名")).toBeDisabled();
    expect(screen.getByLabelText("YAML 值")).toBeDisabled();
    expect(screen.getByRole("button", { name: "应用修改" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
  });
});


const source = Array.from(
  { length: 20_000 },
  (_, index) => `key_${index}: value_${index}`
).join("\n");
const result = parseYamlDocument(source);
const index = createNodeIndex(result.nodes);
const visibleIds = flattenAllNodeIds(index, result.rootIds);

describe("VirtualTree", () => {
  it("renders fewer than 200 rows for a 20,000-node tree", () => {
    const onSelect = vi.fn();
    render(
      <VirtualTree
        nodeIndex={index}
        visibleIds={visibleIds}
        expandedIds={new Set(result.rootIds)}
        selectedId={null}
        matchIds={new Set()}
        rowHeight={32}
        onToggle={vi.fn()}
        onSelect={onSelect}
        onReveal={vi.fn()}
        onCopyValue={vi.fn()}
        onCopyPath={vi.fn()}
        onCopySource={vi.fn()}
        onKeyDown={vi.fn()}
      />
    );

    const rows = screen.getAllByRole("treeitem");
    expect(rows.length).toBeLessThan(200);
    expect(rows.length).toBeGreaterThan(10);
    fireEvent.click(screen.getByText("key_0"));
    expect(onSelect).toHaveBeenCalled();
  });

  it("passes keyboard events through the tree viewport", () => {
    const onKeyDown = vi.fn();
    render(
      <VirtualTree
        nodeIndex={index}
        visibleIds={visibleIds.slice(0, 10)}
        expandedIds={new Set()}
        selectedId={visibleIds[0] ?? null}
        matchIds={new Set()}
        rowHeight={32}
        onToggle={vi.fn()}
        onSelect={vi.fn()}
        onReveal={vi.fn()}
        onCopyValue={vi.fn()}
        onCopyPath={vi.fn()}
        onCopySource={vi.fn()}
        onKeyDown={onKeyDown}
      />
    );

    fireEvent.keyDown(screen.getByRole("tree"), { key: "ArrowDown" });
    expect(onKeyDown).toHaveBeenCalledOnce();
  });
});
