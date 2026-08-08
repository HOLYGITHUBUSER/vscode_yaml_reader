# YAML Reader

一个面向 VS Code / Cursor 的 YAML 阅读器与编辑工作台。它在编辑器主区域打开独立页面，不占用侧边栏。

## 当前状态

首个可安装版本为 `0.1.0`，已完成核心功能、自动化测试和大文件性能验证。

## 功能

- 在同一编辑器标签页左右分栏展示结构树与源码，不使用侧边栏。
- 默认展开一级，大型 YAML 首次打开只展示文档骨架。
- 通过缩进、连接线、图标和颜色共同表达层级与数据类型。
- 支持键、值、类型、路径搜索，以及 `key:`、`value:`、`type:`、`path:` 过滤。
- 支持面包屑、键盘导航、源码定位、路径复制和值/子树复制。
- 支持多文档、锚点、别名、标签、注释与错误定位。
- 使用虚拟滚动稳定阅读 5,000～20,000+ 节点的 YAML。
- `YAML Reader` 全程只读，不重排、不格式化、不自动保存源文件。
- `YAML Workbench` 由用户主动打开，提供左树右源码编辑、格式化和显式保存；保存前校验 YAML，遇到外部变更拒绝覆盖。
- 完全本地运行，不联网、不上传文件、不收集遥测。

## 使用

打开 `.yaml` 或 `.yml` 文件后，可通过以下任一方式进入：

- 编辑器标题栏的 `Open YAML Reader` 按钮；
- 文件或编辑器右键菜单中的 `Open YAML Reader`；
- 命令面板中的 `YAML Reader: Open Read-only View`；
- 命令面板中的 `YAML Reader: Open Editing Workbench`；
- `Reopen Editor With...` 中选择 `YAML Reader`。

默认不会替换普通 YAML 文本编辑器。

## 设置

- `yamlReader.defaultExpandDepth`：初始展开深度，默认 `1`。
- `yamlReader.rowHeight`：虚拟树行高，默认 `32`。
- `yamlReader.rememberExpansion`：标签页存活期间记住展开和选中状态。
- `yamlReader.searchDebounceMs`：搜索防抖时间。

## 本地开发

要求 Node.js 24 或更高版本。

```bash
npm install
npm run typecheck
npm run test:coverage
npm run test:integration
npm run package
```

设计说明位于 `06-docs-项目文档/01_design-设计.md`。

## 标识

- 产品名：`YAML Reader`
- 扩展 ID：`yaml-reader.yaml-reader`
- 许可证：MIT
