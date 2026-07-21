import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanFiles } from "./scanner.mjs";

const port = Number(process.env.PORT || 4173);
const publicRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
    if (request.method === "GET" && url.pathname === "/api/files") {
      const files = await scanFiles();
      return sendJson(response, 200, { files, scannedAt: new Date().toISOString() });
    }

    if (request.method !== "GET") return sendJson(response, 405, { error: "Method not allowed" });
    const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const candidate = path.resolve(publicRoot, requested);
    const relative = path.relative(publicRoot, candidate);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return sendJson(response, 403, { error: "Forbidden" });

    const content = await readFile(candidate);
    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(candidate)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(content);
  } catch (error) {
    if (error?.code === "ENOENT") return sendJson(response, 404, { error: "Not found" });
    console.error(error);
    sendJson(response, 500, { error: "Unable to complete the request" });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`LifeLibrary is running at http://127.0.0.1:${port}`);
  console.log("Press Ctrl+C to stop.");
});
