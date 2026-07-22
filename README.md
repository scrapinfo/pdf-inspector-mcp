# PDF Inspector MCP Server

A lightweight, zero-configuration TypeScript MCP server that inspects local PDF files using standard, widely-adopted libraries.

## Features

- **`extract_text`** — Extracts raw embedded text from PDFs using [`pdf-parse`](https://www.npmjs.com/package/pdf-parse).
- **`count_pages`** — Returns the total number of pages in a PDF.
- **`ocr_pdf`** — Renders PDF pages to images and performs OCR with [`tesseract.js`](https://www.npmjs.com/package/tesseract.js) for image-based (scanned) PDFs.

## Dependencies

| Package | Purpose |
|---|---|
| `@modelcontextprotocol/sdk` | Official MCP TypeScript SDK |
| `pdf-parse` | Zero-config text extraction and page counting |
| `pdfjs-dist` | PDF rendering engine (standard Mozilla library) |
| `canvas` | Canvas implementation for Node.js rendering |
| `tesseract.js` | Pure-JavaScript OCR (lightweight, no binary installs) |
| `zod` | Schema validation for tool parameters |

All dependencies install with a standard `npm install` and require no external binary setup beyond what `npm` provides.

## Quick Start

```bash
npm install
npm run build
npm start
```

Or run directly with `tsx` during development:

```bash
npm run dev
```

## Running with an MCP Client

The server communicates over `stdio`, the standard MCP transport. Use it with Claude Code, VS Code, Cursor, or any host that launches `node dist/index.js`.

Example `claude_desktop_config.json` snippet:

```json
{
  "mcpServers": {
    "pdf-inspector": {
      "command": "node",
      "args": ["/absolute/path/to/pdf-inspector-mcp/dist/index.js"]
    }
  }
}
```

## Tools

### `extract_text`

| Parameter | Type | Default | Description |
|---|---|---|---|
| `filePath` | `string` | — | Path to PDF |
| `maxLength` | `number` | `10000` | Max characters to return |

### `count_pages`

| Parameter | Type | Default | Description |
|---|---|---|---|
| `filePath` | `string` | — | Path to PDF |

### `ocr_pdf`

| Parameter | Type | Default | Description |
|---|---|---|---|
| `filePath` | `string` | — | Path to PDF |
| `pages` | `number[]` | `[]` | 1-based page numbers (empty = all) |
| `language` | `string` | `"eng"` | Tesseract language code |
| `scale` | `number` | `2.0` | Render scale (higher = sharper, slower) |

> **Note:** `ocr_pdf` uses `pdfjs-dist` to render each page to an image, then passes the PNG to `tesseract.js`. For multi-page PDFs this can take several seconds per page.

## Zero-Config Design

- No `.env` files or external services required.
- `pdf-parse` handles text extraction with no setup.
- `tesseract.js` bundles WASM and language data automatically.
- `pdfjs-dist` uses the bundled `pdf.worker.mjs` file.
- `canvas` relies on standard `npm` prebuilds.
