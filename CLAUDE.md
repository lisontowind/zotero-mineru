# Zotero MinerU Plugin

Zotero 8 插件，调用 MinerU 官方 API 解析 PDF 为 Markdown 笔记，并支持 LLM AI 中文总结。

## 项目结构

```
manifest.json          # 插件元数据 (Zotero 8.0+, ID: zotero-mineru@example.com)
bootstrap.js           # 插件生命周期入口 (install/startup/shutdown/uninstall)
mineru.js              # 核心业务逻辑 (菜单注册、PDF 解析、AI 总结、Markdown→HTML)
preferences.js         # 设置面板控制 (加载/保存/连接测试)
preferences.xhtml      # 设置面板布局 (XUL/HTML 混合)
preferences.css        # 设置面板样式
prefs.js               # 偏好默认值
build-xpi.sh           # 打包脚本 → zotero-mineru-VERSION.xpi
updates.json           # 自动更新元数据
locale/
  en-US/zotero-mineru.ftl   # 英文菜单标签
  zh-CN/zotero-mineru.ftl   # 中文菜单标签
icon.svg / icon16.svg       # 插件图标
```

## 构建

```bash
bash build-xpi.sh
```

输出：`zotero-mineru-VERSION.xpi`（版本号读取自 manifest.json）。

版本号修改：编辑 `manifest.json` 中的 `"version"` 字段。

### 打包新版本流程

当用户要求"打包"或"打包为新版本"时：

1. 先将 `manifest.json` 中的 `"version"` 递增（patch +1，如 `0.1.43` → `0.1.44`）
2. 执行 `bash build-xpi.sh`
3. 确认输出的 `.xpi` 文件名包含新版本号

## 架构要点

### 插件加载流程

1. `bootstrap.js` → 注册偏好面板（3 种策略依次回退）
2. `Services.scriptloader.loadSubScript()` 加载 `mineru.js`
3. `ZoteroMineru.init()` → `addToAllWindows()` → 注册右键菜单

### 菜单注册（双轨制）

- **Zotero 8 MenuManager**（主路径）：`Zotero.MenuManager.registerMenu()` 注册 `CONTEXT_MENU_ID`，menus 数组包含所有菜单项
- **XUL 回退**（旧版兼容）：`createXULElement("menuitem")` + `popupshowing` 事件

两个菜单项共用同一个 `menuID`（`CONTEXT_MENU_ID`），卸载时 `unregisterMenu(CONTEXT_MENU_ID)` 一次清理。

### 偏好分支

`"extensions.zotero-mineru."` — 所有 pref key 均以此为前缀。

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| apiBaseURL | string | `https://mineru.net/api/v4` | MinerU API 地址 |
| apiToken | string | | API Token（自动去 `Bearer ` 前缀） |
| modelVersion | string | `pipeline` | `pipeline` 或 `vlm` |
| pollIntervalSec | int | 3 | 轮询间隔 |
| timeoutSec | int | 120 | 请求超时 |
| noteTitlePrefix | string | `MinerU Parse` | 笔记标题前缀 |
| llmApiBaseURL | string | | LLM API 地址 |
| llmApiKey | string | | LLM API Key |
| llmModel | string | | LLM 模型名称 |

`apiToken` 有 legacy `apiKey` 回退逻辑。

### 标签体系

| 标签 | 附加对象 | 用途 |
|------|---------|------|
| `#MinerU-Parse` | 笔记 | 标识由 MinerU 解析生成的笔记 |
| `#MinerU-Parsed` | 父条目 | 标识已完成解析的文献条目 |
| `#MinerU-Summary` | 笔记 | 标识由 AI 总结生成的笔记 |

### 防重复机制

- **解析**：`collectPDFTasks()` 检查父条目子笔记是否含 `#MinerU-Parse` 标签，有则跳过
- **总结**：`collectSummaryTasks()` 检查是否含 `#MinerU-Summary` 笔记，有则跳过
- 用户删除对应笔记或标签即可重新触发

## PDF 解析流程

1. 读取本地 PDF → `IOUtils.read()`
2. 申请上传地址 → POST `/file-urls/batch`
3. 上传 PDF → PUT 到返回的 upload URL
4. 轮询结果 → GET `/extract-results/batch/{batchID}`
5. 下载 ZIP → 4 种下载策略回退（直连/Bearer/HTTP→HTTPS）
6. 提取 Markdown → 解压 ZIP，查找 `.md` 文件
7. 内嵌图片 → `importEmbeddedImage` 或 data URI 回退
8. 写入笔记 → Markdown→HTML 转换，创建 Zotero note

## AI 总结流程

1. 校验 LLM 设置完整性
2. 从 `#MinerU-Parse` 笔记提取纯文本（截断 60000 字符）
3. POST `{llmApiBaseURL}/chat/completions`，120 秒超时
4. System prompt 要求结构化中文总结（背景/目的/方法/发现/结论）
5. 保存为新笔记，标签 `#MinerU-Summary`

## 编码约定

- **单例对象模式**：`ZoteroMineru = { ... }` 全局单例，非 class
- **Markdown→HTML**：优先尝试 Zotero 内置引擎（5 种方法名），失败回退自建解析器
- **窗口状态**：`popupListeners: new WeakMap()` 避免内存泄漏
- **错误上下文**：`wrapErrorWithParseStatus()` 在错误消息中附加当前解析阶段
- **进度反馈**：`Zotero.ProgressWindow` + `ItemProgress`，百分比 5→20→35→55→75→90→100
- **UI 字符串**：大部分硬编码中文，FTL 仅用于菜单标签
- **Tab 缩进**，无分号风格不一致（部分有部分无，保持现有风格即可）
