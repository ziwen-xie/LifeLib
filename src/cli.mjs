import { scanFiles } from "./scanner.mjs";

const files = await scanFiles();
if (!files.length) {
  console.log("Inbox is empty. Add test files under data/inbox and run npm run scan.");
} else {
  console.table(files.map(({ name, category, confidence, summary }) => ({
    name,
    category,
    confidence: `${Math.round(confidence * 100)}%`,
    summary,
  })));
}
