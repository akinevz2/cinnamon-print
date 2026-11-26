#!/usr/bin/env node
/**
 * serve.mjs — node livereload webserver for interactive composition work.
 * Serves project/ at http://localhost:8899 and pushes reload via SSE when
 * fragments, layout.json or the template change.
 */
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { watch } from "node:fs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PROJECT = path.join(ROOT, "project");
const RESOURCES = path.join(ROOT, "resources");
const PORT = process.env.PORT ?? 8899;

const clients = new Set();

const MIME = {
  ".html": "text/html", ".png": "image/png", ".pdf": "application/pdf",
  ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
  ".ttf": "font/ttf", ".otf": "font/otf", ".woff": "font/woff", ".woff2": "font/woff2",
};

const server = http.createServer(async (req, res) => {
  if (req.url === "/reload") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("retry: 1000\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = path.normalize(urlPath) === "/"
    ? path.join(PROJECT, "compose.html")
    : urlPath.startsWith("/resources/")
      ? path.join(RESOURCES, urlPath.slice("/resources/".length))
      : path.join(PROJECT, urlPath);
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error();
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

function broadcast() {
  for (const c of clients) c.write("data: reload\n\n");
}

for (const dir of [PROJECT, RESOURCES]) {
  watch(dir, { recursive: true }, (_e, f) => {
    if (!f || /\.(png|json|html|ttf|otf|css)$/i.test(f)) {
      console.log("changed:", f ?? "?", "-> reloading", clients.size, "client(s)");
      broadcast();
    }
  });
}

server.listen(PORT, () =>
  console.log(`imagework livereload on http://localhost:${PORT} (compose.html, fragments/, output/)`)
);
