# Zotero MinerU Parser

A Zotero 8 plugin that sends PDF attachments to the MinerU API, then saves parsed results back to Zotero notes.

## Features

- Parse selected PDF attachments through MinerU (`pipeline` or `vlm` model).
- Create a new child note with parsed output.
- Convert inline math (`$...$`) and display math (`$$...$$`) into Zotero note math rendering.
- Convert HTML tables from parsed markdown into Zotero note table-compatible HTML.
- Keep embedded images from MinerU parsing results.

## Requirements

- Zotero `8.0+`
- A valid MinerU API token

## Install

1. Download the latest `.xpi` from GitHub Releases.
2. In Zotero: `Tools -> Plugins`.
3. Click the gear icon and choose `Install Plugin From File...`.
4. Select the downloaded `.xpi`, then restart Zotero if prompted.

## Configure

Open `Edit -> Preferences -> MinerU` and set:

- `API Base URL` (default: `https://mineru.net/api/v4`)
- `API Token`
- `Model Version` (`pipeline` recommended)
- Poll interval / timeout
- Note title prefix

## Usage

1. Select a PDF attachment (or a parent item containing PDFs).
2. Right-click and choose `使用 MinerU 解析 PDF 并保存为笔记`.
3. Wait for completion; the plugin creates a new note under the item.

## Development

Build package:

```bash
./build-xpi.sh
```

Output file format:

```text
zotero-mineru-<version>.xpi
```

## Updates

Auto-update metadata is stored in `updates.json`.
`manifest.json` points to:

```text
https://raw.githubusercontent.com/lisontowind/zotero-mineru/main/updates.json
```

When releasing a new version:

1. Update `manifest.json` version.
2. Build new `.xpi`.
3. Update `updates.json` version and `update_link`.
4. Create a GitHub release and upload the `.xpi` asset.

## License

MIT. See [LICENSE](LICENSE).
