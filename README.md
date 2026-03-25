# Zotero MinerU Parser

[中文说明](README.zh-CN.md)

A Zotero 8 plugin that sends PDF attachments to the MinerU API, saves parsed results back to Zotero as Markdown attachments, and supports AI summary and AI translation workflows.

## Features

- Parse selected PDF attachments with MinerU using `pipeline` or `vlm`.
- Save parse results as Markdown attachments instead of Zotero notes.
- Preserve extracted images under the parsed attachment's `images/` directory.
- Generate AI summaries from parsed Markdown attachments.
- Generate AI translations from parsed Markdown attachments.
- Translate long documents with chunking, bounded concurrency, automatic retry, and retry-failed-chunks confirmation.
- Store translated Markdown with image links rewritten to the source parsed attachment's storage path to avoid duplicating image files.
- Expose all three actions under a single `MinerU` context submenu.

## Requirements

- Zotero `8.0+`
- A valid MinerU API token
- Optional LLM API credentials for summary and translation features

## Install

1. Download the latest `.xpi` from GitHub Releases.
2. In Zotero, open `Tools -> Plugins`.
3. Click the gear icon and choose `Install Plugin From File...`.
4. Select the downloaded `.xpi`.
5. Restart Zotero if prompted.

## Configure

Open `Edit -> Preferences -> MinerU` and configure the following as needed:

### MinerU

- `API Base URL`
- `API Token`
- `Model Version`
- `Poll Interval`
- `Timeout`
- `Note Title Prefix`

### LLM

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

`Summary Extra JSON Params` is merged directly into the summary request body as a JSON object. Use it for model-specific flags such as `{"enable_thinking": true}`. `model` and `messages` are reserved and cannot be overridden there.

`Translate Extra JSON Params` is merged directly into the translation request body as a JSON object. Use it for model-specific flags such as `{"enable_thinking": true}`. `model` and `messages` are reserved and cannot be overridden there.

## Usage

1. Select a PDF attachment, a parent item containing PDFs, or a parsed item depending on the action you want.
2. Right-click the item in Zotero.
3. Open the `MinerU` submenu.
4. Choose one of the following:
   - `Parse PDF with MinerU and Save as Markdown`
   - `Summarize with AI`
   - `Translate with AI`

## Behavior Notes

- Parsed Markdown attachments are tagged with `#MinerU-Parse`.
- Parent items that have already been parsed are tagged with `#MinerU-Parsed`.
- AI summaries are stored as child notes with the `#MinerU-Summary` tag.
- AI translations are stored as Markdown attachments with the `#MinerU-Translation` tag.
- Translation image links are rewritten to point to the source parsed attachment, so translated attachments depend on the original parsed attachment remaining present.

## Development

Build the plugin package:

```bash
bash build-xpi.sh
```

Output file:

```text
zotero-mineru-<version>.xpi
```

## License

MIT. See [LICENSE](LICENSE).
