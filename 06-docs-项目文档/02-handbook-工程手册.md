# 工程手册

## 模块

| 文件 | 职责 |
|------|------|
| `yamlParser.ts` | eemeli/yaml → YamlNode 树 |
| `yamlModel.ts` | 类型 |
| `YamlTreeProvider.ts` | TreeDataProvider + TreeItem |
| `decoration.ts` | 高亮 |
| `extension.ts` | 激活、命令、订阅 |

## 命令

- `yaml-reader.revealNode` / `copyPath` / `copyValue`
- `yaml-reader.refresh` / `search` / `clearSearch`
- `yaml-reader.focusStructure`

## 测试

```bash
npm test   # 解析、路径、TreeItem 展示
```

Webview e2e 已降级（主形态为 TreeView）。

## 打包

```bash
python3 03-script-构建脚本/build-编译打包.py
```
