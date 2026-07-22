#!/usr/bin/env node
/**
 * PDF Inspector MCP Server
 * A zero-config TypeScript MCP server that inspects local PDF files.
 * Provides three standard tools: raw text extraction, page counting,
 * and image-based PDF OCR using a lightweight OCR module.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import fs from "node:fs";
import path from "node:path";
import { PDFParse, TextResult, InfoResult } from "pdf-parse";
import { createCanvas } from "canvas";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createWorker } from "tesseract.js";

// Configure pdfjs-dist worker so it can render pages in Node.
// We point to the bundled worker module that ships with pdfjs-dist.
const workerSrc = path.resolve(
  import.meta.dirname ?? ".",
  "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"
);

// Point pdfjs-dist to its standard fonts and CMaps so it never hits the
// network or throws "standardFontDataUrl" errors.
const standardFontsDir = path.resolve(
  import.meta.dirname ?? ".",
  "node_modules/pdfjs-dist/standard_fonts/"
);
const cMapsDir = path.resolve(
  import.meta.dirname ?? ".",
  "node_modules/pdfjs-dist/cmaps/"
);

const pdfjsConfig = {
  standardFontDataUrl: `file://${standardFontsDir}/`,
  cMapUrl: `file://${cMapsDir}/`,
  cMapPacked: true,
};

try {
  GlobalWorkerOptions.workerSrc = workerSrc;
} catch {
  // Some builds ignore this; rendering still works without a worker,
  // just more slowly.
}

/** Helper: read a local file as Uint8Array for pdfjs-dist. */
function readPdfBuffer(filePath: string): Uint8Array {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const stats = fs.statSync(filePath);
  if (!stats.isFile()) {
    throw new Error(`Path is not a file: ${filePath}`);
  }
  return new Uint8Array(fs.readFileSync(filePath));
}

/** Helper: clean extracted PDF text (normalize whitespace, trim, etc.). */
function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]*\n[ \t]*\n+/g, "\n\n")
    .trim();
}

/** Helper: detect whether a PDF appears to be image-based (scanned). */
async function isImageBasedPdf(filePath: string): Promise<boolean> {
  const buffer = readPdfBuffer(filePath);
  const parser = new PDFParse({ data: buffer, ...pdfjsConfig });
  const info = await parser.getInfo();
  const textResult = await parser.getText();
  // Image-based / scanned PDFs typically have very little extractable text.
  const rawText = textResult?.text?.trim() ?? "";
  return rawText.length < 50;
}

// ------------------------------------------------------------------
// Server
// ------------------------------------------------------------------

const server = new McpServer(
  {
    name: "pdf-inspector",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ------------------------------------------------------------------
// Tool: extract_text
// ------------------------------------------------------------------

server.tool(
  "extract_text",
  "Extract raw text from a local PDF file using pdf-parse.",
  {
    filePath: z
      .string()
      .describe("Absolute or relative path to the PDF file."),
    maxLength: z
      .number()
      .optional()
      .default(10000)
      .describe("Maximum number of characters to return (default 10000)."),
    cleanText: z
      .boolean()
      .optional()
      .default(true)
      .describe("If true, normalize whitespace and trim the extracted text (default true)."),
  },
  async ({ filePath, maxLength, cleanText }) => {
    try {
      const buffer = readPdfBuffer(filePath);
      const parser = new PDFParse({ data: buffer, ...pdfjsConfig });
      const info = await parser.getInfo();
      const textResult = await parser.getText();

      let fullText = textResult.text ?? "";
      if (cleanText) {
        fullText = normalizeText(fullText);
      }
      const truncated = fullText.slice(0, maxLength);
      const wasTruncated = fullText.length > maxLength;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                filePath: path.resolve(filePath),
                pageCount: info.total ?? 0,
                textLength: fullText.length,
                truncated,
                wasTruncated,
                preview: truncated.slice(0, 500),
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: `Error extracting text from PDF: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ------------------------------------------------------------------
// Tool: count_pages
// ------------------------------------------------------------------

server.tool(
  "count_pages",
  "Count the total number of pages in a local PDF file.",
  {
    filePath: z
      .string()
      .describe("Absolute or relative path to the PDF file."),
  },
  async ({ filePath }) => {
    try {
      const buffer = readPdfBuffer(filePath);
      const parser = new PDFParse({ data: buffer, ...pdfjsConfig });
      const info = await parser.getInfo();
      const pages = info.total ?? 0;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                filePath: path.resolve(filePath),
                pageCount: pages,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: `Error counting pages: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ------------------------------------------------------------------
// Tool: ocr_pdf
// ------------------------------------------------------------------

server.tool(
  "ocr_pdf",
  "Extract text from image-based (scanned) PDFs using pdfjs-dist rendering + tesseract.js OCR. Best for PDFs with little or no embedded text layer.",
  {
    filePath: z
      .string()
      .describe("Absolute or relative path to the PDF file."),
    pages: z
      .array(z.number().int().min(1))
      .optional()
      .default([])
      .describe(
        "Specific 1-based page numbers to OCR. Empty array means all pages."
      ),
    language: z
      .string()
      .optional()
      .default("eng")
      .describe("Tesseract language code (default 'eng')."),
    scale: z
      .number()
      .optional()
      .default(2.0)
      .describe(
        "Render scale for OCR accuracy (default 2.0). Higher = sharper but slower."
      ),
  },
  async ({ filePath, pages, language, scale }) => {
    try {
      const buffer = readPdfBuffer(filePath);
      const pdfDoc = await getDocument({ data: buffer, ...pdfjsConfig }).promise;
      const totalPages = pdfDoc.numPages;

      // Determine which pages to process.
      const pageIndexes =
        pages.length > 0
          ? pages.filter((p) => p >= 1 && p <= totalPages)
          : Array.from({ length: totalPages }, (_, i) => i + 1);

      if (pageIndexes.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No valid pages found for file: ${path.resolve(filePath)}`,
            },
          ],
          isError: true,
        };
      }

      // Initialize Tesseract worker once for the batch.
      const worker = await createWorker(language);

      const results: { page: number; text: string }[] = [];
      const errors: { page: number; error: string }[] = [];

      for (const pageNum of pageIndexes) {
        try {
          const page = await pdfDoc.getPage(pageNum);
          const viewport = page.getViewport({ scale });

          const canvas = createCanvas(viewport.width, viewport.height);
          const ctx = canvas.getContext("2d") as any;

          // For pdfjs-dist rendering we pass the canvas object directly.
          await page.render({ canvas: canvas as any, viewport }).promise;

          // Convert rendered canvas to PNG buffer for OCR.
          const pngBuffer = canvas.toBuffer("image/png");

          // Run OCR.
          const result = await worker.recognize(pngBuffer);
          let text = result.data.text?.trim() ?? "";
          text = normalizeText(text);

          results.push({ page: pageNum, text });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push({ page: pageNum, error: msg });
        }
      }

      await worker.terminate();

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                filePath: path.resolve(filePath),
                totalPages,
                processedPages: pageIndexes,
                ocrResults: results,
                errors: errors.length > 0 ? errors : undefined,
                summary: results.map((r) => `Page ${r.page}: ${r.text.slice(0, 200)}${r.text.length > 200 ? "..." : ""}`).join("\n\n"),
                pageCountProcessed: results.length,
                pageCountErrors: errors.length,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: "text",
            text: `Error performing OCR on PDF: ${message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

// ------------------------------------------------------------------
// Startup
// ------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Silent startup so we don't pollute stdio (used by MCP protocol).
}

main().catch((err) => {
  console.error("PDF Inspector MCP Server fatal error:", err);
  process.exit(1);
});
