# YAML Reader 项目规则

本目录是独立的 VS Code / Cursor 扩展项目，不复用其他 `standalone_agents_独立项目/*` 的业务规则。

## 不可违反

1. 阅读器只在编辑器主区域工作，不向 Activity Bar、Explorer 或其他侧边栏贡献视图。
2. `YAML Reader` 阅读模式只读；禁止调用 `WorkspaceEdit` 修改源文件，禁止自动保存或重新序列化 YAML。`YAML Workbench` 是用户显式打开的独立编辑模式，可通过受控的 `WorkspaceEdit` 写回；写回前必须验证来源、版本和 YAML 语法。
3. 文件内容只在本地或 Remote SSH 扩展主机与本地 Webview 之间传递；禁止网络请求、遥测和 CDN。
4. Webview 必须配置严格 CSP，脚本和样式全部随 VSIX 打包。
5. 大文件必须使用后台 Worker 解析和虚拟列表渲染，禁止为所有节点一次性创建 DOM。
6. 颜色不能是唯一的层级提示；必须同时保留缩进、连接线、图标和可访问文本。
7. 不提交 `node_modules/`、构建产物、VSIX、日志、测试临时文件或任何真实业务 YAML。
8. 修改后必须运行类型检查、单元测试、构建和 VSIX 安装验证。

## 技术约束

- TypeScript 严格模式。
- Extension Host 与 Webview 之间使用显式、可判别的消息类型。
- YAML 解析错误必须显示行列信息，禁止静默失败。
- 支持 `.yaml`、`.yml`、多文档、锚点、别名、标签和注释的安全读取。
- 默认展开深度为 1，可配置为 0～6；不得默认全量展开。

## 收尾标准

- 本机 Cursor 安装验证。
- Remote SSH Cursor Server 安装验证。
- 使用合成的 20,000 节点 YAML 完成性能验证。
- 使用畸形 YAML、深层嵌套、空映射、空数组、多文档和中文键名完成边界验证。
