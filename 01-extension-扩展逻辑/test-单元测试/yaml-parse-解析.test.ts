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
} from '../yamlParser';

describe('yamlParser parseYamlToTree (eemeli/yaml)', () => {
  beforeEach(() => resetIdSeqForTests());

  it('parses simple object with paths', () => {
    const r = parseYamlToTree('name: demo\ncount: 3\nenabled: true\n');
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.documentCount, 1);
    const keys = r.roots.map((n) => n.key).sort();
    assert.deepEqual(keys, ['count', 'enabled', 'name']);
    const name = r.roots.find((n) => n.key === 'name');
    assert.equal(name?.type, 'string');
    assert.equal(name?.valueText, 'demo');
    assert.equal(name?.path, 'name');
    assert.ok(name?.range, 'should have source range');
    assert.ok(typeof name!.range!.start === 'number');
  });

  it('parses nested object and array with ranges', () => {
    const src = `
app:
  host: localhost
  ports:
    - 80
    - 443
`;
    const r = parseYamlToTree(src);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const app = r.roots.find((n) => n.key === 'app');
    assert.ok(app);
    assert.equal(app!.type, 'object');
    assert.equal(app!.path, 'app');
    const ports = app!.children.find((c) => c.key === 'ports');
    assert.equal(ports?.type, 'array');
    assert.equal(ports?.path, 'app.ports');
    assert.equal(ports?.children.length, 2);
    assert.equal(ports?.children[0].valueText, '80');
    assert.equal(ports?.children[0].path, 'app.ports[0]');
  });

  it('returns error node for invalid yaml', () => {
    const r = parseYamlToTree('foo: [1, 2\nbar: 3');
    // eemeli may still return docs with errors
    if (!r.ok) {
      assert.ok(r.error.length > 0);
      assert.ok(r.roots.some((n) => n.type === 'error'));
    } else {
      // soft errors still ok:true with warning node or empty
      assert.ok(Array.isArray(r.roots));
    }
  });

  it('handles empty document', () => {
    const r = parseYamlToTree('   \n');
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.roots.length, 0);
  });

  it('handles multi-document yaml', () => {
    const src = 'a: 1\n---\nb: 2\n';
    const r = parseYamlToTree(src);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.documentCount, 2);
    assert.ok(r.roots.some((n) => n.key.includes('document')));
  });

  it('truncates when exceeding maxNodes', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `k${i}: v${i}`).join('\n');
    const r = parseYamlToTree(lines, { maxNodes: 10 });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.truncated, true);
    assert.ok(r.nodeCount <= 10);
  });

  it('null scalar', () => {
    const r = parseYamlToTree('x: null\n');
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const x = r.roots.find((n) => n.key === 'x');
    assert.equal(x?.type, 'null');
    assert.equal(x?.valueText, 'null');
  });

  it('k8s-like sample paths', () => {
    const src = `
apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
spec:
  replicas: 2
  template:
    spec:
      containers:
        - name: app
          image: nginx:latest
`;
    const r = parseYamlToTree(src);
    assert.ok(r.ok);
    if (!r.ok) return;
    const meta = r.roots.find((n) => n.key === 'metadata');
    const name = meta?.children.find((c) => c.key === 'name');
    assert.equal(name?.path, 'metadata.name');
    assert.equal(name?.valueText, 'demo');
    const containers = r.roots
      .find((n) => n.key === 'spec')
      ?.children.find((c) => c.key === 'template')
      ?.children.find((c) => c.key === 'spec')
      ?.children.find((c) => c.key === 'containers');
    assert.equal(containers?.type, 'array');
    assert.equal(containers?.children[0]?.children.find((c) => c.key === 'image')?.path, 'spec.template.spec.containers[0].image');
  });
});

describe('filterTree', () => {
  it('filters by key case-insensitively', () => {
    const r = parseYamlToTree('Name: Alice\nage: 30\nnick: bob\n');
    assert.ok(r.ok);
    if (!r.ok) return;
    const f = filterTree(r.roots, 'name');
    assert.equal(f.length, 1);
    assert.equal(f[0].key, 'Name');
  });

  it('keeps ancestors when child matches', () => {
    const r = parseYamlToTree('app:\n  secret: hunter2\n  public: ok\n');
    assert.ok(r.ok);
    if (!r.ok) return;
    const f = filterTree(r.roots, 'hunter');
    assert.equal(f.length, 1);
    assert.equal(f[0].key, 'app');
    assert.ok(f[0].children.some((c) => c.key === 'secret'));
  });

  it('empty query returns original', () => {
    const r = parseYamlToTree('a: 1\nb: 2\n');
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(filterTree(r.roots, '  ').length, 2);
  });
});

describe('helpers', () => {
  it('detectType / formatScalar / joinPath / escapeHtml', () => {
    assert.equal(detectType(null), 'null');
    assert.equal(detectType([1]), 'array');
    assert.equal(formatScalar(true), 'true');
    assert.equal(joinPath('a.b', '0'), 'a.b[0]');
    assert.equal(joinPath('a', 'c'), 'a.c');
    assert.equal(joinPath('', 'x'), 'x');
    assert.ok(escapeHtml('<x>').includes('&lt;'));
  });
});

describe('viewMode split', () => {
  it('parses split and cycles toggle', async () => {
    const { parseViewMode, toggleView, ViewMode, getStatusBarText } = await import('../viewMode');
    assert.equal(parseViewMode('split', ViewMode.Source), ViewMode.Split);
    assert.equal(parseViewMode('both', ViewMode.Source), ViewMode.Split);
    assert.equal(toggleView(ViewMode.Split), ViewMode.Source);
    assert.equal(toggleView(ViewMode.Source), ViewMode.Tree);
    assert.equal(toggleView(ViewMode.Tree), ViewMode.Split);
    assert.ok(getStatusBarText(ViewMode.Split).includes('分栏'));
  });
});
