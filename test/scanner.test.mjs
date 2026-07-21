import assert from "node:assert/strict";
import { test } from "node:test";
import { scanInbox } from "../src/scanner.mjs";

test("scanner summarizes and categorizes the safe inbox fixture", async () => {
  const results = await scanInbox();
  const result = results.find(({ name }) => name === "sample-invoice.txt");
  assert.ok(result);
  assert.equal(result.category, "Finance");
  assert.match(result.summary, /^Invoice for the project\./);
});
