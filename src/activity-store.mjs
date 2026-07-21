import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataRoot } from "./boundary.mjs";

const activityPath = path.join(dataRoot, "recent-activity.json");
let writeQueue = Promise.resolve();

async function readActivity() {
  try {
    return JSON.parse(await readFile(activityPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return { version: 1, files: {} };
    throw error;
  }
}

async function writeActivity(activity) {
  await mkdir(path.dirname(activityPath), { recursive: true });
  const temporaryPath = `${activityPath}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(activity, null, 2), "utf8");
  await rename(temporaryPath, activityPath);
}

export async function mergeRecentActivity(files) {
  const activity = await readActivity();
  return files.map((file) => ({ ...file, lastOpenedAt: activity.files[file.relativePath]?.lastOpenedAt || null }));
}

export function recordOpened(relativePath) {
  writeQueue = writeQueue.then(async () => {
    const activity = await readActivity();
    activity.files[relativePath] = { ...activity.files[relativePath], lastOpenedAt: Date.now() };
    await writeActivity(activity);
  });
  return writeQueue;
}

export function moveRecentActivity(oldPath, newPath, isDirectory = false) {
  writeQueue = writeQueue.then(async () => {
    const activity = await readActivity();
    let changed = false;
    for (const key of Object.keys(activity.files)) {
      const matches = key === oldPath || (isDirectory && key.startsWith(`${oldPath}\\`));
      if (!matches) continue;
      activity.files[`${newPath}${key.slice(oldPath.length)}`] = activity.files[key];
      delete activity.files[key];
      changed = true;
    }
    if (changed) await writeActivity(activity);
  });
  return writeQueue;
}
