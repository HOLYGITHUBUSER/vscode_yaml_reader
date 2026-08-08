# 产品设计 — YAML Reader

## 定位

**结构阅读器**：Explorer 侧栏树 + 路径导航。  
不替代 Red Hat YAML（校验/补全），专做「看懂结构」。

## 为何原生 TreeView

开源对照后：

1. 原生主题、快捷键、右键菜单一致  
2. 点击跳转编辑器是 VS Code 惯用模式  
3. 大文件比 Webview 更稳  
4. YAML Structure Editor / 各类 JSON Tree 验证此路  

## 核心能力（v0.2）

| 能力 | 说明 |
|------|------|
| YAML Structure 视图 | Explorer 内 |
| 跳转 + 高亮 | range → revealRange |
| 复制路径/值 | 右键 / 命令 |
| 搜索 | 标题栏命令 |
| eemeli/yaml | range + 多文档 |
| maxNodes | 性能闸门 |

## 决策记录

| 日期 | 改动 | 原因 |
|------|------|------|
| 2026-08-08 | v0.1 Custom Editor Webview | 对齐 MD Reader |
| 2026-08-08 | **v0.2 改原生 TreeView** | 开源形态 + 阅读场景更优；默认不劫持打开 |
