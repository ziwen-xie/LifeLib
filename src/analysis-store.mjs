import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataRoot } from "./boundary.mjs";
import { closestCategory, normalizeCategoryRange } from "./taxonomy.mjs";

const storePath = path.join(dataRoot, "analysis-index.json");
let writeQueue = Promise.resolve();

async function readStore() {
  try {
    return JSON.parse(await readFile(storePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return { version: 1, files: {} };
    throw error;
  }
}

export async function mergeSavedAnalysis(files) {
  const store = await readStore();
  return files.map((file) => {
    const saved = store.files[file.relativePath];
    if (!saved || !saved.category || saved.category.toLowerCase() === "uncategorized") return file;
    return {
      ...file,
      category: saved.category,
      subcategory: saved.subcategory || "",
      summary: saved.summary || file.summary,
      confidence: saved.confidence ?? file.confidence,
      evidence: saved.evidence || file.evidence,
      tags: saved.tags || [],
      visual: saved.visual || null,
      aiPersisted: true,
      analyzedAt: saved.analyzedAt,
      analysisModel: saved.model,
      analysisProvider: saved.provider,
    };
  });
}

export function saveAnalysis(relativePath, fileStats, analysis) {
  writeQueue = writeQueue.then(async () => {
    const store = await readStore();
    const previousVisual = store.files[relativePath]?.visual || null;
    store.files[relativePath] = {
      category: analysis.category,
      subcategory: analysis.subcategory || "",
      summary: analysis.summary,
      confidence: analysis.confidence,
      evidence: analysis.evidence,
      tags: analysis.tags,
      visual: analysis.visual || previousVisual,
      model: analysis.model,
      provider: analysis.provider,
      analyzedAt: new Date().toISOString(),
      bytes: fileStats.size,
      modifiedMs: fileStats.mtimeMs,
    };
    await mkdir(path.dirname(storePath), { recursive: true });
    const temporaryPath = `${storePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(store, null, 2), "utf8");
    await rename(temporaryPath, storePath);
  });
  return writeQueue;
}

export function saveVisualSpec(relativePath, visual) {
  writeQueue = writeQueue.then(async () => {
    const store = await readStore();
    if (!store.files[relativePath]) throw new Error("Analyze this file before creating its visual");
    store.files[relativePath].visual = visual;
    store.files[relativePath].visualizedAt = new Date().toISOString();
    await mkdir(path.dirname(storePath), { recursive: true });
    const temporaryPath = `${storePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(store, null, 2), "utf8");
    await rename(temporaryPath, storePath);
  });
  return writeQueue;
}

export async function getSavedAnalysis(relativePath) {
  const store = await readStore();
  return store.files[relativePath] || null;
}

export async function getSavedCategories() {
  const store = await readStore();
  return [...new Set(Object.values(store.files).map((item) => item.category).filter(Boolean))].sort();
}

export function rebalanceSavedCategories(maximum) {
  writeQueue = writeQueue.then(async () => {
    const { max } = normalizeCategoryRange(2, maximum);
    const store = await readStore();
    const groups = new Map();
    for (const [relativePath, item] of Object.entries(store.files)) {
      if (!item.category || item.category.toLowerCase() === "uncategorized") continue;
      if (!groups.has(item.category)) groups.set(item.category, []);
      groups.get(item.category).push(relativePath);
    }
    let changed = false;
    while (groups.size > max) {
      const [source, sourcePaths] = [...groups.entries()].sort((a, b) => a[1].length - b[1].length || a[0].localeCompare(b[0]))[0];
      const sizes = new Map([...groups].map(([category, paths]) => [category, paths.length]));
      const target = closestCategory(source, [...groups.keys()].filter((category) => category !== source), sizes);
      const targetPaths = groups.get(target);
      for (const relativePath of sourcePaths) {
        const item = store.files[relativePath];
        item.subcategory ||= source;
        item.category = target;
        targetPaths.push(relativePath);
      }
      groups.delete(source);
      changed = true;
    }
    if (!changed) return false;
    await mkdir(path.dirname(storePath), { recursive: true });
    const temporaryPath = `${storePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(store, null, 2), "utf8");
    await rename(temporaryPath, storePath);
    return true;
  });
  return writeQueue;
}

export function moveSavedAnalysis(oldPath, newPath, isDirectory = false) {
  writeQueue = writeQueue.then(async () => {
    const store = await readStore();
    let changed = false;
    for (const key of Object.keys(store.files)) {
      const matches = key === oldPath || (isDirectory && key.startsWith(`${oldPath}\\`));
      if (!matches) continue;
      const suffix = key.slice(oldPath.length);
      store.files[`${newPath}${suffix}`] = store.files[key];
      delete store.files[key];
      changed = true;
    }
    if (!changed) return;
    await mkdir(path.dirname(storePath), { recursive: true });
    const temporaryPath = `${storePath}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(store, null, 2), "utf8");
    await rename(temporaryPath, storePath);
  });
  return writeQueue;
}
