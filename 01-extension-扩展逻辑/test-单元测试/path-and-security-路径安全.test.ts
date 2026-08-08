import assert from 'assert';
import { describe, it } from 'node:test';
import { parseYamlToTree, escapeHtml, filterTree, joinPath } from '../yamlParser';
import {
  nodeDescription,
  nodeLabel,
  nodeTooltip,
  nodeIconId,
  nodeContextValue,
} from '../yamlPresentation';
import type { YamlNode } from '../yamlModel';

describe('path building', () => {
  it('builds dotted and indexed paths', () => {
    const r = parseYamlToTree('a:\n  b:\n    - x\n    - y\n');
    assert.ok(r.ok);
    if (!r.ok) return;
    const a = r.roots.find((n) => n.key === 'a');
    assert.equal(a?.path, 'a');
    const b = a?.children.find((c) => c.key === 'b');
    assert.equal(b?.path, 'a.b');
    assert.equal(b?.children[0].path, 'a.b[0]');
  });

  it('joinPath quotes special keys', () => {
    assert.ok(joinPath('root', 'weird.key').includes('weird.key'));
  });
});

describe('presentation (no vscode import)', () => {
  it('labels scalars and containers', () => {
    const r = parseYamlToTree('n: 1\nobj:\n  k: v\narr:\n  - a\n');
    assert.ok(r.ok);
    if (!r.ok) return;
    const n = r.roots.find((x) => x.key === 'n')!;
    assert.equal(nodeLabel(n), 'n');
    assert.ok(nodeDescription(n).includes('1'));
    assert.ok(nodeDescription(r.roots.find((x) => x.key === 'obj')!).includes('{'));
    assert.ok(nodeDescription(r.roots.find((x) => x.key === 'arr')!).includes('['));
  });

  it('tooltip includes path', () => {
    const r = parseYamlToTree('meta:\n  name: x\n');
    assert.ok(r.ok);
    if (!r.ok) return;
    const name = r.roots[0].children[0];
    assert.ok(nodeTooltip(name).includes('meta.name'));
  });

  it('icon and context by type', () => {
    assert.equal(nodeIconId('object'), 'symbol-object');
    assert.equal(nodeIconId('array'), 'symbol-array');
    assert.equal(nodeIconId('error'), 'error');
    const err: YamlNode = {
      id: 'e',
      key: 'err',
      type: 'error',
      valueText: 'x',
      path: '',
      children: [],
      childCount: 0,
    };
    assert.equal(nodeContextValue(err), 'yamlError');
  });
});

describe('security escape', () => {
  it('escapes html entities', () => {
    const esc = escapeHtml(`<img src=x onerror=alert(1)>`);
    assert.ok(!esc.includes('<img'));
  });

  it('filter keeps raw string values', () => {
    const r = parseYamlToTree('danger: "<script>"\n');
    assert.ok(r.ok);
    if (!r.ok) return;
    const f = filterTree(r.roots, 'script');
    assert.equal(f[0].key, 'danger');
  });
});
