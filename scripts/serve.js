import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
const root = resolve(process.argv.includes("--dist") ? "dist" : ".");
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".svg": "image/svg+xml",
};
const allowed = new Set(["index.html", "subtitle-editor.html", "converter.html", "video-editor.html", "image-video.html", "favicon.svg"]);
createServer(async (req, res) => {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end();
      return;
    }
    const relative =
      decodeURIComponent(new URL(req.url, "http://localhost").pathname).replace(/^\/+/, "") ||
      "index.html";
    if (
      !allowed.has(relative) &&
      !["css/", "js/", "vendor/"].some((prefix) => relative.startsWith(prefix))
    )
      throw Error("Not public");
    const path = resolve(root, relative);
    if (!path.startsWith(root + sep) || relative.split("/").includes(".."))
      throw Error("Invalid path");
    const data = await readFile(path);
    res.writeHead(200, {
      "Content-Type": types[extname(path)] || "text/plain",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}).listen(3000, "127.0.0.1", () => console.log("Local: http://localhost:3000/"));
