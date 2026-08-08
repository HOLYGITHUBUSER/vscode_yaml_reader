import type { YamlNode, YamlValueType } from './yamlModel';

export function nodeLabel(n: YamlNode): string {
  if (n.type === 'error') return n.key;
  return n.key || '(root)';
}

export function nodeDescription(n: YamlNode): string {
  if (n.type === 'error') {
    const v = n.valueText || '';
    return v.length > 60 ? v.slice(0, 57) + '…' : v;
  }
  if (n.type === 'object') {
    return `{${n.childCount}}${n.truncated ? '…' : ''}`;
  }
  if (n.type === 'array') {
    return `[${n.childCount}]${n.truncated ? '…' : ''}`;
  }
  if (n.type === 'document') {
    return 'document';
  }
  const v = n.valueText;
  if (n.type === 'string') {
    const shown = v.length > 48 ? v.slice(0, 45) + '…' : v;
    return `"${shown}"`;
  }
  return v;
}

export function nodeTooltip(n: YamlNode): string {
  const lines = [n.path ? `路径: ${n.path}` : '（根）', `类型: ${n.type}`];
  if (n.valueText && n.type !== 'object' && n.type !== 'array') {
    lines.push(`值: ${n.valueText}`);
  }
  if (n.truncated) lines.push('（子节点已截断）');
  lines.push('', '点击跳转 · 右键复制路径/值');
  return lines.join('\n');
}

/** ThemeIcon id，供 TreeItem 使用 */
export function nodeIconId(type: YamlValueType): string {
  switch (type) {
    case 'object':
      return 'symbol-object';
    case 'array':
      return 'symbol-array';
    case 'string':
      return 'symbol-string';
    case 'number':
      return 'symbol-number';
    case 'boolean':
      return 'symbol-boolean';
    case 'null':
      return 'symbol-null';
    case 'document':
      return 'file-code';
    case 'error':
      return 'error';
    default:
      return 'symbol-misc';
  }
}

export function nodeContextValue(n: YamlNode): string {
  return n.type === 'error' ? 'yamlError' : 'yamlNode';
}
