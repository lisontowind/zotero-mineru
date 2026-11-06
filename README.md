# Zotero MinerU Parser

[中文说明](README.zh-CN.md)

A Zotero 8/9/10 plugin that sends PDF attachments to the MinerU API, saves parsed results back to Zotero as Markdown or HTML attachments, and supports AI summary and AI translation workflows.

## Features

- Parse selected PDF attachments with MinerU using `pipeline` or `vlm`.
- Use Chinese or English preferences and main workflow messages based on the Zotero UI language. Summary and translation languages include Vietnamese.
- Parsing always saves Markdown with an `images/` folder. Optional HTML (off by default) becomes the main attachment, keeping Markdown alongside it. HTML can share the images folder or embed images.
- Preserve extracted images under the parsed attachment's `images/` directory.
- Generate AI summaries from parsed Markdown or HTML attachments.
- Summarize the full source: documents over 60,000 characters are summarized in parts and then synthesized. This uses additional model requests and may increase cost; only a successful final summary is saved.
- Generate AI translations from parsed Markdown or HTML attachments.
- Image references stay local during translation. Text fragments around images are batched within each chunk, then images are restored in their original positions. Fragment count mismatches trigger retries; image markers are never sent to the model.
- Translate long documents with chunking, bounded concurrency, automatic retry, and retry-failed-chunks confirmation.
- Translation retries use exponential backoff and consider Retry-After. Permanent errors such as invalid credentials are not automatically retried. Summary and translation reject responses explicitly reported as truncated or incomplete.
- Accept JSON or gateway SSE replies, including BOM and outer JSON code fences. Interrupted or malformed streams and native response truncation signals are rejected. Code blocks inside JSON translation fragments are preserved.
- Save translations as Markdown (default, with an images folder) or standalone HTML (embedded images). The model only translates Markdown; HTML is rendered locally. HTML supports bilingual columns. Markdown contains only the translation, while the bilingual preference is retained.
- After failures, retry failed chunks, save completed translations, or discard. Partial output displays completion counts and preserves untranslated source text with a label (bilingual HTML labels the translation column). Partial attachments use `#MinerU-Translation-Partial` and do not block another translation. Cross-task resume is not supported.
- Existing files remain unchanged; Markdown attachments from released v0.1.58 remain supported.
- HTML formulas render offline to MathML using bundled KaTeX, including inline, display and bilingual output. Regenerate existing HTML to apply this. Invalid formulas remain visible with an error indicator.
- Customize the AI summary Prompt in LLM settings; {{language}} uses the selected language. Clear and save to restore the default.
- Expose all four actions under a single `MinerU` context submenu.
- Skip overlapping parse, note, summary and translation tasks across windows, including queued entries in a batch. Failed tasks and cancelled note conversions can be started again after the batch finishes.
- Validate all settings before saving; highlight invalid fields and stop connectivity tests until they are corrected.
- Filter unsafe links and active table content in the built-in HTML renderer; keep local image references within the attachment directory.

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

- Saved parse attachments/notes and their literature parent receive `#MinerU-Parse`; the parent also retains `#MinerU-Parsed`.
- AI summaries are stored as child notes; both the note and its literature parent receive `#MinerU-Summary`.
- AI translations use the selected Markdown or HTML format; both the attachment and its literature parent receive `#MinerU-Translation` for complete results or `#MinerU-Translation-Partial` for partial results.
- Parent tags are added after the result is saved successfully. Existing results are not automatically backfilled. Duplicate detection still checks child attachments/notes, so removing a child result allows regeneration.
- Markdown translations have their own images folder; HTML translations embed images. Neither depends on the source attachment's image files.
- The MinerU timeout covers each request, including its response body, and the total polling period. Summary and translation requests use 120 and 180 seconds respectively. Timeouts abort the local request; a task already accepted remotely may still run or incur charges.
- Result downloads only send the API token to the configured API's HTTPS origin, and authenticated downloads reject redirects. Third-party result URLs are downloaded anonymously.

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

### Source PDF relationships

Parsing creates bidirectional Related Item links between each source PDF and its generated Markdown or HTML main attachment by default, including after upgrades. Disable this in parsing settings to stop new links. Existing links remain; historical results are not matched. Renaming and reparenting within the same library preserve links. Summaries, translations and converted notes are excluded; cross-library copies and deleted/recreated items are not covered.
