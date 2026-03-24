# Zotero MinerU Plugin

Zotero 8 插件，调用 MinerU 官方 API 解析 PDF 为 Markdown 文件附件，并支持 LLM AI 中文总结。

## 项目结构

```
manifest.json          # 插件元数据 (Zotero 8.0+, ID: zotero-mineru@example.com)
bootstrap.js           # 插件生命周期入口 (install/startup/shutdown/uninstall)
mineru.js              # 核心业务逻辑 (~2200 行，菜单注册、PDF 解析、AI 总结、Markdown→HTML)
preferences.js         # 设置面板控制 (加载/保存/连接测试)
preferences.xhtml      # 设置面板布局 (XUL/HTML 混合)
preferences.css        # 设置面板样式
prefs.js               # 偏好默认值
build-xpi.sh           # 打包脚本 → zotero-mineru-VERSION.xpi (使用 bsdtar)
updates.json           # 自动更新元数据
.github/workflows/
  release.yml          # GitHub Actions 发布工作流 (tag v* 触发)
.gitignore             # 忽略 *.xpi 文件
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

### 发布流程 (GitHub Actions)

`release.yml` 由 `v*` tag 触发：
1. 校验 tag 版本与 manifest.json 一致
2. 构建 XPI
3. 更新 updates.json 中的下载链接并提交回 main
4. 创建 GitHub Release（附带 XPI 文件）

### 手动发布新版本的实际顺序

当用户要求“发布新版本”时，按下面顺序执行，避免 tag 指向错误提交：

1. 先把 `manifest.json` 的 `"version"` 递增到目标版本
2. 如需本地验证，执行 `bash build-xpi.sh`，确认生成的 `.xpi` 文件名包含新版本号
3. 提交版本变更并先 `git push origin main`
4. 创建与 `manifest.json` 一致的 tag，例如 `git tag v0.1.49`
5. 推送 tag：`git push origin v0.1.49`
6. 等待 GitHub Actions `release.yml` 完成发布

补充说明：
- `release.yml` 会重新生成 `updates.json`，并仅在文件内容发生变化时自动提交回 `main`
- 如果 `main` 上的 `updates.json` 已经是目标版本和正确下载链接，workflow 不会再额外创建一个回写提交
- 真正触发 GitHub Release 和 XPI 上传的是 `v*` tag，不是 `main` 分支提交

## 架构要点

### 插件加载流程

1. `bootstrap.js` → 注册偏好面板（3 种策略依次回退）
2. `Services.scriptloader.loadSubScript()` 加载 `mineru.js`
3. `ZoteroMineru.init()` → `addToAllWindows()` → 注册右键菜单
4. `ZoteroMineru.main()` 异步启动

### 菜单注册（双轨制）

- **Zotero 8 MenuManager**（主路径）：`Zotero.MenuManager.registerMenu()` 注册 `CONTEXT_MENU_ID`，menus 数组包含解析和总结菜单项
- **XUL 回退**（旧版兼容）：`createXULElement("menuitem")` + `popupshowing` 事件

两个菜单项有各自的 ID：
- `CONTEXT_MENU_ID`（"zotero-mineru-parse-pdf"）— PDF 解析
- `SUMMARY_MENU_ID`（"zotero-mineru-ai-summary"）— AI 总结
- `TRANSLATE_MENU_ID`（"zotero-mineru-ai-translate"）— AI 翻译

卸载时 `unregisterMenu(CONTEXT_MENU_ID)` 清理 MenuManager 注册。

### 偏好分支

`"extensions.zotero-mineru."` — 所有 pref key 均以此为前缀。

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| apiBaseURL | string | `https://mineru.net/api/v4` | MinerU API 地址 |
| apiToken | string | | API Token（自动去 `Bearer ` 前缀） |
| modelVersion | string | `pipeline` | `pipeline` 或 `vlm` |
| pollIntervalSec | int | 3 | 轮询间隔（秒） |
| timeoutSec | int | 120 | 请求超时（秒） |
| noteTitlePrefix | string | `MinerU Parse` | Markdown 文件名前缀（也用于旧版笔记标题） |
| llmApiBaseURL | string | | LLM API 地址 |
| llmApiKey | string | | LLM API Key（自动去 `Bearer ` 前缀） |
| llmModel | string | | LLM 模型名称 |
| summaryLanguage | string | `中文` | AI 总结输出语言 |
| translateLanguage | string | `中文` | AI 翻译目标语言 |
| translateChunkSize | int | 20000 | 翻译分段字符数（长文分段翻译） |

`apiToken` 有 legacy `apiKey` 回退逻辑。

### 标签体系

| 标签 | 附加对象 | 用途 |
|------|---------|------|
| `#MinerU-Parse` | Markdown 附件 | 标识由 MinerU 解析生成的 Markdown 附件（旧版为笔记） |
| `#MinerU-Parsed` | 父条目 | 标识已完成解析的文献条目 |
| `#MinerU-Summary` | 笔记 | 标识由 AI 总结生成的笔记 |
| `#MinerU-Translation` | Markdown 附件 | 标识由 AI 翻译生成的 Markdown 附件 |

### 防重复机制

- **解析**：`collectPDFTasks()` 检查父条目子附件或子笔记是否含 `#MinerU-Parse` 标签（兼容新旧格式），有则跳过
- **总结**：`collectSummaryTasks()` 检查是否含 `#MinerU-Summary` 笔记，有则跳过
- **翻译**：`collectTranslateTasks()` 检查是否含 `#MinerU-Translation` 附件，有则跳过
- 用户删除对应附件/笔记或标签即可重新触发

## PDF 解析流程

1. 读取本地 PDF → `IOUtils.read()`
2. 申请上传地址 → POST `/file-urls/batch`
3. 上传 PDF → PUT 到返回的 upload URL
4. 轮询结果 → GET `/extract-results/batch/{batchID}`（`pollMineruExtractResult`）
5. 下载 ZIP → 4 种下载策略回退（直连 / Bearer 认证 / HTTP→HTTPS / HTTPS+Bearer）
6. 提取 Markdown → 解压 ZIP，`pickMarkdownEntry()` 选择 `.md` 文件（优先匹配原始文件名）
7. 保存为 Markdown 附件 → `saveResultAsMarkdownAttachment()`：
   - 通过 `rewriteImagePathsForStorage()` 将图片引用重写为 `images/<filename>` 相对路径
   - 调用 `Zotero.Attachments.importFromFile()` 创建 stored file attachment
   - 在附件存储目录下创建 `images/` 子目录，写入所有图片文件
   - 给附件打 `#MinerU-Parse` tag，给父条目打 `#MinerU-Parsed` tag

存储结构：
```
Parent Item (论文条目)
├── 原始 PDF (附件)
├── MinerU Parse - xxx.md (stored attachment, tagged #MinerU-Parse)
│   └── storage/<key>/
│       ├── MinerU Parse - xxx.md
│       └── images/
│           ├── fig1.png
│           ├── fig2.png
│           └── ...
└── AI Summary (笔记, tagged #MinerU-Summary)
└── Translation (中文) - xxx.md (stored attachment, tagged #MinerU-Translation)
```

进度阶段：准备解析(5%) → 读取PDF(10%) → 申请上传(20%) → 上传(35%) → 等待解析(55%) → 下载结果(75%) → 提取Markdown(90%) → 提取完成(95%) → 保存Markdown(85%) → 完成(100%)

## AI 总结流程

1. `getLLMSettings()` 校验 LLM 设置完整性
2. `collectSummaryTasks()` 查找 `#MinerU-Parse` 标签的附件（优先）或笔记（旧格式兼容）
3. 提取文本：
   - **附件格式**：直接读取 `.md` 文件内容（`IOUtils.read()`）
   - **笔记格式（旧）**：`getNote()` 获取 HTML → `stripHTMLToPlainText()` 提取纯文本
4. 截断 60000 字符后 POST `{llmApiBaseURL}/chat/completions`，120 秒超时，temperature 0.3
5. System prompt 要求结构化中文总结（背景/目的/方法/发现/结论）
6. 保存为新笔记，标题 "AI Summary {parentTitle}"，标签 `#MinerU-Summary`

## AI 翻译流程

1. `getLLMSettings()` 校验 LLM 设置完整性，获取 `translateLanguage` 和 `translateChunkSize`
2. `collectTranslateTasks()` 查找 `#MinerU-Parse` 标签的附件，检查 `#MinerU-Translation` 附件去重
3. 读取 `.md` 文件全文 → `splitMarkdownIntoChunks()` 按标题/段落分段
4. 逐段调用 `callLLMForTranslation()`，180 秒超时，system prompt 要求保持 Markdown 格式
5. 拼接翻译结果 → `saveTranslationAsMarkdownAttachment()` 保存为 Markdown 附件
6. 文件名格式：`Translation ({language}) - {sourceTitle}.md`，标签 `#MinerU-Translation`

### 分段策略

1. 按 `# ` / `## ` 标题行分割
2. 若单段 > chunkSize，按 `\n\n` 段落再分
3. 若单段落仍 > chunkSize，按行硬切
4. 每段独立发送 LLM，带"第 X/N 段"上下文提示

## Markdown→HTML 转换

### Zotero 内置引擎回退链（5 种方法名）

1. `Zotero.EditorInstanceUtilities.md2html`
2. `Zotero.EditorInstanceUtilities.markdownToHTML`
3. `Zotero.EditorInstanceUtilities.markdown2html`
4. `Zotero.Utilities.Internal.md2html`
5. `Zotero.Utilities.markdownToHTML`

### 自建回退解析器（`convertMarkdownToBasicHTML`）

当内置引擎不可用或结果含未解析的数学公式/表格时启用，支持：
- 标题 (h1-h6)、段落、代码块（含语言标注）
- 有序/无序列表、引用块、水平线
- **数学公式**：行内 `$...$` → `<span class="math">`，块级 `$$...$$` → `<pre class="math">`
- **Markdown 表格**：含对齐支持（left/center/right）
- **HTML 表格**：直通处理，自动转换表格内数学标记
- 行内样式：粗体、行内代码、链接、图片

## 图片嵌入

- 从 MinerU ZIP 结果中提取图片，支持 png/jpg/jpeg/gif/webp/bmp/svg/tif/tiff
- 路径解析：`resolveArchiveReference()` 处理相对路径，大小写不敏感匹配
- 两种嵌入策略：
  1. `Zotero.Attachments.importEmbeddedImage`（15s 超时）
  2. data URI base64 回退（`bytesToBase64` 分块转换）
- 图片占位符 `zotero-mineru-image://{id}` 替换为 attachment key 或 data URI

## 设置面板

preferences.xhtml 分两个区域：MinerU 设置 + LLM 设置，Grid 布局（170px 标签列）。

三个按钮：
- **保存** — 保存所有偏好
- **测试 MinerU 连接** — POST `/file-urls/batch` 验证 API 可用性
- **测试 LLM 连接** — POST `/chat/completions` 验证 LLM 可用性（30s 超时）

## 编码约定

- **单例对象模式**：`ZoteroMineru = { ... }` 全局单例，非 class
- **窗口状态**：`popupListeners: new WeakMap()` 避免内存泄漏
- **错误上下文**：`wrapErrorWithParseStatus()` 在错误消息中附加当前解析阶段
- **进度反馈**：`Zotero.ProgressWindow` + `ItemProgress`，`reportParseStatus()` 统一更新
- **UI 字符串**：大部分硬编码中文，FTL 仅用于菜单标签
- **Tab 缩进**，无分号风格不一致（部分有部分无，保持现有风格即可）
- **URL 安全**：`maskURLForError()` 截短 URL 用于错误日志，`normalizeDownloadURL()` 验证下载地址
