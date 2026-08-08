# YAML Reader

> **打开 YAML → 同一界面：左边结构树，右边可编辑原文**（可拖分隔条）

## 功能

- **默认分栏**：左「结构」+ 右「源码（可编辑）」
- 也可切：仅树形 / 仅源码
- 点树节点 → 右侧源码定位高亮
- 搜索、展开/折叠、类型色、复制路径
- 解析：`eemeli/yaml`；源码编辑写回文件
- 默认自动关联 `*.yaml` / `*.yml`

## 使用

1. 安装 VSIX 后打开任意 `.yaml`
2. 顶部点 **树形** / **源码**
3. 状态栏也可切换
4. 回系统文本编辑：标签右键 → Open With… → Text Editor

## 开发

```bash
npm install && npm test
python3 03-script-构建脚本/build-编译打包.py
cursor --install-extension 07-artifacts-安装包/yaml-reader-v….vsix --force
```

## 配置

| 设置 | 默认 | 说明 |
|------|------|------|
| `yaml-reader.defaultView` | `tree` | 默认标签 |
| `yaml-reader.autoOpenReader` | `true` | 自动用阅读器打开 |
| `yaml-reader.maxNodes` | `5000` | 节点上限 |
| `yaml-reader.defaultExpandDepth` | `2` | 默认展开深度 |

## 许可证

MIT
