#!/usr/bin/env node
/**
 * compose.mjs — single-shot artifact rebuild for a project in the store.
 *
 *   node scripts/compose.mjs png [STEM]   -> project/<stem>/output/<stem>.png
 *   node scripts/compose.mjs pdf [STEM]   -> project/<stem>/output/<stem>.pdf
 *
 * project/ is a PROJECT STORE: one folder per project, 1-to-1:
 *   project/<stem>/layout.json   — the project's composition
 *   project/<stem>/output/       — its rendered artifacts + progress state
 *   project/.last-stem           — global marker: last-rendered stem
 *
 * Pipeline:
 *   project/<stem>/layout.json
 *     -> generated HTML body (fragments positioned + text + @font-face)
 *     -> pandoc --template=../templates/compose.html.tmpl (shared template,
 *        kept current for BOTH png and pdf targets)
 *     -> chromium headless (screenshot for png, print-to-pdf for pdf)
 *     -> project/<stem>/output/<stem>.<ext>
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, chownSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const STORE = path.join(ROOT, "project");
const RESOURCES = path.join(ROOT, "resources");

const target = process.argv[2] ?? "png";
let stem = process.argv[3] ?? "";
if (!["png", "pdf"].includes(target)) {
  console.error(`unknown target '${target}' (use png or pdf)`);
  process.exit(1);
}
if (!stem) {
  try { stem = readFileSync(path.join(STORE, ".last-stem"), "utf8").trim(); } catch {}
}
if (!stem || !existsSync(path.join(STORE, stem))) {
  const available = existsSync(STORE)
    ? readdirSync(STORE, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    : [];
  console.error(`unknown project '${stem || "(none)"}' — projects in the store: ${available.join(", ") || "(store empty)"}`);
  process.exit(1);
}

const DIR = path.join(STORE, stem);
const layoutPath = path.join(DIR, "layout.json");
if (!existsSync(layoutPath)) {
  console.error(`missing ${layoutPath} — every project folder needs a layout.json`);
  process.exit(1);
}
const layout = JSON.parse(readFileSync(layoutPath, "utf8"));

const canvas = layout.canvas ?? { width: 1200, height: 800 };
const background = canvas.background ?? "#ffffff";
const px = (v) => (typeof v === "number" ? `${v}px` : String(v));

/* ---- scan fragments on disk (fragment*.png) --------------------------- */
const fragmentFiles = new Set(
  existsSync(path.join(RESOURCES, "fragments")) ? readdirSync(path.join(RESOURCES, "fragments")).filter((f) => /^fragment.*\.png$/i.test(f)) : []
);

/* ---- custom fonts ------------------------------------------------------ */
const fonts = (layout.fonts ?? []).map((f) => `
@font-face {
  font-family: "${f.name ?? path.basename(f.file, path.extname(f.file))}";
  src: url("../../resources/fonts/${f.file}");
}`).join("\n");

/* ---- elements ---------------------------------------------------------- */
const elements = (layout.elements ?? []).map((el, i) => {
  const pos = `left:${px(el.x)};top:${px(el.y)};`;
  // layout.json may use "w" or "width"; accept both.
  const widthVal = el.w ?? el.width;
  const size = widthVal ? `width:${px(widthVal)};` : "";
  const align = el.align ? `text-align:${el.align};` : "";
  const style = `${pos}${size}${align}`;
  switch (el.type) {
    case "fragment": {
      const file = path.basename(el.src);
      if (!fragmentFiles.has(file)) {
        console.error(`LINT: element ${i} references missing fragment '${file}' ` +
          `(fragments/ contains: ${[...fragmentFiles].join(", ") || "nothing"})`);
        process.exitCode = 2;
      }
      return `<img class="fragment" style="${style}" src="../../resources/fragments/${file}" alt="${file}">`;
    }
    case "text": {
      const font = el.font ? `font-family:'${el.font}';` : "";
      const sizeF = el.size ? `font-size:${px(el.size)};` : "";
      const color = el.color ? `color:${el.color};` : "";
      const weight = el.weight ? `font-weight:${el.weight};` : "";
      // newlines must survive pandoc's HTML->markdown roundtrip
      const text = (el.text ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/\n/g, "<br>");
      return `<div class="text" style="${style}${font}${sizeF}${color}${weight}">${text}</div>`;
    }
    default:
      console.error(`LINT: element ${i} has unknown type '${el.type}'`);
      process.exitCode = 2;
      return "";
  }
}).join("\n");

/* every fragment on disk must have a logical assignment — unless the layout
   opts out via "lint": {"requireFragmentAssignment": false} (then it's a warning) */
const assigned = new Set((layout.elements ?? [])
  .filter((e) => e.type === "fragment")
  .map((e) => path.basename(e.src)));
const requireAssignment = (layout.lint ?? {}).requireFragmentAssignment !== false;
for (const f of fragmentFiles) {
  if (!assigned.has(f)) {
    if (requireAssignment) {
      console.error(`LINT: fragment 'fragments/${f}' exists but has no ` +
        `assignment in layout.json — position it or remove the file`);
      process.exitCode = 2;
    } else {
      console.warn(`LINT (relaxed): fragment 'fragments/${f}' has no assignment ` +
        `in layout.json — unassigned fragments allowed by lint.requireFragmentAssignment=false`);
    }
  }
}

/* ---- body -> pandoc template ------------------------------------------- */
const bodyHtml = `<!-- generated from layout.json; edit layout.json, not this -->
<div class="canvas" style="width:${px(canvas.width)};height:${px(canvas.height)};background:${background};position:relative;overflow:hidden;">
${elements}
</div>`;
writeFileSync(path.join(DIR, "compose.body.html"), bodyHtml);

mkdirSync(path.join(DIR, "output"), { recursive: true });
const out = path.join("output", `${stem}.${target}`);
mkdirSync(path.dirname(path.join(DIR, out)), { recursive: true });

const pandocArgs = [
  "compose.body.html",
  "--template=" + path.join(STORE, "templates", "compose.html.tmpl"),
  "--metadata", `title=${layout.title ?? "imagework"}`,
  "--variable", `target=${target}`,
  "--variable", `fonts=${fonts}`,
  "--variable", `canvasWidth=${px(canvas.width)}`,
  "--variable", `canvasHeight=${px(canvas.height)}`,
  /* no reflow: pre-wrap CSS would render pandoc's synthetic line breaks */
  "--wrap=none",
  "-o", "compose.html",
];
execFileSync("pandoc", pandocArgs, { cwd: DIR, stdio: "inherit" });

/* remember the last-rendered stem — `make repl` uses it to rebuild the
   latest artifact on session start without guessing "most recent file" */
/* auto-adaptive progress: a single render = 1/1 (done); rapid re-renders of
   the same stem = an ITERATIVE build — the bar shows N/(N+1) "in progress"
   after each pass until an explicit final emission (or the window passes).
   `make repl` / `make serve` therefore pick up multi-step rendering
   automatically — no special invocation. */
/* CINNAMON_REBUILD=1 marks the repl's STARTUP re-render of an old artifact —
   housekeeping, not new work: it must not claim .last-stem or emit
   progress/iteration state. */
const REBUILD = process.env.CINNAMON_REBUILD === "1";
const PROG = path.join(DIR, "output", `${stem}.progress`);
const now = Date.now();
let prev = null;
try { prev = JSON.parse(readFileSync(PROG, "utf8")); } catch {}
const ITER_WINDOW = 15 * 60 * 1000;
let step, total;
if (REBUILD) {
  step = 1; total = 1;                       // housekeeping render: no claims
} else if (!prev || !prev.time || now - prev.time > ITER_WINDOW || prev.total <= 1) {
  step = 1; total = 1;                       // fresh build (or re-render of a closed one): done after this render
} else {
  step = prev.step + 1; total = step + 1;    // iterating: never quite "done"
}
const autoLabel = step === 1 ? "output ready" : `iteration ${step} — in progress`;
if (!REBUILD) {
  writeFileSync(PROG, JSON.stringify({ stem, step, total, pct: Math.round(step * 100 / total), label: autoLabel, time: now }));

  /* remember the stem only after a render actually produced the file —
     `make repl` reads this to rebuild the latest artifact on session start */
  writeFileSync(path.join(STORE, ".last-stem"), stem);
}

/* pandoc writes each line on its own source line inside the div; under
   white-space:pre-wrap every raw newline renders as an extra break (a
   blank line becomes ~3 empty lines) and breaks layout measurement.
   <br> already carries the breaks, so strip raw newlines from text divs. */
const html = readFileSync(path.join(DIR, "compose.html"), "utf8")
  .replace(/(<div class="text"[^>]*>)([\s\S]*?)(<\/div>)/g,
    (_, open, inner, close) => open + inner.replace(/\s*\n\s*/g, "") + close);
writeFileSync(path.join(DIR, "compose.html"), html);

/* ---- render ------------------------------------------------------------ */
if (target === "png") {
  execFileSync("chromium", [
    "--headless=new", "--no-sandbox", "--disable-gpu",
    "--user-data-dir=/tmp/chromium-profile",
    `--window-size=${canvas.width},${canvas.height}`,
    "--hide-scrollbars", `--screenshot=${out}`,
    `file:///${path.join(DIR, "compose.html")}`,
  ], { cwd: DIR, stdio: "inherit" });
} else {
  execFileSync("chromium", [
    "--headless=new", "--no-sandbox", "--disable-gpu",
    "--user-data-dir=/tmp/chromium-profile",
    "--no-pdf-header-footer",
    `--print-to-pdf=${out}`,
    `file:///${path.join(DIR, "compose.html")}`,
  ], { cwd: DIR, stdio: "inherit" });
}

/* hand ownership of container-written files back to the host user (the
   container runs as root; without this, output files are root-owned and
   the host user can't overwrite or delete them) */
const HOST_UID = +(process.env.HOST_UID ?? 1000);
for (const f of [path.join(DIR, out), PROG, path.join(STORE, ".last-stem")])
  try { chownSync(f, HOST_UID, HOST_UID); } catch {}

console.log(process.exitCode ? "compose finished WITH LINT ERRORS (exit 2)" : `wrote ${out}`);
