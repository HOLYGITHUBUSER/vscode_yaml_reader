import assert from 'assert';
import { describe, it, beforeEach } from 'node:test';
import {
  parseYamlToTree,
  filterTree,
  detectType,
  formatScalar,
  escapeHtml,
  joinPath,
  resetIdSeqForTests,
  nodeLabel,
  nodeDescription,
  nodeToJs,
  nodeToJson,
  formatYaml,
} from '../yamlParser';
import {
  parseViewMode,
  toggleView,
  ViewMode,
  getStatusBarText,
} from '../viewMode';

describe('parseYamlToTree', () => {
  beforeEach(() => resetIdSeqForTests());

  it('parses object with paths and ranges', () => {
    const r = parseYamlToTree('name: demo\ncount: 3\n');
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const name = r.roots.find((n) => n.key === 'name');
    assert.equal(name?.valueText, 'demo');
    assert.equal(name?.path, 'name');
    assert.ok(name?.range);
  });

  it('nested array path', () => {
    const r = parseYamlToTree('app:\n  ports:\n    - 80\n');
    assert.ok(r.ok);
    if (!r.ok) return;
    const ports = r.roots[0].children.find((c) => c.key === 'ports');
    assert.equal(ports?.children[0].path, 'app.ports[0]');
  });

  it('multi-document', () => {
    const r = parseYamlToTree('a: 1\n---\nb: 2\n');
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.documentCount, 2);
  });

  it('maxNodes truncate', () => {
    const lines = Array.from({ length: 40 }, (_, i) => `k${i}: v`).join('\n');
    const r = parseYamlToTree(lines, { maxNodes: 8 });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.truncated, true);
  });

  it('empty', () => {
    const r = parseYamlToTree('  \n');
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.roots.length, 0);
  });
});

describe('filterTree', () => {
  it('case-insensitive key filter keeps ancestors', () => {
    const r = parseYamlToTree('app:\n  secret: x\n');
    assert.ok(r.ok);
    if (!r.ok) return;
    const f = filterTree(r.roots, 'SECRET');
    assert.equal(f[0].key, 'app');
  });
});

describe('helpers', () => {
  it('detect / format / path / escape / label', () => {
    assert.equal(detectType([1]), 'array');
    assert.equal(formatScalar(false), 'false');
    assert.equal(joinPath('a', '0'), 'a[0]');
    assert.ok(escapeHtml('<a>').includes('&lt;'));
    const r = parseYamlToTree('s: hi\n');
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(nodeLabel(r.roots[0]), 's');
    assert.equal(nodeDescription(r.roots[0]), '"hi"');
  });
});

describe('viewMode', () => {
  it('split cycle', () => {
    assert.equal(parseViewMode('split', ViewMode.Source), ViewMode.Split);
    assert.equal(toggleView(ViewMode.Split), ViewMode.Source);
    assert.equal(toggleView(ViewMode.Source), ViewMode.Tree);
    assert.equal(toggleView(ViewMode.Tree), ViewMode.Split);
    assert.ok(getStatusBarText(ViewMode.Split).includes('分栏'));
  });
});

describe('copy helpers', () => {
  it('nodeToJs / nodeToJson', () => {
    const r = parseYamlToTree('a:\n  b: 1\n  c: true\n');
    assert.ok(r.ok);
    if (!r.ok) return;
    const a = r.roots.find((n) => n.key === 'a')!;
    const js = nodeToJs(a) as Record<string, unknown>;
    assert.equal(js.b, 1);
    assert.equal(js.c, true);
    assert.ok(nodeToJson(a).includes('"b"'));
  });

  it('formatYaml pretty multi-doc', () => {
    const raw = 'a:  1\n---\nb:   2';
    const f = formatYaml(raw);
    assert.equal(f.ok, true);
    if (!f.ok) return;
    assert.ok(f.text.includes('a: 1'));
    assert.ok(f.text.includes('---'));
    assert.ok(f.text.includes('b: 2'));
  });
});
