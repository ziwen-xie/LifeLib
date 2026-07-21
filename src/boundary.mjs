import path from "node:path";
import os from "node:os";
import { realpath } from "node:fs/promises";

export const workspaceRoot = path.resolve(import.meta.dirname, "..");
export const isPackagedRuntime = workspaceRoot.toLowerCase().includes("app.asar");
export const dataRoot = isPackagedRuntime
  ? path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "LifeLibrary")
  : path.join(workspaceRoot, "data");
export const inboxRoot = path.join(dataRoot, "inbox");
// Explicitly authorized by the user as the read-only real-world library.
export let libraryRoot = isPackagedRuntime
  ? path.join(os.homedir(), "Documents", "LifeLibrary Files")
  : path.resolve(workspaceRoot, "..", "Files");

export function setLibraryRoot(nextRoot) {
  if (!nextRoot || typeof nextRoot !== "string") throw new Error("Choose a valid vault folder");
  libraryRoot = path.resolve(nextRoot);
  return libraryRoot;
}

export async function assertInside(candidate, allowedRoot = inboxRoot) {
  const [realAllowed, realCandidate] = await Promise.all([
    realpath(allowedRoot),
    realpath(candidate),
  ]);
  const relative = path.relative(realAllowed, realCandidate);

  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    return realCandidate;
  }

  throw new Error(`Path escapes the allowed root: ${candidate}`);
}
