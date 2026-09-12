# Zotero MinerU Plugin

Zotero 8/9/10 插件，调用 MinerU 官方 API 解析 PDF，始终保存原始 Markdown，并支持可选 HTML、Markdown 转笔记、LLM 总结和翻译。本文描述 v0.1.70 的实现；版本号以 manifest.json 为准。

## 项目结构

```
manifest.json          # 插件元数据 (Zotero 8.0 到 10.0.*, ID: zotero-mineru@example.com)
bootstrap.js           # 插件生命周期入口 (install/startup/shutdown/uninstall)
mineru.js              # 核心业务逻辑（解析、总结、翻译、附件保存与 HTML 渲染）
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
vendor/katex/              # KaTeX 0.16.22、MIT 许可证和来源说明
tests/output-formats.test.cjs # Node VM 回归测试，模拟 Zotero / IOUtils / LLM
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

Windows 缺少 Bash / bsdtar 时，可用 Python `zipfile` 按 `build-xpi.sh` 的 FILES 清单打包；必须包含 `vendor/` 和 `locale/`，文件位于 ZIP 根目录，不能多包一层项目目录。不要覆盖已有测试安装包。检查 ZIP 完整性、包内版本及核心文件与工作区一致。仅打包测试版时不更新 GitHub 发布元数据、不推送标签。

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
4. 创建与 `manifest.json` 一致的 tag，例如 `git tag v0.1.69`
5. 推送 tag：`git push origin v0.1.69`
6. 等待 GitHub Actions `release.yml` 成功，确认 Release 非草稿且包含已上传的 `zotero-mineru.xpi`，再报告发布完成

补充说明：
- `release.yml` 会重新生成 `updates.json`，并仅在文件内容发生变化时自动提交回 `main`
- 如果 `main` 上的 `updates.json` 已经是目标版本和正确下载链接，workflow 不会再额外创建一个回写提交
- 真正触发 GitHub Release 和 XPI 上传的是 `v*` tag，不是 `main` 分支提交
- 发布时提交实际运行代码、设置、说明、测试和 vendor 依赖；不要把临时修复 HTML、下载的依赖压缩包等实验产物顺带提交
- `updates.json` 的版本及 Zotero 兼容范围应与 manifest 一致；工作流会使用固定资产名 `zotero-mineru.xpi`

## 架构要点

### 插件加载流程

1. `bootstrap.js` → 注册偏好面板（3 种策略依次回退）
2. `Services.scriptloader.loadSubScript()` 加载 `mineru.js`
3. `ZoteroMineru.init()` → `addToAllWindows()` → 注册右键菜单
4. `ZoteroMineru.main()` 异步启动

### 菜单注册（双轨制）

- **Zotero 8/9/10 MenuManager**（主路径）：`Zotero.MenuManager.registerMenu()` 注册 `ROOT_MENU_ID`，父菜单下包含解析、Markdown 转笔记、总结、翻译四个子项
- **XUL 回退**（旧版兼容）：`createXULElement("menu")` + `menupopup` + `popupshowing` 事件

上下文菜单现在是一个父菜单 + 四个子菜单项：
- `ROOT_MENU_ID`（"zotero-mineru-menu"）— 父菜单
- `CONTEXT_MENU_ID`（"zotero-mineru-parse-pdf"）— PDF 解析
- `MARKDOWN_NOTE_MENU_ID`（"zotero-mineru-markdown-to-note"）— 将 `#MinerU-Parse` Markdown 附件转为 Zotero 笔记
- `SUMMARY_MENU_ID`（"zotero-mineru-ai-summary"）— AI 总结
- `TRANSLATE_MENU_ID`（"zotero-mineru-ai-translate"）— AI 翻译

卸载时 `unregisterMenu(ROOT_MENU_ID)` 清理 MenuManager 注册。

### 偏好分支

`"extensions.zotero-mineru."` — 所有 pref key 均以此为前缀。

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| apiBaseURL | string | `https://mineru.net/api/v4` | MinerU API 地址 |
| apiToken | string | | API Token（自动去 `Bearer ` 前缀） |
| modelVersion | string | `pipeline` | `pipeline` 或 `vlm` |
| noteIncludeImages | bool | `false` | 将 Markdown 转为笔记时是否嵌入图片；默认关闭以减少 Zotero 卡顿 |
| pollIntervalSec | int | 3 | 轮询间隔（秒） |
| timeoutSec | int | 120 | 请求超时（秒） |
| noteTitlePrefix | string | `MinerU Parse` | Markdown 文件名前缀（也用于旧版笔记标题） |
| llmApiBaseURL | string | | LLM API 地址 |
| llmApiKey | string | | LLM API Key（自动去 `Bearer ` 前缀） |
| llmModel | string | | LLM 模型名称 |
| summaryLanguage | string | `中文` | AI 总结输出语言 |
| summaryPrompt | string | 空 | 自定义总结系统提示词；`{{language}}` 替换为总结语言，空值使用默认提示词 |
| summaryRequestJSON | string | 空 | 总结额外 JSON 参数，不得覆盖 model / messages |
| parseGenerateHTML | bool | `false` | 同时生成 HTML，并将其注册为主附件；始终保留 Markdown |
| parseImageMode | string | `folder` | HTML 图片方式：folder 共用 images，inline 内嵌；不影响 Markdown |
| translateOutputFormat | string | `md` | 翻译输出 md 或 html；HTML 固定内嵌图片 |
| translateMode | string | `translation` | translation 或 bilingual；双栏仅在 HTML 下生效 |
| translateRequestJSON | string | 空 | 翻译额外 JSON 参数，不得覆盖 model / messages |
| translateLanguage | string | `中文` | AI 翻译目标语言 |
| translateChunkSize | int | 20000 | 翻译分段字符数（长文分段翻译） |
| translateConcurrency | int | 3 | 翻译并发请求数（建议 1-4，过高可能触发限流） |
| translateRetryCount | int | 2 | 每段翻译自动重试次数，超出后再询问是否只重试失败段 |

`apiToken` 有 legacy `apiKey` 回退逻辑。

### 标签体系

| 标签 | 附加对象 | 用途 |
|------|---------|------|
| `#MinerU-Parse` | Markdown / HTML 主附件 | 标识解析结果；旧解析笔记也可能具有此标签 |
| `#MinerU-Parsed` | 父条目 | 标识已完成解析的文献条目 |
| `#MinerU-Summary` | 笔记 | 标识由 AI 总结生成的笔记 |
| `#MinerU-Translation` | Markdown / HTML 附件 | 完整翻译结果 |
| `#MinerU-Translation-Partial` | Markdown / HTML 附件 | 部分译文，不阻止重新翻译 |

### 防重复机制

- **解析**：`collectPDFTasks()` 检查父条目子附件或子笔记是否含 `#MinerU-Parse` 标签（兼容新旧格式），有则跳过
- **Markdown 转笔记**：`collectMarkdownToNoteTasks()` 检查是否存在 `#MinerU-Parse` Markdown 附件，且父条目还没有 `#MinerU-Parse` 笔记
- **总结**：`collectSummaryTasks()` 检查是否含 `#MinerU-Summary` 笔记，有则跳过
- **翻译**：`collectTranslateTasks()` 检查是否含 `#MinerU-Translation` 附件，有则跳过
- 用户删除对应附件/笔记或标签即可重新触发
- 总结和翻译优先使用明确选中的解析附件，即使父条目也被选中；每个父条目仅创建一个任务。没有明确选择时采用父条目下第一个带解析标签的附件。

## PDF 解析流程

1. 读取本地 PDF → `IOUtils.read()`
2. 申请上传地址 → POST `/file-urls/batch`
3. 上传 PDF → PUT 到返回的 upload URL
4. 轮询结果 → GET `/extract-results/batch/{batchID}`（`pollMineruExtractResult`）
5. 下载 ZIP → 4 种下载策略回退（直连 / Bearer 认证 / HTTP→HTTPS / HTTPS+Bearer）
6. 提取 Markdown → 解压 ZIP，`pickMarkdownEntry()` 选择 `.md` 文件（优先匹配原始文件名）
7. `saveResultAsMarkdownAttachment()` 调用 `saveDocumentAttachment()` 保存：
   - Markdown 始终使用 `images/image-N.ext` 相对引用，图片保存在同目录 images 文件夹
   - 默认注册 Markdown；开启 HTML 时只注册 HTML 主附件，并在同一存储目录保留同名 `.md` 和图片
   - 文件夹 HTML 与 Markdown 共用 images；内嵌 HTML 将图片转为 data URI，但配套 Markdown 仍使用文件夹
   - 一次解析只调用一次 `Zotero.Attachments.importFromFile()`，附件标签为 `#MinerU-Parse`，父条目为 `#MinerU-Parsed`
   - 文件保存失败时清理未完成附件；临时输出目录在 finally 中清理

存储结构：
```
Parent Item (论文条目)
├── 原始 PDF (附件)
├── MinerU Parse - xxx.md 或 .html (一个主附件，tagged #MinerU-Parse)
│   └── storage/<key>/
│       ├── MinerU Parse - xxx.md
│       ├── MinerU Parse - xxx.html  # 仅开启 HTML 时存在并作为主附件
│       └── images/
│           ├── image-1.png
│           ├── image-2.png
│           └── ...
├── MinerU Parse xxx (笔记, tagged #MinerU-Parse)   # 可通过“Markdown 转笔记”菜单生成
└── AI Summary (笔记, tagged #MinerU-Summary)
└── Translation (中文) - xxx.md 或 .html (独立附件，完整或部分翻译标签)
```

进度阶段：准备解析(5%) → 读取PDF(10%) → 申请上传(20%) → 上传(35%) → 等待解析(55%) → 下载结果(75%) → 提取Markdown(90%) → 提取完成(95%) → 保存Markdown(85%) → 完成(100%)

## AI 总结流程

1. `getLLMSettings()` 校验 LLM 配置，验证额外 JSON 参数。
2. `collectSummaryTasks()` 查找解析附件并按完整总结笔记去重，不再回退到解析笔记正文。
3. `readSourceMarkdown()` 读取原始 Markdown：Markdown 主附件直接读取；HTML 主附件读取同目录同名 `.md`。文件缺失时明确报错，不读取 HTML 页面或内置源数据。
4. `removeLocalImageReferences()` 去掉本地图片引用，保留 Markdown 正文；仍保留原有 60000 字符截断上限。
5. POST `{llmApiBaseURL}/chat/completions`，120 秒超时，temperature 0.3。支持目标语言、自定义系统提示词及额外 JSON 参数。
6. 保存为 `AI Summary {parentTitle}` 笔记，标签 `#MinerU-Summary`。

## AI 翻译流程

1. 校验 LLM 配置和额外 JSON 参数；`collectTranslateTasks()` 按完整翻译标签去重，部分译文不阻止重试。
2. 使用与总结共用的 `readSourceMarkdown()` 读取原始 Markdown。不要从 HTML 页面、HTML 内置源数据或笔记生成翻译输入。
3. `inlineStoredImagesInMarkdownAttachment()` 在本地读取图片字节，并将引用规范化为内部标识。方法名虽含 inline，这些图片数据并不发送给模型。
4. `splitMarkdownIntoChunks()` 按字符预算合并段落。Markdown、仅译文 HTML、双栏 HTML 使用同一分块策略，不能为双栏改成每自然段一个请求。
5. 限流并发调用 `callLLMForTranslation()`，默认并发 3，请求超时 180 秒，每个失败分块自动重试。
6. 成功结果按索引保留；自动重试耗尽后，等当前批次结束再提供“重试失败段落 / 保存已完成译文 / 放弃”。仅重试失败分块；无成功译文时不显示保存选项，关闭弹窗等同放弃。
7. 按原分块顺序合成结果并保存。`saveTranslationAsMarkdownAttachment()` 名称沿用历史，但实际支持 Markdown 和 HTML。
8. 部分结果标题和正文顶部注明“未完成”和完成段数，标签为 `#MinerU-Translation-Partial`。失败位置保留原文并标注；双栏左侧为原文，右侧仅标“未翻译”。
9. 保存部分结果后继续下一篇文献，最终分别报告完整、部分保存和失败数量。不实现跨任务续译，不自动删除部分附件。

### 图片隔离与文字批量翻译

- `prepareTranslationText()` 在图片位置拆开文字，将图片语法和内部标识保留在本地，并记录文字前后空白。
- 无图片分块直接请求和返回 Markdown；含图片分块把文字片段作为 JSON 字符串数组一次发送，要求返回同序同数量的 Markdown 字符串数组。
- 一个分块内有多张图也只发一次请求；纯图片分块直接原样返回，不调用模型。
- 返回数组格式、数量和非空字符串校验通过后，在本地按原位置插回图片；校验失败走现有重试流程。
- 图片引用、内部标识和 Base64 均不应出现在模型输入中；禁止回到要求模型原样保留图片标识的方案。
- Markdown 译文拥有自己的 images 文件夹，不依赖原解析附件的 storage 路径；HTML 译文固定内嵌图片，保存为单文件且不另存译文 Markdown。
- 双栏 HTML 使用同一批翻译结果本地渲染，按翻译分块对照，不增加 HTML 生成请求。

### 分段策略

- `splitTranslationBlocks()` 按空行划分段落，保留围栏代码和独立公式内部空行。
- `splitMarkdownIntoChunks()` 将完整段落合并至字符预算；单个段落超过预算时保留整段，不硬切公式或代码。
- `translateChunkSize` 是合并预算，不是严格上限。输出布局不能改变请求数，图片位置的文字拆分也不能变成逐片独立请求。

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

### 导出 HTML 的公式渲染

`saveDocumentAttachment()` 使用 `renderDocumentBody()` 和 `renderHTMLMath()`，通过内置 `vendor/katex/katex.min.js` 将公式渲染为 MathML，支持离线查看，无需远程脚本或字体。无效公式保留源码并标示错误。不要将完整 HTML、MathML 或页面样式发送给总结或翻译模型。

## 图片嵌入

- 从 MinerU ZIP 结果中提取图片，支持 png/jpg/jpeg/gif/webp/bmp/svg/tif/tiff
- 路径解析：`resolveArchiveReference()` 处理相对路径，大小写不敏感匹配
- 对已有 Markdown 附件转笔记时，`buildParsedResultFromMarkdownAttachment()` 会按 `noteIncludeImages` 决定是否读取 storage 中的图片并复用嵌图逻辑
- 两种嵌入策略：
  1. `Zotero.Attachments.importEmbeddedImage`（15s 超时）
  2. data URI base64 回退（`bytesToBase64` 分块转换）
- 图片占位符 `zotero-mineru-image://{id}` 替换为 attachment key 或 data URI

## 设置面板

preferences.xhtml 分两个区域：MinerU 设置 + LLM 设置，Grid 布局（170px 标签列）。

模型版本、总结语言和翻译目标语言使用带 `native="true"` 的 XUL `menulist`，并通过 `command` 事件保存。不要改回嵌入式 HTML `select`，否则在 Zotero 偏好面板中可能出现下拉菜单偶发无法弹出的问题。

三个按钮：
- **保存** — 保存所有偏好
- **测试 MinerU 连接** — POST `/file-urls/batch` 验证 API 可用性
- **测试 LLM 连接** — POST `/chat/completions` 验证 LLM 可用性（30s 超时）

MinerU 解析相关设置项补充：
- Markdown 附件默认带图保存，不受设置开关影响
- **转化笔记时带图** — 控制“Markdown 转笔记”菜单生成的 Zotero 笔记是否嵌图，默认关闭

翻译相关设置项补充：
- **翻译分段字符数** — 控制完整段落合并预算；单个超长段落可超过该值
- **翻译并发请求数** — 控制同一篇文档同时发出的翻译请求数
- **翻译自动重试次数** — 控制单段翻译失败后的自动重试次数

- **同时生成 HTML** — 默认关闭；始终保留原始 Markdown。开启后 Zotero 显示 HTML 主附件，需要右键打开所在文件夹查看 `.md`；设置页必须保留此提示。
- **HTML 图片保存方式** — 仅影响解析 HTML，关闭 HTML 时禁用。
- **翻译保存格式** — 默认 Markdown，可选单文件 HTML；不提供翻译图片方式选项。
- **双栏模式** — 仅 HTML 生效；选择 Markdown 时禁用控件但保留偏好。

## 验证与回归测试

```bash
node --check mineru.js
node --check preferences.js
node tests/output-formats.test.cjs
git diff --check
```

测试模拟 Zotero、存储和模型，覆盖解析附件及配套 Markdown、图片与公式、输出模式、文字片段还原、异常返回、重试和部分保存、批处理继续、显式附件选择、总结原始 Markdown 读取与缺失报错，以及双栏请求数一致性。

- 设置 XHTML 修改后检查 XML 结构；运行代码变更需执行相关回归测试。
- 这些测试不能替代 Zotero 实际界面、附件打开、重启和同步验证。未实际验证时须明确说明，不能据模拟测试声称同步已通过。
- `tests/repair-equation-sample.cjs`、`equations-fixed.html`、下载的 KaTeX 压缩包属于本地实验/修复材料，不是正式构建所需文件。
- 新增兼容逻辑以已正式发布版本为基线，不为未发布实验版本增加迁移分支。解析笔记的历史标签识别不意味着总结可以回退读取笔记。

## 文档维护

- 当菜单结构、设置项、核心流程、发布流程、存储策略或用户可见行为发生变化时，必须在同一次工作中同步更新 `CLAUDE.md`
- 如果用户要求“顺手更新说明”“同步文档”“记录流程”，默认更新本文件，而不是只改 README 或只留在提交信息里
- 发布前若本次改动改变了开发约定或使用方式，应先检查 `CLAUDE.md` 是否需要一起修改

## 编码约定

- **单例对象模式**：`ZoteroMineru = { ... }` 全局单例，非 class
- **窗口状态**：`popupListeners: new WeakMap()` 避免内存泄漏
- **错误上下文**：`wrapErrorWithParseStatus()` 在错误消息中附加当前解析阶段
- **进度反馈**：`Zotero.ProgressWindow` + `ItemProgress`，`reportParseStatus()` 统一更新
- **UI 字符串**：大部分硬编码中文，FTL 仅用于菜单标签
- **Tab 缩进**，无分号风格不一致（部分有部分无，保持现有风格即可）
- **URL 安全**：`maskURLForError()` 截短 URL 用于错误日志，`normalizeDownloadURL()` 验证下载地址

### 源 PDF 关联（v0.1.70）

- `parseLinkSourcePDF` 默认 true，缺失设置亦开启；仅在解析结果保存后关联源 PDF 与 Markdown/HTML 主附件。
- `linkParseSource()` 使用双向 addRelatedItem，在单一事务中保存，失败后重新加载关系并保留解析附件，批处理显示关联警告后继续。
- 不补配历史结果；关闭不删除关系，不扩展到总结、翻译和转换笔记。
- 回归测试：`node tests/related-items.test.cjs`。
