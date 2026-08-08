# YAML Reader

![YAML Reader 图标](00-config-工程配置/icon-扩展图标.png)

VS Code / Cursor 的 YAML 阅读器：**左结构树 + 右可编辑源码**（可拖分隔条）。

## 功能

- 默认**分栏**：左侧结构、右侧源码可编辑并写回
- 也可切「仅树形 / 仅源码」
- 点树节点定位源码；搜索 / 展开折叠 / 类型着色
- **复制路径 / 值 / JSON**（节点悬停）
- **格式化 YAML**、源码**换行**、记忆分栏宽度
- ⌘/Ctrl+F 聚焦搜索；Ctrl/⌘+Shift+L 格式化
- 解析：`eemeli/yaml`；自动关联 `*.yaml` / `*.yml`

## 快速开始

```bash
git clone https://github.com/HOLYGITHUBUSER/vscode_yaml_reader.git
cd vscode_yaml_reader
npm install
npm test
python3 03-script-构建脚本/build-编译打包.py
cursor --install-extension 07-artifacts-安装包/yaml-reader-*.vsix --force
```

## 试用样例

| 样例 | 用途 |
| --- | --- |
| [`04-samples-试用样例/demo-应用配置.yaml`](04-samples-试用样例/demo-应用配置.yaml) | 日常验收 |
| [`04-samples-试用样例/multi-多文档.yaml`](04-samples-试用样例/multi-多文档.yaml) | `---` 多文档 |

## 文档

| 文档 | 内容 |
| --- | --- |
| [`01-product-产品设计.md`](06-docs-项目文档/01-product-产品设计.md) | 定位与决策 |
| [`02-handbook-工程手册.md`](06-docs-项目文档/02-handbook-工程手册.md) | 目录、模块、测试、打包 |

## 目录结构（对齐 CSV Reader，根目录极简）

```text
vscode_yaml_reader/
├─ 00-config-工程配置/       图标 / tsconfig / 许可证
├─ 01-extension-扩展逻辑/    ★ 扩展宿主 + 单测
├─ 02-webview-阅读界面/      ★ 分栏 UI
├─ 03-script-构建脚本/       打包
├─ 04-samples-试用样例/      手测 YAML
├─ 05-e2e-浏览器测试/        Playwright
├─ 06-docs-项目文档/         文档
├─ 07-artifacts-安装包/      VSIX 产物
├─ package.json
└─ README.md
```

## 配置

| 设置 | 默认 | 说明 |
|------|------|------|
| `yaml-reader.defaultView` | `split` | split / tree / source |
| `yaml-reader.autoOpenReader` | `true` | 自动用阅读器打开 |
| `yaml-reader.maxNodes` | `5000` | 树节点上限 |
| `yaml-reader.defaultExpandDepth` | `2` | 默认展开深度 |

## 许可证

MIT（见 `00-config-工程配置/license-许可证.txt`）
