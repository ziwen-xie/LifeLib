import { readFile } from "node:fs/promises";
import { OfficeParser } from "officeparser";

const plainTextTypes = new Set([".txt", ".md", ".json", ".csv"]);
const officeTypes = new Set([".pdf", ".docx", ".pptx"]);
const extractionCache = new Map();

function decodeText(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString("utf16le");
  return buffer.toString("utf8");
}

function boundedOverview(text, maxCharacters = 18000) {
  const cleaned = text.replace(/\u0000/g, "").replace(/\n{4,}/g, "\n\n").trim();
  if (cleaned.length <= maxCharacters) return cleaned;
  const marker = cleaned.search(/table of contents|contents|overview|executive summary|abstract/i);
  const beginning = cleaned.slice(0, 8500);
  const overview = marker >= 0 ? cleaned.slice(marker, marker + 6500) : cleaned.slice(Math.floor(cleaned.length / 2), Math.floor(cleaned.length / 2) + 4500);
  const ending = cleaned.slice(-2500);
  return `${beginning}\n\n[Selected overview section]\n${overview}\n\n[Selected ending]\n${ending}`.slice(0, maxCharacters);
}

export async function extractForAnalysis(filePath, extension) {
  if (extractionCache.has(filePath)) return extractionCache.get(filePath);
  if (plainTextTypes.has(extension)) return boundedOverview(decodeText(await readFile(filePath)));
  if (!officeTypes.has(extension)) return "";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const ast = await OfficeParser.parseOffice(filePath, {
      abortSignal: controller.signal,
      extractAttachments: false,
      ignoreComments: true,
      ignoreNotes: true,
      ignoreHeadersAndFooters: true,
      ignoreSlideMasters: true,
      decompressionLimits: { maxUncompressedBytes: 128 * 1024 * 1024, maxZipEntries: 5000 },
    });
    const result = boundedOverview(ast.toText());
    extractionCache.set(filePath, result);
    return result;
  } finally {
    clearTimeout(timeout);
  }
}
