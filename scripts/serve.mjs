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
import { rename, mkdir } from "node:fs/promises";

const ROOT = path.resolve(import.meta.dirname, "..");
const PROJECT = path.join(ROOT, "project");
const RESOURCES = path.join(ROOT, "resources");
const SCRIPTS = path.join(ROOT, "scripts");
const OUTPUT = path.join(PROJECT, "output");
const SHADERS = path.join(RESOURCES, "shaders");
const FRAGMENTS = path.join(RESOURCES, "fragments");
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
    // replay each project's current progress state, then the final artefact
    // of the last-built stem.
    const states = await progressMap();
    for (const p of Object.values(states)) res.write(`data: ${JSON.stringify(p)}\n\n`);
    try {
      const lastStem = (await readFile(path.join(OUTPUT, ".last-stem"), "utf8")).trim();
      res.write(`data: ${JSON.stringify({ artifact: `${lastStem}.png`, stem: lastStem })}\n\n`);
    } catch {}
    req.on("close", () => cloudClients.delete(res));
    return;
  }

  // Full per-stem progress state (for page loads; SSE carries deltas).
  if (req.url === "/api/progress") {
    res.writeHead(200, { "Content-Type": MIME[".json"], "Cache-Control": "no-store" });
    res.end(JSON.stringify(await progressMap()));
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

  // Trash: move a project or a frag out of the workspace, restorably — files
  // land in .opencode/trash/<same-relative-path> (gitignored). Body:
  //   {"project": "<stem>"}  → moves output/<stem>.(png|pdf|json|progress)
  //   {"shader": "<name.frag>"} → moves resources/shaders/<name>
  // RESTORE: move the files back from .opencode/trash/ to their original
  // relative path (the tree under trash mirrors it).
  if (req.url === "/api/trash" && req.method === "POST") {
    try {
      const body = await new Promise((resolve, reject) => {
        let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => resolve(JSON.parse(b || "{}")));
      });
      const TRASH = path.join(ROOT, ".opencode", "trash");
      const moved = [];
      const quietMove = async (rel) => {
        const src = path.join(ROOT, rel);
        if (!src.startsWith(path.join(ROOT, "project", "output")) &&
            !src.startsWith(path.join(ROOT, "resources", "shaders"))) throw new Error("untrashable path: " + rel);
        await stat(src);                                     // throws if absent — quiet skip
        const dst = path.join(TRASH, rel);
        await mkdir(path.dirname(dst), { recursive: true });
        await rename(src, dst);
        moved.push(rel);
      };
      if (body.project) {
        const stem = String(body.project).replace(/[^a-z0-9._-]/gi, "");
        for (const ext of ["png", "pdf", "json", "progress"])
          await quietMove(`project/output/${stem}.${ext}`).catch(() => {});
        // a trashed stem can no longer be the "last" one
        try {
          const ls = path.join(OUTPUT, ".last-stem");
          if ((await readFile(ls, "utf8")).trim() === stem) await rename(ls, path.join(TRASH, "output/.last-stem"));
        } catch {}
        cloudBroadcast({ projects: 1 });
      } else if (body.shader) {
        const name = String(body.shader).replace(/[\/\\]/g, "");
        await quietMove(`resources/shaders/${name}`);
        cloudBroadcast({ shaders: 1 });
      } else {
        throw new Error("pass {\"project\": stem} or {\"shader\": name}");
      }
      res.writeHead(200, { "Content-Type": MIME[".json"] });
      res.end(JSON.stringify({ trashed: moved }));
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
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

  // The project console is the index: live build preview + fragment library.
  // (The composed-artifact preview stays available at /compose.html.)
  if (req.url === "/" || req.url === "") {
    res.writeHead(302, { Location: "/cloud" });
    res.end();
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

// ---- per-project build progress ------------------------------------------
// scripts/progress.sh writes output/<stem>.progress (overwritten state, one
// JSON object per stem: {stem, step, total, pct, label}); the watcher pushes
// updates to /cloud/events, and /api/progress returns the full state map for
// page loads. cloud-step.sh emits one step per stamped instance; simple
// agent projects emit 0/1 at prompt submission and 1/1 when output lands.
const PROGRESS_RE = /^(.+)\.progress$/;

async function readStemProgress(stem) {
  try {
    return JSON.parse(await readFile(path.join(OUTPUT, `${stem}.progress`), "utf8"));
  } catch {
    return null;
  }
}

async function progressMap() {
  let files = [];
  try {
    files = (await readdir(OUTPUT)).filter((f) => PROGRESS_RE.test(f));
  } catch {
    return {};
  }
  const map = {};
  for (const f of files) {
    const stem = f.replace(PROGRESS_RE, "$1");
    const p = await readStemProgress(stem).catch(() => null);
    if (p) map[stem] = p;
  }
  return map;
}

async function pumpProgress(f) {
  const stem = f.replace(PROGRESS_RE, "$1");
  const p = await readStemProgress(stem).catch(() => null);
  if (p) cloudBroadcast(p);
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
  // The last-rendered stem (written by compose.mjs after every successful
  // render) is the one the console should open by default — file mtimes lie
  // when unrelated builds touch output/.
  let lastStem = null;
  try {
    lastStem = (await readFile(path.join(OUTPUT, ".last-stem"), "utf8")).trim() || null;
  } catch {}
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
      last: stem === lastStem,
    });
  }
  /* the last-rendered project first, then newest-first by mtime */
  return projects.sort((a, b) => (b.last - a.last) || (a.updated < b.updated ? 1 : -1));
}

function progressChanged(f) {
  if (PROGRESS_RE.test(f ?? "")) {
    pumpProgress(f).catch(() => {});
    return;
  }
  if (/\.png$/i.test(f ?? "") && !/_\d+\.png$/.test(f)) {
    const stem = f.replace(/\.png$/i, "");
    cloudBroadcast({ artifact: f, stem });   // scope swaps to the emitting project
    cloudBroadcast({ projects: 1 });         // any final png refreshes the sidebar
  }
}

for (const dir of [PROJECT, RESOURCES]) {
  watch(dir, { recursive: true }, (_e, f) => {
    // Recursive-watch event names carry the subdirectory (e.g.
    // "output/cheese.progress") — progress logic keys on the bare name.
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
