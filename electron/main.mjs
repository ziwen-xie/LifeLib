import { app, BrowserWindow, dialog, ipcMain, nativeImage, safeStorage, shell } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { appendFile, lstat, mkdir, readFile, readdir, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { scanFiles } from "../src/scanner.mjs";
import { assertInside, dataRoot, libraryRoot, setLibraryRoot } from "../src/boundary.mjs";
import { extractForAnalysis } from "../src/extractor.mjs";
import { getSavedAnalysis, getSavedCategories, mergeSavedAnalysis, moveSavedAnalysis, rebalanceSavedCategories, saveAnalysis, saveVisualSpec } from "../src/analysis-store.mjs";
import { closestCategory, normalizeCategoryRange } from "../src/taxonomy.mjs";
import { mergeRecentActivity, moveRecentActivity, recordOpened } from "../src/activity-store.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const analysisCache = new Map();
const thumbnailCache = new Map();
const settingsPath = path.join(dataRoot, "settings.json");
const defaultSettings = { provider: "lmstudio", localEndpoint: "http://127.0.0.1:1234/v1", localModel: "google/gemma-4-e4b", openaiModel: "gpt-5.6-luna", theme: "purple", categoryMin: 10, categoryMax: 15, libraryPath: libraryRoot };

async function loadSettings(includeSecret = false) {
  let stored = {};
  try { stored = JSON.parse(await readFile(settingsPath, "utf8")); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  const settings = { ...defaultSettings, ...stored, hasOpenAIKey: Boolean(stored.openaiKeyEncrypted) };
  if (includeSecret && stored.openaiKeyEncrypted) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure credential storage is unavailable");
    settings.openaiApiKey = safeStorage.decryptString(Buffer.from(stored.openaiKeyEncrypted, "base64"));
  }
  delete settings.openaiKeyEncrypted;
  return settings;
}

async function saveSettings(input) {
  const current = await loadSettings(false);
  let encrypted = undefined;
  try { encrypted = JSON.parse(await readFile(settingsPath, "utf8")).openaiKeyEncrypted; } catch {}
  if (typeof input.openaiApiKey === "string" && input.openaiApiKey.trim()) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure credential storage is unavailable");
    encrypted = safeStorage.encryptString(input.openaiApiKey.trim()).toString("base64");
  }
  const allowedThemes = new Set(["purple", "ocean", "forest", "sunset", "graphite"]);
  const categoryRange = normalizeCategoryRange(input.categoryMin ?? current.categoryMin, input.categoryMax ?? current.categoryMax);
  const nextLibraryPath = path.resolve(String(input.libraryPath || current.libraryPath || libraryRoot));
  const libraryStats = await lstat(nextLibraryPath);
  if (!libraryStats.isDirectory()) throw new Error("The selected vault must be a folder");
  const next = { provider: input.provider === "openai" ? "openai" : "lmstudio", localEndpoint: String(input.localEndpoint || current.localEndpoint).replace(/\/$/, ""), localModel: String(input.localModel || current.localModel), openaiModel: String(input.openaiModel || current.openaiModel), theme: allowedThemes.has(input.theme) ? input.theme : current.theme, categoryMin: categoryRange.min, categoryMax: categoryRange.max, libraryPath: nextLibraryPath, ...(encrypted ? { openaiKeyEncrypted: encrypted } : {}) };
  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, JSON.stringify(next, null, 2), "utf8");
  setLibraryRoot(nextLibraryPath);
  await rebalanceSavedCategories(next.categoryMax);
  return loadSettings(false);
}

ipcMain.handle("settings:get", () => loadSettings(false));
ipcMain.handle("settings:save", (_event, input) => saveSettings(input || {}));
ipcMain.handle("settings:choose-vault", async () => {
  const settings = await loadSettings(false);
  const result = await dialog.showOpenDialog({ title: "Choose your LifeLibrary vault", defaultPath: settings.libraryPath || libraryRoot, properties: ["openDirectory", "createDirectory"] });
  return result.canceled ? null : result.filePaths[0];
});
ipcMain.handle("settings:test", async (_event, input) => {
  const settings = { ...(await loadSettings(true)), ...(input || {}) };
  const openai = settings.provider === "openai";
  const endpoint = openai ? "https://api.openai.com/v1" : String(settings.localEndpoint || defaultSettings.localEndpoint).replace(/\/$/, "");
  const key = input?.openaiApiKey?.trim() || settings.openaiApiKey;
  if (openai && !key) throw new Error("Enter or save an OpenAI API key first");
  const response = await fetch(`${endpoint}/models`, { headers: openai ? { Authorization: `Bearer ${key}` } : {} });
  if (!response.ok) throw new Error(`${openai ? "OpenAI" : "LM Studio"} returned ${response.status}`);
  const result = await response.json();
  return { ok: true, models: (result.data || []).slice(0, 50).map((model) => model.id) };
});

function createWindow() {
  const indexPath = path.join(projectRoot, "public", "index.html");
  const indexUrl = pathToFileURL(indexPath).href;
  const window = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 760,
    minHeight: 600,
    backgroundColor: "#f6f5fa",
    title: "LifeLibrary",
    icon: path.join(projectRoot, "assets", "lifelibrary-icon.png"),
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(projectRoot, "electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== indexUrl) event.preventDefault();
  });
  void window.loadFile(indexPath);
}

ipcMain.handle("library:scan", async () => {
  const settings = await loadSettings(false);
  await rebalanceSavedCategories(settings.categoryMax);
  const files = await mergeSavedAnalysis(await scanFiles());
  return { files: await mergeRecentActivity(files), libraryRoot, scannedAt: new Date().toISOString() };
});

ipcMain.handle("library:preview", async (_event, relativePath) => {
  if (typeof relativePath !== "string" || !relativePath) throw new Error("Invalid file path");
  const candidate = path.resolve(libraryRoot, relativePath);
  const safePath = await assertInside(candidate, libraryRoot);
  const stats = await lstat(safePath);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("Preview is unavailable");

  const extension = path.extname(safePath).toLowerCase();
  const textTypes = new Set([".txt", ".md", ".json", ".csv"]);
  const imageTypes = new Map([[".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"]]);
  if (textTypes.has(extension)) {
    const buffer = await readFile(safePath);
    const previewBuffer = buffer.subarray(0, 262144);
    const content = previewBuffer[0] === 0xff && previewBuffer[1] === 0xfe
      ? previewBuffer.subarray(2).toString("utf16le")
      : previewBuffer.toString("utf8");
    return { kind: "text", content, truncated: buffer.length > 262144 };
  }
  if ([".pdf", ".docx", ".pptx"].includes(extension)) {
    const content = await extractForAnalysis(safePath, extension);
    return { kind: "text", content: content || "No readable text was found.", truncated: content.length >= 18000 };
  }
  if (imageTypes.has(extension) && stats.size <= 5 * 1024 * 1024) {
    const buffer = await readFile(safePath);
    return { kind: "image", content: `data:${imageTypes.get(extension)};base64,${buffer.toString("base64")}` };
  }
  return { kind: "unsupported", content: "Preview support for this file type is coming next." };
});

ipcMain.handle("library:thumbnail", async (_event, relativePath) => {
  const { safePath, stats } = await resolveLibraryEntry(relativePath);
  if (!stats.isFile()) throw new Error("Thumbnail is unavailable");
  const extension = path.extname(safePath).toLowerCase();
  if (![".png", ".jpg", ".jpeg"].includes(extension)) throw new Error("Thumbnail is unavailable");
  const cacheKey = `${safePath}:${stats.mtimeMs}:${stats.size}`;
  if (thumbnailCache.has(cacheKey)) return thumbnailCache.get(cacheKey);
  const image = await nativeImage.createThumbnailFromPath(safePath, { width: 180, height: 140 });
  if (image.isEmpty()) throw new Error("Thumbnail could not be created");
  const dataUrl = image.toDataURL();
  thumbnailCache.set(cacheKey, dataUrl);
  return dataUrl;
});

ipcMain.handle("library:open", async (_event, relativePath) => {
  if (typeof relativePath !== "string" || !relativePath) throw new Error("Invalid file path");
  const candidate = path.resolve(libraryRoot, relativePath);
  const safePath = await assertInside(candidate, libraryRoot);
  const stats = await lstat(safePath);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("File cannot be opened");
  const blocked = new Set([".exe", ".msi", ".bat", ".cmd", ".ps1", ".js", ".vbs", ".scr"]);
  if (blocked.has(path.extname(safePath).toLowerCase())) throw new Error("Executable files are blocked for safety");
  const error = await shell.openPath(safePath);
  if (error) throw new Error(error);
  await recordOpened(relativePath);
  return true;
});

async function resolveLibraryEntry(relativePath) {
  if (typeof relativePath !== "string" || !relativePath) throw new Error("Invalid path");
  const candidate = path.resolve(libraryRoot, relativePath);
  const safePath = await assertInside(candidate, libraryRoot);
  const stats = await lstat(safePath);
  if (stats.isSymbolicLink()) throw new Error("Linked entries are not supported");
  return { safePath, stats };
}

ipcMain.handle("library:reveal", async (_event, relativePath) => {
  const { safePath } = await resolveLibraryEntry(relativePath);
  shell.showItemInFolder(safePath);
  return true;
});

ipcMain.handle("library:rename", async (_event, relativePath, newName) => {
  const { safePath, stats } = await resolveLibraryEntry(relativePath);
  if (typeof newName !== "string" || !newName.trim() || newName !== path.basename(newName)) throw new Error("Enter a valid name without folder separators");
  const destination = path.join(path.dirname(safePath), newName.trim());
  await assertInside(path.dirname(destination), libraryRoot);
  await rename(safePath, destination);
  await moveSavedAnalysis(relativePath, path.relative(libraryRoot, destination), stats.isDirectory());
  await moveRecentActivity(relativePath, path.relative(libraryRoot, destination), stats.isDirectory());
  return true;
});

ipcMain.handle("library:delete", async (_event, relativePath) => {
  const { safePath, stats } = await resolveLibraryEntry(relativePath);
  if (stats.isDirectory() && (await readdir(safePath)).length > 0) throw new Error("Non-empty folders cannot be deleted");
  const quarantineRoot = path.join(projectRoot, "data", "quarantine");
  await mkdir(quarantineRoot, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destination = path.join(quarantineRoot, `${stamp}__${path.basename(safePath)}`);
  await rename(safePath, destination);
  await appendFile(path.join(quarantineRoot, "operations.jsonl"), `${JSON.stringify({ action: "quarantine", source: safePath, destination, at: new Date().toISOString() })}\n`, "utf8");
  return true;
});

async function readQuarantineJournal() {
  const quarantineRoot = path.join(projectRoot, "data", "quarantine");
  try {
    const lines = (await readFile(path.join(quarantineRoot, "operations.jsonl"), "utf8")).split(/\r?\n/).filter(Boolean);
    return lines.map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

ipcMain.handle("library:recycle-list", async () => {
  const quarantineRoot = path.join(projectRoot, "data", "quarantine");
  await mkdir(quarantineRoot, { recursive: true });
  const journal = await readQuarantineJournal();
  const entries = await readdir(quarantineRoot, { withFileTypes: true });
  return Promise.all(entries.filter((entry) => entry.name !== "operations.jsonl").map(async (entry) => {
    const quarantinedPath = path.join(quarantineRoot, entry.name);
    const stats = await lstat(quarantinedPath);
    const operation = [...journal].reverse().find((item) => item.destination === quarantinedPath);
    return { id: entry.name, name: entry.name.replace(/^\d{4}-\d{2}-\d{2}T[^_]+__/, ""), originalPath: operation?.source || "Unknown", deletedAt: operation?.at || stats.mtime.toISOString(), bytes: stats.size, isDirectory: stats.isDirectory() };
  }));
});

ipcMain.handle("library:recycle-restore", async (_event, id) => {
  if (typeof id !== "string" || id !== path.basename(id)) throw new Error("Invalid recycle item");
  const quarantineRoot = path.join(projectRoot, "data", "quarantine");
  const quarantinedPath = await assertInside(path.join(quarantineRoot, id), quarantineRoot);
  const journal = await readQuarantineJournal();
  const operation = [...journal].reverse().find((item) => item.destination === quarantinedPath);
  if (!operation?.source) throw new Error("Original location is unavailable");
  const destinationParent = path.dirname(operation.source);
  await assertInside(destinationParent, libraryRoot);
  try { await lstat(operation.source); throw new Error("An item already exists at the original location"); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  await rename(quarantinedPath, operation.source);
  await appendFile(path.join(quarantineRoot, "operations.jsonl"), `${JSON.stringify({ action: "restore", source: quarantinedPath, destination: operation.source, at: new Date().toISOString() })}\n`, "utf8");
  return true;
});

ipcMain.handle("library:recycle-purge", async (_event, id) => {
  if (typeof id !== "string" || id !== path.basename(id)) throw new Error("Invalid recycle item");
  const quarantineRoot = path.join(projectRoot, "data", "quarantine");
  const quarantinedPath = await assertInside(path.join(quarantineRoot, id), quarantineRoot);
  const stats = await lstat(quarantinedPath);
  if (stats.isDirectory()) await rmdir(quarantinedPath); else await unlink(quarantinedPath);
  await appendFile(path.join(quarantineRoot, "operations.jsonl"), `${JSON.stringify({ action: "purge", source: quarantinedPath, at: new Date().toISOString() })}\n`, "utf8");
  return true;
});

ipcMain.handle("library:analyze", async (_event, relativePath) => {
  const { safePath, stats } = await resolveLibraryEntry(relativePath);
  if (!stats.isFile()) throw new Error("Only files can be analyzed");
  const extension = path.extname(safePath).toLowerCase();
  const settings = await loadSettings(true);
  const isOpenAI = settings.provider === "openai";
  const model = isOpenAI ? settings.openaiModel : settings.localModel;
  const endpoint = isOpenAI ? "https://api.openai.com/v1" : settings.localEndpoint;
  if (isOpenAI && !settings.openaiApiKey) throw new Error("OpenAI is selected but no API key is saved");
  const existingCategories = await getSavedCategories();
  const cacheKey = `${safePath}:${stats.mtimeMs}:${stats.size}:${settings.provider}:${model}:${settings.categoryMin}-${settings.categoryMax}:${existingCategories.join("|")}`;
  if (analysisCache.has(cacheKey)) return { ...analysisCache.get(cacheKey), cached: true };
  let extractedText = await extractForAnalysis(safePath, extension);
  if (!extractedText) extractedText = "No content extractor is available for this format; use the filename, path, extension, and size only.";
  // Keep enough of large/tabular files to identify them without overflowing
  // smaller local-model context windows (Gemma commonly runs at 8K locally).
  if (!isOpenAI && extractedText.length > 1700) {
    extractedText = `${extractedText.slice(0, 1250)}\n\n[Compact local-model sample]\n${extractedText.slice(-450)}`;
  }
  const taxonomyRule = existingCategories.length >= settings.categoryMax
    ? `The library is at its ${settings.categoryMax}-category maximum. The top-level category MUST exactly match one of: ${existingCategories.join(", ")}. Put the more specific classification in subcategory.`
    : `The library targets ${settings.categoryMin}-${settings.categoryMax} top-level categories and currently has ${existingCategories.length}. Existing categories: ${existingCategories.join(", ") || "none"}. Reuse an existing category when it fits; create a distinct top-level category only when useful. Always provide a more specific subcategory.`;
  const prompt = `Analyze this local file using only the evidence below. Do not ask for an upload. ${taxonomyRule} Return only a JSON object with category (short top-level string), subcategory (short specific string), summary (1-2 sentences), tags (array of up to 6 strings), confidence (number from 0 to 1), and evidence (array of short strings).\n\nPath: ${relativePath}\nExtension: ${extension}\nSize: ${stats.size} bytes\nExtracted evidence:\n${extractedText}`;
  const response = await fetch(`${endpoint}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(isOpenAI ? { Authorization: `Bearer ${settings.openaiApiKey}` } : {}) },
    body: JSON.stringify({ model, messages: [{ role: "system", content: "You classify personal files. Output valid JSON only, with no markdown fences." }, { role: "user", content: prompt }], ...(isOpenAI ? { max_completion_tokens: 900 } : { temperature: 0.1, max_tokens: 1400 }) }),
  });
  if (!response.ok) {
    const failure = await response.text();
    let detail = failure;
    try { detail = JSON.parse(failure)?.error || failure; } catch {}
    throw new Error(`${isOpenAI ? "OpenAI" : "LM Studio"} returned ${response.status}: ${String(detail).slice(0, 350)}`);
  }
  const result = await response.json();
  const raw = result?.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error(`${isOpenAI ? "OpenAI" : "The local model"} returned an empty response`);
  const jsonText = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const analysis = JSON.parse(jsonText);
  let proposedCategory = String(analysis.category || "Uncategorized").trim();
  let proposedSubcategory = String(analysis.subcategory || "").trim();
  const previous = await getSavedAnalysis(relativePath);
  if (proposedCategory.toLowerCase() === "uncategorized" && previous?.category) {
    proposedCategory = previous.category;
    proposedSubcategory ||= previous.subcategory || "";
  }
  const canonicalExisting = existingCategories.find((category) => category.toLowerCase() === proposedCategory.toLowerCase());
  if (canonicalExisting) proposedCategory = canonicalExisting;
  if (existingCategories.length >= settings.categoryMax && !canonicalExisting && proposedCategory.toLowerCase() !== "uncategorized") {
    proposedSubcategory ||= proposedCategory;
    proposedCategory = closestCategory(proposedCategory, existingCategories);
  }
  const normalized = {
    category: proposedCategory,
    subcategory: proposedSubcategory,
    summary: String(analysis.summary || "No summary returned."),
    tags: Array.isArray(analysis.tags) ? analysis.tags.slice(0, 6).map(String) : [],
    evidence: Array.isArray(analysis.evidence) ? analysis.evidence.slice(0, 6).map(String) : [],
    confidence: Math.max(0, Math.min(1, Number(analysis.confidence) || 0)),
    model,
    provider: settings.provider,
  };
  analysisCache.set(cacheKey, normalized);
  if (normalized.category.toLowerCase() !== "uncategorized") await saveAnalysis(relativePath, stats, normalized);
  return { ...normalized, cached: false };
});

ipcMain.handle("library:visualize", async (_event, relativePath) => {
  const { safePath, stats } = await resolveLibraryEntry(relativePath);
  if (!stats.isFile()) throw new Error("Only files can be visualized");
  if ([".png", ".jpg", ".jpeg"].includes(path.extname(safePath).toLowerCase())) throw new Error("Images keep their original thumbnail");
  const saved = await getSavedAnalysis(relativePath);
  if (!saved?.summary) throw new Error("Analyze this file before creating its visual");
  const settings = await loadSettings(true);
  const isOpenAI = settings.provider === "openai";
  const model = isOpenAI ? settings.openaiModel : settings.localModel;
  const endpoint = isOpenAI ? "https://api.openai.com/v1" : settings.localEndpoint;
  if (isOpenAI && !settings.openaiApiKey) throw new Error("OpenAI is selected but no API key is saved");
  const allowedMotifs = ["flask", "line-chart", "bar-chart", "table", "formula", "microscope", "book", "contract", "calculator", "plane", "code", "calendar", "video", "data-grid", "presentation", "document"];
  const prompt = `Design a specific illustrated document thumbnail from this file metadata. The result will be rendered as a white paper card with a folded corner, like a rich editorial file icon. Select visual elements that directly communicate this particular document's subject, not merely its broad category. For a lab report, for example, choose a flask, line-chart, table, and formula. Return strict JSON with label (1-2 specific words), primaryMotif, secondaryMotifs (array of 1-3), and accent. Motifs must come from: ${allowedMotifs.join(", ")}. Accent must be teal, blue, purple, green, orange, or red.\n\nFile: ${relativePath}\nCategory: ${saved.category}\nSubcategory: ${saved.subcategory || ""}\nSummary: ${saved.summary}\nTags: ${(saved.tags || []).join(", ")}\nEvidence: ${(saved.evidence || []).slice(0, 4).join(" | ")}`;
  const response = await fetch(`${endpoint}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(isOpenAI ? { Authorization: `Bearer ${settings.openaiApiKey}` } : {}) },
    body: JSON.stringify({ model, messages: [{ role: "system", content: "You design semantic document illustrations. Output valid JSON only, with no markdown fences." }, { role: "user", content: prompt }], ...(isOpenAI ? { max_completion_tokens: 650 } : { temperature: 0.1, max_tokens: 900 }) }),
  });
  if (!response.ok) {
    const failure = await response.text();
    let detail = failure;
    try { detail = JSON.parse(failure)?.error || failure; } catch {}
    throw new Error(`${isOpenAI ? "OpenAI" : "LM Studio"} returned ${response.status}: ${String(detail).slice(0, 300)}`);
  }
  const result = await response.json();
  const raw = result?.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new Error("The model returned an empty visual description");
  const visualResult = JSON.parse(raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  const motifSet = new Set(allowedMotifs);
  const primaryMotif = motifSet.has(visualResult.primaryMotif) ? visualResult.primaryMotif : "document";
  const secondaryMotifs = (Array.isArray(visualResult.secondaryMotifs) ? visualResult.secondaryMotifs : []).filter((motif) => motifSet.has(motif) && motif !== primaryMotif).slice(0, 3);
  const allowedAccents = new Set(["teal", "blue", "purple", "green", "orange", "red"]);
  const visual = { label: String(visualResult.label || saved.subcategory || saved.category).replace(/[^\p{L}\p{N} &-]/gu, "").trim().slice(0, 20) || "Document", primaryMotif, secondaryMotifs, accent: allowedAccents.has(visualResult.accent) ? visualResult.accent : "teal", model, provider: settings.provider };
  await saveVisualSpec(relativePath, visual);
  return visual;
});

app.whenReady().then(async () => {
  const initialSettings = await loadSettings(false);
  if (initialSettings.libraryPath) setLibraryRoot(initialSettings.libraryPath);
  await Promise.all([mkdir(dataRoot, { recursive: true }), mkdir(libraryRoot, { recursive: true })]);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
