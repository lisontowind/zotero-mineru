# Zotero MinerU Plugin

Zotero 8/9/10 插件，调用 MinerU 官方 API 解析 PDF，始终保存原始 Markdown，并支持可选 HTML、Markdown 转笔记、LLM 总结和翻译。当前开发分支基于 v0.1.71，包含英文界面与 LLM 响应兼容改进；版本号以 manifest.json 为准。

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
tests/network-reliability.test.cjs # 下载认证、网络中止、退避重试和全文总结回归测试
tests/llm-response-compatibility.test.cjs # SSE 完整性、原生完成状态及含代码的批量译文
tests/abort-controller.test.cjs # Zotero 窗口控制器回退、无控制器拒绝请求及真实中止
tests/localization.test.cjs # 中英文菜单及设置语言检测
tests/document-safety.test.cjs # 链接协议、图片路径边界和解析器失败回退
tests/settings-safety.test.cjs # 设置先校验后写入、范围与保留字段校验
tests/task-locks.test.cjs # 跨窗口任务互斥、批次预留及异常后释放

tests/result-tags.test.cjs # 结果保存后同步标记父文献条目，保留子条目标签
tests/html-safety.browser.html # 使用浏览器原生 DOM 验证 HTML 表格过滤和公式
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
| timeoutSec | int | 120 | MinerU 单次请求（含正文读取）超时及解析轮询总时限（秒） |
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
| `#MinerU-Parse` | 父文献条目及 Markdown / HTML 主附件、解析笔记 | 标识解析结果；子条目标签继续用于结果识别 |
| `#MinerU-Parsed` | 父条目 | 标识已完成解析的文献条目 |
| `#MinerU-Summary` | 父文献条目及笔记 | 标识由 AI 总结生成的笔记 |
| `#MinerU-Translation` | 父文献条目及 Markdown / HTML 附件 | 完整翻译结果 |
| `#MinerU-Translation-Partial` | 父文献条目及 Markdown / HTML 附件 | 部分译文，不阻止重新翻译 |

`tagResultParent()` 在解析附件、解析笔记、总结笔记、翻译附件保存成功后统一添加对应父条目标签；解析还保留 `#MinerU-Parsed`。保留现有用户标签，无父条目的独立解析结果仍只标记自身。已有结果不自动补标，父条目标签仅用于检索，不参与防重复判断，也不随子条目删除而自动清除。

### 防重复机制

- **解析**：`collectPDFTasks()` 检查父条目子附件或子笔记是否含 `#MinerU-Parse` 标签（兼容新旧格式），有则跳过
- **Markdown 转笔记**：`collectMarkdownToNoteTasks()` 检查是否存在 `#MinerU-Parse` Markdown 附件，且父条目还没有 `#MinerU-Parse` 笔记
- **总结**：`collectSummaryTasks()` 检查是否含 `#MinerU-Summary` 笔记，有则跳过
- **翻译**：`collectTranslateTasks()` 检查是否含 `#MinerU-Translation` 附件，有则跳过
- 用户删除对应附件/笔记或标签即可重新触发
- 总结和翻译优先使用明确选中的解析附件，即使父条目也被选中；每个父条目仅创建一个任务。没有明确选择时采用父条目下第一个带解析标签的附件。

### 运行中任务保护

- 四个 `handle*Command` 在收集任务后统一经过 `runTaskBatch()`，实际执行分别交给 `runParseTasks()`、`runMarkdownToNoteTasks()`、`runSummaryTasks()`、`runTranslateTasks()`；菜单及其他入口应始终调用 `handle*Command`。
- `activeTaskKeys` 在插件单例中跨 Zotero 窗口共享。Key 为操作类型 + Zotero 条目 ID：解析以源 PDF 为单位，总结/翻译以父条目为单位；转笔记有父条目时按父条目、独立附件按附件去重。
- 首次异步操作或转笔记确认弹窗前，同步预留整个批次，含尚未开始的条目；预留持续到整个批次退出。重复选择也在批次内去重，同父条目的不同 PDF 仍可分别解析。
- 重复触发时只执行未被占用的条目，在进度中报告跳过数量；全部被占用时提示等待。MenuManager 和 XUL 菜单共用过滤后的任务列表，重新展开时不启用仅含占用条目的同类操作。不同条目及不同操作可并行。
- `finally` 统一释放本批次预留，涵盖处理/保存失败、进度窗口异常、取消转笔记。运行中保护仅在当前插件实例内生效，不提供任务取消或跨重启恢复。

## PDF 解析流程

1. 读取本地 PDF → `IOUtils.read()`
2. 申请上传地址 → POST `/file-urls/batch`
3. 上传 PDF → PUT 到返回的 upload URL
4. 轮询结果 → GET `/extract-results/batch/{batchID}`（`pollMineruExtractResult`）
5. 下载 ZIP → 匿名下载优先，HTTP 地址先尝试 HTTPS；仅配置 API 同源的 HTTPS 地址可回退到 Bearer 认证，认证请求拒绝重定向，第三方下载地址和 HTTP 请求不携带 Token。
6. 提取 Markdown → 解压 ZIP，`pickMarkdownEntry()` 选择 `.md` 文件（优先匹配原始文件名）
7. `saveResultAsMarkdownAttachment()` 调用 `saveDocumentAttachment()` 保存：
   - Markdown 始终使用 `images/image-N.ext` 相对引用，图片保存在同目录 images 文件夹
   - 默认注册 Markdown；开启 HTML 时只注册 HTML 主附件，并在同一存储目录保留同名 `.md` 和图片
   - 文件夹 HTML 与 Markdown 共用 images；内嵌 HTML 将图片转为 data URI，但配套 Markdown 仍使用文件夹
   - 一次解析只调用一次 `Zotero.Attachments.importFromFile()`，附件标签为 `#MinerU-Parse`，父条目为 `#MinerU-Parse` 和 `#MinerU-Parsed`
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
4. `removeLocalImageReferences()` 去掉本地图片引用，保留 Markdown 正文，不截断长文。
5. `summarizeFullDocument()` 对不超过 60000 字符的正文直接总结；超出时按最多 50000 字符分段，优先沿换行切分且不切断 UTF-16 代理对。顺序总结每段，再汇总全部研究笔记；中间结果仍超预算时继续分层压缩（最多 6 轮），未缩短则明确报错。长文会增加模型请求次数和费用。
6. POST `{llmApiBaseURL}/chat/completions`，每次请求 120 秒超时，temperature 0.3。各阶段保留目标语言、自定义系统提示词及额外 JSON 参数；分段和汇总阶段额外说明输入性质。
7. 仅最终汇总成功后保存为 `AI Summary {parentTitle}` 笔记，标签 `#MinerU-Summary`；中间结果不保存，任一步失败均不生成完整总结。

## AI 翻译流程

1. 校验 LLM 配置和额外 JSON 参数；`collectTranslateTasks()` 按完整翻译标签去重，部分译文不阻止重试。
2. 使用与总结共用的 `readSourceMarkdown()` 读取原始 Markdown。不要从 HTML 页面、HTML 内置源数据或笔记生成翻译输入。
3. `inlineStoredImagesInMarkdownAttachment()` 在本地读取图片字节，并将引用规范化为内部标识。方法名虽含 inline，这些图片数据并不发送给模型。
4. `splitMarkdownIntoChunks()` 按字符预算合并段落。Markdown、仅译文 HTML、双栏 HTML 使用同一分块策略，不能为双栏改成每自然段一个请求。
5. 限流并发调用 `callLLMForTranslation()`，默认并发 3，请求超时 180 秒。临时错误自动重试前等待指数退避（1 秒起、±20% 抖动、基数最多 30 秒），同时考虑 Retry-After（秒数或 HTTP 日期，上限 120 秒）；除 408/425/429 外的 4xx 不自动重试，最后一次失败后不再等待。失败记录保留实际尝试次数。
6. 成功结果按索引保留；自动重试耗尽后，等当前批次结束再提供“重试失败段落 / 保存已完成译文 / 放弃”。仅重试失败分块；无成功译文时不显示保存选项，关闭弹窗等同放弃。
7. 按原分块顺序合成结果并保存。`saveTranslationAsMarkdownAttachment()` 名称沿用历史，但实际支持 Markdown 和 HTML。
8. 部分结果标题和正文顶部注明“未完成”和完成段数，标签为 `#MinerU-Translation-Partial`。失败位置保留原文并标注；双栏左侧为原文，右侧仅标“未翻译”。
9. 保存部分结果后继续下一篇文献，最终分别报告完整、部分保存和失败数量。不实现跨任务续译，不自动删除部分附件。

### 网络超时与 LLM 完整性

- MinerU 申请上传、上传、轮询、结果下载及总结/翻译请求使用 `withRequestTimeout()`，将 AbortSignal 传给 fetch，超时或失败时主动中止；超时涵盖响应正文读取。普通 `withTimeout()` 继续用于嵌图等非网络操作。
- bootstrap 和核心脚本从 Zotero 主窗口补齐缺失的 AbortController / Headers；设置页亦可从窗口获取原生控制器。无法创建原生 AbortController 时，在发出请求前明确报错，禁止以空事件监听的模拟 signal 代替。设置页的 MinerU 测试同样显示此错误。
- MinerU 单次网络请求使用 `timeoutSec`；轮询请求与等待受剩余总时限约束。下载的每个候选地址各有一次请求时限。
- 总结、翻译及设置页 LLM 测试均校验完成状态：OpenAI finish_reason、Gemini finishReason 和 Ollama done_reason 支持大小写规范化，只接受 stop / end_turn / stop_sequence；length / MAX_TOKENS、安全过滤及 done=false 均拒绝。普通 JSON 仍兼容未提供完成原因的服务。Gemini 多个正文 part 合并，thought part 不保存。
- LLM URL 可填写 Base URL 或完整 /chat/completions 地址；仅规范化 URL pathname，保留查询参数和 fragment，设置读取层不得裁剪查询参数值末尾的斜杠。总结、翻译和设置页连接测试共用相同的地址处理规则。
- 请求默认 stream=false，接受 JSON、带 BOM / 外层代码围栏的 JSON，以及网关返回的 OpenAI 风格 SSE。SSE 按事件合并 data 行，要求明确 finish_reason 或 [DONE]，损坏事件、错误事件和结束后追加数据均报错，禁止把残缺内容当作完整结果。忽略其他 choice 与 usage 事件；只移除响应开头连续成对的 think 推理前缀，保留正文、Markdown 代码和 JSON 字符串内部的字面标签。
- 截断译文进入现有分段重试和部分保存流程，截断内容本身不作为成功分块保留；不声称能检测模型未报告的内容遗漏。

### 图片隔离与文字批量翻译

- `prepareTranslationText()` 在图片位置拆开文字，将图片语法和内部标识保留在本地，并记录文字前后空白。
- 无图片分块直接请求和返回 Markdown；含图片分块把文字片段作为 JSON 字符串数组一次发送，要求返回同序同数量的 Markdown 字符串数组。
- 一个分块内有多张图也只发一次请求；纯图片分块直接原样返回，不调用模型。
- 返回数组格式、数量和非空字符串校验通过后，在本地按原位置插回图片；校验失败走现有重试流程。
- 批量译文先直接解析完整 JSON；有说明文字或外层代码围栏时，单次扫描并只接受唯一完整的外层 JSON 数组。多个有效数组、未闭合数组或只能从损坏外层提取的嵌套数组均拒绝并进入现有重试流程，禁止把示例或说明标签当作译文。JSON 字符串内部的代码围栏、think 标签、引号、反斜杠和方括号属于译文，必须保留。
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

### 自建渲染器的内容边界

- Markdown 链接仅允许 HTTP(S)、mailto、zotero 和相对链接；拒绝 javascript、data、file 等协议及控制字符，校验兼顾 HTML 实体编码。
- 原始 HTML 表格先经原生 DOMParser 解析，再保留表格及基础格式元素、受限属性和安全链接；删除事件、样式及活动内容。解析器不可用或失败时转义源码，不直接返回原始 HTML。公式标记在过滤后转换。
- 本地图片读取以当前 Markdown 所在目录为边界，拒绝越界的 `..`、编码后的越界、绝对路径、控制字符、备用数据流及 Windows 尾部点/空格路径；保留正常相对图片、盘符路径和 UNC 基目录。此检查为路径层面的限制，未额外解析文件系统符号链接。

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

设置及主要运行界面按 Zotero 语言切换中文或英文，非中文环境使用英文。设置文字通过 en-US / zh-CN Fluent 资源加载，并保留 JavaScript 英文回退；FTL 中的字面量 {{language}} 必须写成 `{ "{{language}}" }`，不能被解释为消息引用。总结和翻译语言菜单包含 Tiếng Việt。

设置片段的本地化链接必须使用 HTML 命名空间的 `html:link rel="localization"`。根节点是 XUL vbox，未加前缀的 link 不会注册 Fluent 资源，会导致首次打开时 document.l10n.translateFragment() 报错；不能只依赖 init() 后补加载资源。

模型版本、总结语言和翻译目标语言使用带 `native="true"` 的 XUL `menulist`，并通过 `command` 事件保存。不要改回嵌入式 HTML `select`，否则在 Zotero 偏好面板中可能出现下拉菜单偶发无法弹出的问题。

三个按钮：
- **保存** — 保存所有偏好
- **测试 MinerU 连接** — POST `/file-urls/batch` 验证 API 可用性
- **测试 LLM 连接** — POST `/chat/completions` 验证 LLM 可用性（30s 超时）

设置保存先校验全部字段，再写入偏好；任何校验失败都不写入本次设置。数值必须为完整整数且符合界面最小/最大值，额外 JSON 不得覆盖 model/messages。错误字段带 `aria-invalid` 和红色轮廓，自动保存也显示错误但不抢焦点；显式保存会聚焦错误字段。校验通过后清除错误；两个连接测试均在校验失败时停止，避免使用旧配置。Token 和 LLM Key 保存前去除空白及 Bearer 前缀。

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
node tests/network-reliability.test.cjs
node --test tests/llm-response-compatibility.test.cjs tests/abort-controller.test.cjs tests/localization.test.cjs
node tests/related-items.test.cjs
node --test tests/document-safety.test.cjs tests/settings-safety.test.cjs
node --test tests/task-locks.test.cjs
node --test tests/result-tags.test.cjs
git diff --check
```

测试模拟 Zotero、存储和模型，覆盖解析附件及配套 Markdown、图片与公式、输出模式、文字片段还原、异常返回、重试和部分保存、批处理继续、显式附件选择、总结原始 Markdown 读取与缺失报错，以及双栏请求数一致性。

网络回归测试另覆盖 Token 来源限制、认证请求禁用重定向、请求及正文读取超时中止、上传阶段报错、超时后重试不叠加、轮询总时限、Retry-After 和永久错误不重试、LLM 截断返回拒绝，以及长文分段覆盖、分层汇总、自定义 Prompt 和不收敛保护。

安全回归测试覆盖图片路径边界、危险/编码链接、DOMParser 失败时转义、设置校验零写入、数值范围、JSON 保留字段和连接测试阻断。用浏览器打开 `tests/html-safety.browser.html`，结果应显示 PASS；该测试使用真实 DOMParser 验证表格属性过滤，同时保留表格、基础格式、公式与正常链接。

任务互斥回归测试覆盖四个命令的跨窗口重复执行、保存阶段保护、处理和保存失败后重试、尚未执行条目的批次预留、混合选择继续执行、不同操作并行、确认弹窗重入、取消与窗口异常后释放，以及菜单可用性恢复。输出格式测试的批处理模拟必须使用不同父条目 ID 表示不同文献。

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
- **UI 字符串**：设置和菜单使用 Fluent，主要运行提示按 isEnglishLocale() 选择中英文；同步维护两种语言及设置页回退文字
- **Tab 缩进**，无分号风格不一致（部分有部分无，保持现有风格即可）
- **URL 安全**：`maskURLForError()` 截短 URL 用于错误日志，`normalizeDownloadURL()` 验证下载地址

### 源 PDF 关联（v0.1.70）

- `parseLinkSourcePDF` 默认 true，缺失设置亦开启；仅在解析结果保存后关联源 PDF 与 Markdown/HTML 主附件。
- `linkParseSource()` 使用双向 addRelatedItem，在单一事务中保存，失败后重新加载关系并保留解析附件，批处理显示关联警告后继续。
- 不补配历史结果；关闭不删除关系，不扩展到总结、翻译和转换笔记。
- 回归测试：`node tests/related-items.test.cjs`。
