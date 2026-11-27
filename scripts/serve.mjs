#!/usr/bin/env node
/**
 * serve.mjs — node livereload webserver for interactive composition work.
 * Serves project/ at http://localhost:8899 and pushes reload via SSE when
 * fragments, layout.json or the template change.
 */
import http from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { watch } from "node:fs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PROJECT = path.join(ROOT, "project");
const RESOURCES = path.join(ROOT, "resources");
const OUTPUT = path.join(PROJECT, "output");
const PROGRESS_LOG = path.join(OUTPUT, "cloud-progress.log");
const PORT = process.env.PORT ?? 8899;

const clients = new Set();   // /reload (compose.html livereload)
const cloudClients = new Set(); // /cloud/events (cloud fill progress)

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

  if (req.url === "/cloud/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("retry: 1000\n\n");
    cloudClients.add(res);
    // Snapshot so a browser joining mid-build (or after it) is up to date:
    // replay the last log line, then the final artefact for the stem being
    // built (NOT every stray png in output/ from previous projects).
    const lines = await readProgressLog();
    const last = lines.at(-1);
    if (last) res.write(`data: ${JSON.stringify(last)}\n\n`);
    try {
      for (const f of await readdir(OUTPUT))
        if (/\.png$/i.test(f) && !/_\d+\.png$/.test(f) && cloudStem && f === `${cloudStem}.png`)
          res.write(`data: ${JSON.stringify({ artifact: f })}\n\n`);
    } catch {}
    req.on("close", () => cloudClients.delete(res));
    return;
  }

  // Cloud fill preview page.
  if (req.url === "/cloud" || req.url === "/cloud/") {
    try {
      const body = await readFile(path.join(PROJECT, "cloud.html"));
      res.writeHead(200, { "Content-Type": MIME[".html"] });
      res.end(body);
    } catch {
      res.writeHead(404); res.end("cloud.html missing");
    }
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
    // Build artefacts mutate constantly — never let the browser cache them.
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream",
      "Cache-Control": urlPath.startsWith("/output/") ? "no-store" : "no-cache",
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("not found");
  }
});

function broadcast() {
  for (const c of clients) c.write("data: reload\n\n");
}

// ---- cloud fill progress: tail project/output/cloud-progress.log ----------
// Lines are written by scripts/cloud-step.sh (host OR container — same mount):
//   "<done>/<count> <pct> <mode> <artifact-name>"
let logLines = [];
let sentCount = 0;
// Stem of the cloud currently being built (e.g. "banner"), derived from the
// last progress-log line; used to scope final-artefact events to THIS build.
let cloudStem = null;

async function readProgressLog() {
  try {
    const t = await readFile(PROGRESS_LOG, "utf8");
    logLines = t.split("\n").filter(Boolean);
  } catch {
    logLines = [];
  }
  const parsed = logLines.map((line) => {
    const m = line.match(/^(\d+)\/(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    return m && { progress: 1, done: +m[1], count: +m[2], pct: +m[3], mode: m[4], artifact: m[5] };
  }).filter(Boolean);
  const lastArtifact = parsed.at(-1)?.artifact;
  cloudStem = lastArtifact ? lastArtifact.replace(/_\d+\.png$/, "") : null;
  return parsed;
}

function cloudBroadcast(obj) {
  for (const c of cloudClients) c.write(`data: ${JSON.stringify(obj)}\n\n`);
}

async function pumpProgress() {
  const parsed = await readProgressLog();
  for (; sentCount < parsed.length; sentCount++)
    cloudBroadcast(parsed[sentCount]);
}

// Reset the tail offset when the log is truncated by cloud-clean / a fresh run.
function progressChanged(f) {
  if (f === "cloud-progress.log") {
    // If the file shrank, restart from the beginning.
    stat(PROGRESS_LOG).then((s) => {
      if (sentCount > 0 && s.size === 0) sentCount = 0;
      return pumpProgress();
    }).catch(() => {
      sentCount = 0;
    });
    return;
  }
  if (/\.png$/i.test(f ?? "") && !/_\d+\.png$/.test(f) && cloudStem && f === `${cloudStem}.png`)
    cloudBroadcast({ artifact: f });
}

for (const dir of [PROJECT, RESOURCES]) {
  watch(dir, { recursive: true }, (_e, f) => {
    progressChanged(f ?? "");
    if (!f || /\.(png|json|html|ttf|otf|css)$/i.test(f)) {
      console.log("changed:", f ?? "?", "-> reloading", clients.size, "client(s)");
      broadcast();
    }
  });
}

server.listen(PORT, () =>
  console.log(`imagework livereload on http://localhost:${PORT} (compose.html, fragments/, output/)`)
);
