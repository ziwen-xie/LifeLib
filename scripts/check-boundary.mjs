import { realpath } from "node:fs/promises";
import path from "node:path";

const expectedRoot = path.resolve(import.meta.dirname, "..");
const currentRoot = path.resolve(process.cwd());
const [realExpected, realCurrent] = await Promise.all([
  realpath(expectedRoot),
  realpath(currentRoot),
]);

if (realCurrent !== realExpected) {
  console.error(`Boundary check failed. Run commands from: ${realExpected}`);
  process.exit(1);
}

console.log(`Boundary check passed: ${realExpected}`);
