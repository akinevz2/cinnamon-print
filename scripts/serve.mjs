#!/usr/bin/env node
/**
 * serve.mjs — node livereload webserver for interactive composition work.
 * Serves project/ at http://localhost:8899 and pushes reload via SSE when
 * fragments, layout.json or the template change.
 */
import http from "node:http";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { watch } from "node:fs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PROJECT = path.join(ROOT, "project");
const RESOURCES = path.join(ROOT, "resources");
const SCRIPTS = path.join(ROOT, "scripts");
const OUTPUT = path.join(PROJECT, "output");
const SHADERS = path.join(RESOURCES, "shaders");
const FRAGMENTS = path.join(RESOURCES, "fragments");
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

  // Project list (sidebar data): outputs + metadata sidecars.
  if (req.url === "/api/projects") {
    const projects = await listProjects();
    res.writeHead(200, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
    res.end(JSON.stringify(projects));
    return;
  }

  // Frag Bench: shader list for the client-side WebGL renderer.
  if (req.url === "/api/shaders") {
    const shaders = await listShaders();
    res.writeHead(200, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
    res.end(JSON.stringify(shaders));
    return;
  }

  // Frag Bench fallback save: write a rendered PNG into resources/fragments/
  // as fragment-<name>.png (cross-browser; also works from the container).
  if (req.url === "/api/fragments" && req.method === "POST") {
    await saveFragment(req, res);
    return;
  }

  // Frag Bench page.
  if (req.url === "/frag" || req.url === "/frag/") {
    try {
      const body = await readFile(path.join(PROJECT, "frag.html"));
      res.writeHead(200, { "Content-Type": MIME[".html"] });
      res.end(body);
    } catch {
      res.writeHead(404); res.end("frag.html missing");
    }
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
      : urlPath.startsWith("/scripts/")
        ? path.join(SCRIPTS, urlPath.slice("/scripts/".length))
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

// ---- frag bench: shader listing + fragment upload --------------------------
// Shaders live in resources/shaders/*.frag; mtime is the change token the
// client diffs against so only new/updated files re-render. Sorted most
// recently updated first — that's the order both benches display.
async function listShaders() {
  try {
    const files = (await readdir(SHADERS)).filter((f) => /\.frag$/i.test(f));
    const shaders = [];
    for (const name of files) {
      const s = await stat(path.join(SHADERS, name)).catch(() => null);
      if (s) shaders.push({ name, mtime: s.mtimeMs });
    }
    return shaders.sort((a, b) => b.mtime - a.mtime);
  } catch {
    return [];
  }
}

async function saveFragment(req, res) {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const { name, dataUrl } = JSON.parse(Buffer.concat(chunks).toString());
    if (!/^[a-z0-9_-]{1,64}$/i.test(name ?? "")) throw new Error("bad name");
    const m = (dataUrl ?? "").match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
    if (!m) throw new Error("body must be {name, dataUrl: png data-url}");
    const buf = Buffer.from(m[1], "base64");
    // PNG magic + sane size cap (fragments are small tiles by design).
    if (buf.length < 8 || buf.length > 20 * 1024 * 1024) throw new Error("bad png size");
    if (!buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
      throw new Error("not a png");
    const file = path.join(FRAGMENTS, `fragment-${name}.png`);
    await writeFile(file, buf);
    console.log("fragment saved:", file);
    broadcast(); // compose.html preview picks the new fragment up
    res.writeHead(200, { "Content-Type": MIME[".json"] });
    res.end(JSON.stringify({ file: path.relative(ROOT, file) }));
  } catch (e) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  }
}

// ---- cloud fill progress: tail project/output/cloud-progress.log ----------
// Lines are written by scripts/cloud-step.sh (host OR container — same mount):
//   "<done>/<count> <pct> <mode> <artifact-name>"
let logLines = [];
let sentCount = 0;   // how many log lines have been streamed to clients
let lastLogSize = 0; // to detect truncation (cloud-clean / fresh run)
// Stem of the cloud currently being built (e.g. "banner"), derived from the
// last progress-log line; used to scope final-artefact events to THIS build.
let cloudStem = null;

async function readProgressLog() {
  let size = 0;
  try {
    size = (await stat(PROGRESS_LOG)).size;
    const t = await readFile(PROGRESS_LOG, "utf8");
    logLines = t.split("\n").filter(Boolean);
  } catch {
    logLines = [];
  }
  // File shrank (new run): restart the tail from the beginning.
  if (size < lastLogSize) sentCount = 0;
  lastLogSize = size;
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

// ---- project list: outputs on disk + their metadata sidecars --------------
// Final artefacts = output/*.png without a step suffix (_NNN.png). Metadata
// (title/prompt container) comes from the sibling <stem>.json sidecar.
async function listProjects() {
  let files = [];
  try {
    files = (await readdir(OUTPUT)).filter((f) => /\.png$/i.test(f) && !/_\d+\.png$/.test(f));
  } catch {
    return [];
  }
  const projects = [];
  for (const f of files) {
    const stem = f.replace(/\.png$/i, "");
    const full = path.join(OUTPUT, f);
    let meta = {};
    try { meta = JSON.parse(await readFile(path.join(OUTPUT, `${stem}.json`), "utf8")); } catch {}
    const s = await stat(full).catch(() => null);
    projects.push({
      file: f,
      title: meta.title ?? stem,
      prompt: meta.prompt ?? "",
      updated: s ? s.mtime.toISOString() : null,
    });
  }
  return projects.sort((a, b) => (a.updated < b.updated ? 1 : -1));
}

async function pumpProgress() {
  const parsed = await readProgressLog();
  // Guard against an offset ahead of the (possibly truncated) log.
  if (sentCount > parsed.length) sentCount = parsed.length;
  for (; sentCount < parsed.length; sentCount++)
    cloudBroadcast(parsed[sentCount]);
}

// Reset the tail offset when the log is truncated by cloud-clean / a fresh run.
function progressChanged(f) {
  if (f === "cloud-progress.log") {
    pumpProgress().catch(() => {});
    return;
  }
  if (/\.png$/i.test(f ?? "") && !/_\d+\.png$/.test(f) && cloudStem && f === `${cloudStem}.png`)
    cloudBroadcast({ artifact: f });
  // Any final png appearing/changing refreshes the sidebar on all clients.
  if (/\.png$/i.test(f ?? "") && !/_\d+\.png$/.test(f)) cloudBroadcast({ projects: 1 });
}

// On boot, position the tail at the existing log (don't replay history).
readProgressLog().then((parsed) => { sentCount = parsed.length; }).catch(() => {});

for (const dir of [PROJECT, RESOURCES]) {
  watch(dir, { recursive: true }, (_e, f) => {
    // Recursive-watch event names carry the subdirectory (e.g.
    // "output/cloud-progress.log") — cloud logic keys on the bare name.
    const base = path.basename(f ?? "");
    progressChanged(base);
    if (f && /\.frag$/i.test(f)) {
      console.log("shader changed:", f, "-> notifying", cloudClients.size, "bench client(s)");
      cloudBroadcast({ shaders: 1 });
    }
    if (!f || /\.(png|json|html|ttf|otf|css)$/i.test(f)) {
      console.log("changed:", f ?? "?", "-> reloading", clients.size, "client(s)");
      broadcast();
    }
  });
}

server.listen(PORT, () =>
  console.log(`imagework livereload on http://localhost:${PORT} (compose.html, fragments/, output/)`)
);
