import assert from 'assert';
import { describe, it } from 'node:test';
import { parseYamlToTree } from '../yamlParser';
import {
  nodeContextValue,
  nodeDescription,
  nodeIconId,
  nodeLabel,
} from '../yamlPresentation';
import type { YamlNode } from '../yamlModel';

describe('presentation matrix', () => {
  it('string description is quoted', () => {
    const r = parseYamlToTree('s: hello\n');
    assert.ok(r.ok);
    if (!r.ok) return;
    const s = r.roots[0];
    assert.equal(nodeLabel(s), 's');
    assert.equal(nodeDescription(s), '"hello"');
    assert.equal(nodeIconId(s.type), 'symbol-string');
  });

  it('error nodes use error context', () => {
    const node: YamlNode = {
      id: 'e1',
      key: '⚠ 解析错误',
      type: 'error',
      valueText: 'bad',
      path: '',
      children: [],
      childCount: 0,
    };
    assert.equal(nodeContextValue(node), 'yamlError');
    assert.equal(nodeIconId('error'), 'error');
  });
});
