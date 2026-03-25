# Zotero MinerU Parser

[English README](README.md)

一个适用于 Zotero 8 的插件：将 PDF 附件发送到 MinerU API 进行解析，并把结果保存回 Zotero 的 Markdown 附件，同时支持 AI 总结和 AI 翻译。

## 功能

- 支持使用 `pipeline` 或 `vlm` 模型解析选中的 PDF 附件。
- 将解析结果保存为 Markdown 附件，而不是 Zotero 笔记。
- 保留 MinerU 解析出的图片，并保存到解析附件的 `images/` 目录。
- 基于解析后的 Markdown 附件生成 AI 总结。
- 基于解析后的 Markdown 附件生成 AI 翻译。
- 长文翻译支持分段、限流并发、自动重试，以及失败段落二次确认重试。
- 翻译后的 Markdown 不复制图片文件，而是把图片链接改写为指向原解析附件 storage 目录的相对路径。
- Zotero 右键菜单下使用统一的 `MinerU` 子菜单，包含三个功能入口。

## 运行要求

- Zotero `8.0+`
- 有效的 MinerU API Token
- 如果要使用 AI 总结或 AI 翻译，还需要额外配置 LLM API

## 安装

1. 从 GitHub Releases 下载最新 `.xpi` 文件。
2. 在 Zotero 中打开 `工具 -> 插件`。
3. 点击齿轮图标，选择 `Install Plugin From File...`。
4. 选择下载好的 `.xpi` 文件。
5. 如果 Zotero 提示重启，则重启 Zotero。

## 配置

打开 `编辑 -> 首选项 -> MinerU`，按需配置以下内容。

### MinerU 设置

- `API Base URL`
- `API Token`
- `Model Version`
- `Poll Interval`
- `Timeout`
- `Note Title Prefix`

### LLM 设置

- `LLM API Base URL`
- `LLM API Key`
- `LLM Model`
- `Summary Language`
- `Summary Extra JSON Params`
- `Translate Language`
- `Translate Chunk Size`
- `Translate Concurrency`
- `Translate Retry Count`
- `Translate Extra JSON Params`

`Summary Extra JSON Params` 会作为 JSON 对象直接合并进总结接口请求体，可用于 `{"enable_thinking": true}` 这类模型专属参数。`model` 和 `messages` 属于保留字段，不能在这里覆盖。

`Translate Extra JSON Params` 会作为 JSON 对象直接合并进翻译接口请求体，可用于 `{"enable_thinking": true}` 这类模型专属参数。`model` 和 `messages` 属于保留字段，不能在这里覆盖。

## 使用方法

1. 根据你要执行的功能，选中 PDF 附件、包含 PDF 的父条目，或已经完成解析的条目。
2. 在 Zotero 中右键该条目。
3. 打开 `MinerU` 子菜单。
4. 选择以下功能之一：
   - `使用 MinerU 解析 PDF 并保存为 Markdown`
   - `使用 AI 总结文献`
   - `使用 AI 翻译文献`

## 行为说明

- 解析后的 Markdown 附件会打上 `#MinerU-Parse` 标签。
- 已完成解析的父条目会打上 `#MinerU-Parsed` 标签。
- AI 总结会保存为子笔记，并打上 `#MinerU-Summary` 标签。
- AI 翻译会保存为 Markdown 附件，并打上 `#MinerU-Translation` 标签。
- 翻译附件中的图片链接会改写为指向原解析附件，因此如果原解析附件被删除，翻译附件中的图片也会失效。

## 开发

打包插件：

```bash
bash build-xpi.sh
```

输出文件名：

```text
zotero-mineru-<version>.xpi
```

## 许可证

MIT。见 [LICENSE](LICENSE)。
