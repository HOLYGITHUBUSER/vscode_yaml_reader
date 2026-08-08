# 工程手册

对齐 `vscode_csv_reader` 的编号目录约定。

## 目录

| 目录 | 内容 |
|------|------|
| `00-config-工程配置/` | 图标、tsconfig、许可证 |
| `01-extension-扩展逻辑/` | 扩展宿主 TypeScript + 单测 |
| `02-webview-阅读界面/` | 分栏 Webview（main + styles） |
| `03-script-构建脚本/` | `build-编译打包.py` |
| `04-samples-试用样例/` | 手测 YAML |
| `05-e2e-浏览器测试/` | Playwright：`01-core` / `02-extras` + harness |
| `06-docs-项目文档/` | 产品 / 手册 |
| `07-artifacts-安装包/` | VSIX 产物（本地生成） |

根目录仅：`package.json`、`package-lock.json`、`README.md`、`.gitignore`、`.vscodeignore`。

## 模块（01-）

| 文件 | 职责 |
|------|------|
| `extension.ts` | 激活、自动关联、命令 |
| `previewProvider.ts` | Custom Editor + 消息 |
| `statusBarController.ts` | 布局模式 + 状态栏 |
| `yamlModel.ts` | 节点 / 解析结果类型 |
| `yamlParser.ts` | eemeli/yaml 解析、过滤、展示文案 |

## 命令

```bash
npm install
npm test                 # 编译 + 单测
npm run test:e2e         # Playwright
python3 03-script-构建脚本/build-编译打包.py
cursor --install-extension 07-artifacts-安装包/yaml-reader-*.vsix --force
```

## 打包注意

- VSIX 内必须包含 `out/*.js` 与 `02-webview-阅读界面/*`
- 勿把 `01-extension-扩展逻辑/**` 的 `.ts` 源打进包；由 `.vscodeignore` 排除
