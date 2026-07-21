import test from "node:test";
import assert from "node:assert/strict";
import { closestCategory, normalizeCategoryRange } from "../src/taxonomy.mjs";

test("category ranges remain ordered and bounded", () => {
  assert.deepEqual(normalizeCategoryRange(10, 15), { min: 10, max: 15 });
  assert.deepEqual(normalizeCategoryRange(20, 5), { min: 5, max: 5 });
});

test("specific categories merge into semantically related top-level categories", () => {
  assert.equal(closestCategory("Personal Photos", ["Finance", "Image", "Software Installer"]), "Image");
  assert.equal(closestCategory("Legal Contract", ["Travel", "Legal Documents", "Video"]), "Legal Documents");
});
