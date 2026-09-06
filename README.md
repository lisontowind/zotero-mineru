# Zotero MinerU Parser

[中文说明](README.zh-CN.md)

A Zotero 8/9/10 plugin that sends PDF attachments to the MinerU API, saves parsed results back to Zotero as Markdown or HTML attachments, and supports AI summary and AI translation workflows.

## Features

- Parse selected PDF attachments with MinerU using `pipeline` or `vlm`.
- Parsing always saves Markdown with an `images/` folder. Optional HTML (off by default) becomes the main attachment, keeping Markdown alongside it. HTML can share the images folder or embed images.
- Preserve extracted images under the parsed attachment's `images/` directory.
- Generate AI summaries from parsed Markdown or HTML attachments.
- Generate AI translations from parsed Markdown or HTML attachments.
- Image references stay local during translation. Text fragments around images are batched within each chunk, then images are restored in their original positions. Fragment count mismatches trigger retries; image markers are never sent to the model.
- Translate long documents with chunking, bounded concurrency, automatic retry, and retry-failed-chunks confirmation.
- Save translations as Markdown (default, with an images folder) or standalone HTML (embedded images). The model only translates Markdown; HTML is rendered locally. HTML supports bilingual columns. Markdown contains only the translation, while the bilingual preference is retained.
- After failures, retry failed chunks, save completed translations, or discard. Partial output displays completion counts and preserves untranslated source text with a label (bilingual HTML labels the translation column). Partial attachments use `#MinerU-Translation-Partial` and do not block another translation. Cross-task resume is not supported.
- Existing files remain unchanged; Markdown attachments from released v0.1.58 remain supported.
- HTML formulas render offline to MathML using bundled KaTeX, including inline, display and bilingual output. Regenerate existing HTML to apply this. Invalid formulas remain visible with an error indicator.
- Customize the AI summary Prompt in LLM settings; {{language}} uses the selected language. Clear and save to restore the default.
- Expose all four actions under a single `MinerU` context submenu.

## Requirements

- Zotero `8.0` to `10.0.*`
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
   - `Parse PDF with MinerU and Save as Attachment`
   - `Summarize with AI`
   - `Translate with AI`

## Behavior Notes

- Parsed attachments are tagged with `#MinerU-Parse`.
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
