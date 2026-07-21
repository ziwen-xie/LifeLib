import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { assertInside, inboxRoot, libraryRoot } from "./boundary.mjs";

const textExtensions = new Set([".txt", ".md", ".json", ".csv"]);
const supportedExtensions = new Set([
  ...textExtensions,
  ".pdf",
  ".docx",
  ".png",
  ".jpg",
  ".jpeg",
  ".xlsx",
  ".pptx",
  ".mp4",
  ".zip",
  ".exe",
]);

function summarize(text, maxLength = 180) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "No readable text found.";
  const sentence = normalized.match(/^.*?[.!?](?:\s|$)/)?.[0] ?? normalized;
  return sentence.length <= maxLength
    ? sentence.trim()
    : `${sentence.slice(0, maxLength - 1).trimEnd()}…`;
}

function decodeText(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString("utf16le");
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2));
    swapped.swap16();
    return swapped.toString("utf16le");
  }
  return buffer.toString("utf8");
}

function categorize(filename, text) {
  const haystack = `${filename} ${text}`.toLowerCase();
  const rules = [
    ["Finance", ["invoice", "receipt", "payment", "budget"]],
    ["Work", ["meeting", "project", "client", "proposal"]],
    ["Legal", ["contract", "agreement", "terms", "confidential"]],
    ["Learning", ["research", "study", "course", "tutorial"]],
    ["Personal", ["personal", "family", "travel", "medical"]],
  ];

  for (const [category, keywords] of rules) {
    const matches = keywords.filter((keyword) => haystack.includes(keyword));
    if (matches.length) {
      return { category, confidence: Math.min(0.55 + matches.length * 0.12, 0.91), evidence: matches };
    }
  }
  return { category: "Uncategorized", confidence: 0.2, evidence: [] };
}

async function scanRoot(root) {
  const safeRoot = await assertInside(root, root);
  const results = [];

  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      const stats = await lstat(candidate);
      if (stats.isSymbolicLink()) continue;
      await assertInside(candidate, safeRoot);
      if (entry.isDirectory()) {
        await walk(candidate);
        continue;
      }
      if (!entry.isFile() || entry.name === ".gitkeep") continue;

      const extension = path.extname(entry.name).toLowerCase();
      if (!supportedExtensions.has(extension)) continue;
      const text = textExtensions.has(extension)
        ? decodeText(await readFile(candidate))
        : "";
      const classification = categorize(entry.name, text);
      results.push({
        name: entry.name,
        relativePath: path.relative(safeRoot, candidate),
        extension,
        bytes: stats.size,
        modifiedMs: stats.mtimeMs,
        createdMs: stats.birthtimeMs,
        summary: textExtensions.has(extension)
          ? summarize(text)
          : "Text extraction will be added in the next milestone.",
        ...classification,
      });
    }
  }

  await walk(safeRoot);
  return results;
}

export const scanInbox = () => scanRoot(inboxRoot);
export const scanFiles = () => scanRoot(libraryRoot);
