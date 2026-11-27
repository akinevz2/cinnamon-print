#!/usr/bin/env node
/**
 * layout.mjs — geometric arrangement of text elements for layout.json.
 *
 *   node scripts/layout.mjs check     # report overlaps / canvas overflow
 *   node scripts/layout.mjs arrange   # compute non-overlapping positions
 *                                     # and rewrite layout.json
 *
 * Why: placing text by hand (or by a small model guessing coordinates)
 * reliably produces overlapping paragraphs, because the rendered height
 * of a text block depends on wrapping and paragraph spacing, which are
 * not visible in the JSON. This script measures REAL rendered boxes with
 * the same headless chromium that compose.mjs renders with, and either
 * reports collisions (check) or stacks every block in a column grid so
 * collisions are impossible by construction (arrange).
 *
 * Measurement: a standalone measure.html replicates the template's text
 * CSS (absolute .text, pre-wrap, line-height 1.4, @font-face) and a
 * script writes each element's bounding box into the DOM; --dump-dom
 * returns it. If chromium is unavailable the script falls back to a
 * conservative estimate (see estimateBox) — always verify with a render.
 *
 * Optional "arrange" block in layout.json overrides the defaults:
 *   "arrange": {
 *     "margin": 40,            // canvas edge margin (default 40)
 *     "gap": 24,               // vertical gap between blocks (default 24)
 *     "columns": [             // explicit column grid
 *       { "x": 100, "width": 320 }, { "x": 460, "width": 300 }, ...
 *     ]
 *   }
 * If "columns" is omitted, three equal columns are derived from the
 * canvas. If "arrange" is absent entirely, defaults apply.
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const STORE = path.join(ROOT, "project");

// project stem: argv[3], else the .last-stem marker, else the sole project
let stem = process.argv[3] ?? "";
if (!stem) {
  try { stem = readFileSync(path.join(STORE, ".last-stem"), "utf8").trim(); } catch {}
}
const dirs = () => existsSync(STORE)
  ? readdirSync(STORE, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  : [];
if (!stem) {
  const available = dirs();
  if (available.length === 1) stem = available[0];
}
const LAYOUT = path.join(STORE, stem, "layout.json");

if (!existsSync(LAYOUT)) {
  console.error(`missing ${LAYOUT}\nusage: node scripts/layout.mjs check|arrange [stem]\nprojects in the store: ${dirs().join(", ") || "(store empty)"}`);
  process.exit(1);
}
const layout = JSON.parse(readFileSync(LAYOUT, "utf8"));
const canvas = layout.canvas ?? { width: 1200, height: 800 };
const opts = { margin: 40, gap: 24, ...(layout.arrange ?? {}) };
const cmd = process.argv[2] ?? "check";
if (!["check", "arrange"].includes(cmd)) {
  console.error("usage: node scripts/layout.mjs check|arrange");
  process.exit(1);
}

const px = (v) => (typeof v === "number" ? `${v}px` : String(v));
const widthOf = (el) => el.width ?? el.w;

/* ---- estimation fallback (conservative) --------------------------------- */
const LINE_HEIGHT = 1.4;
const GLYPH_WIDTH = 0.68;      // calibrated high for the system sans
const BLANK_LINE_LINES = 2;    // pandoc paragraph breaks render tall

function estimateBox(el) {
  const size = el.size ?? 16;
  const width = widthOf(el);
  const lines = String(el.text ?? "")
    .split("\n")
    .reduce((n, line) => {
      if (line === "") return n + BLANK_LINE_LINES;
      if (!width) return n + 1;
      const cpl = Math.max(1, Math.floor(width / (size * GLYPH_WIDTH)));
      return n + Math.max(1, Math.ceil(line.length / cpl));
    }, 0);
  const w = width ?? Math.min(canvas.width, String(el.text ?? "").length * size * GLYPH_WIDTH);
  return { w, h: lines * size * LINE_HEIGHT };
}

/* ---- real measurement via headless chromium ----------------------------- */
function measureBoxes(elements) {
  const fonts = (layout.fonts ?? []).map((f) => `
@font-face {
  font-family: "${f.name ?? path.basename(f.file, path.extname(f.file))}";
  src: url("../resources/fonts/${f.file}");
}`).join("\n");
  const els = elements.map((el, i) => {
    const style = [
      `left:${px(el.x ?? 0)}`, `top:${px(el.y ?? 0)}`,
      widthOf(el) ? `width:${px(widthOf(el))}` : "",
      el.align ? `text-align:${el.align}` : "",
      el.font ? `font-family:'${el.font}'` : "",
      `font-size:${px(el.size ?? 16)}`,
      el.color ? `color:${el.color}` : "",
      el.weight ? `font-weight:${el.weight}` : "",
    ].filter(Boolean).join(";");
    const text = (el.text ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>");
    return `<div class="text" data-i="${i}" style="${style}">${text}</div>`;
  }).join("\n");
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
${fonts}
html,body{margin:0;padding:0;}
.text{position:absolute;white-space:pre-wrap;line-height:1.4;}
</style></head><body>
<div style="position:relative;width:${px(canvas.width)};">${els}</div>
<script>
window.addEventListener("load", () => setTimeout(() => {
  const out = {};
  document.querySelectorAll(".text").forEach((d) => {
    const r = d.getBoundingClientRect();
    out[d.dataset.i] = { w: r.width, h: r.height };
  });
  document.body.innerHTML = "";
  document.body.appendChild(Object.assign(document.createElement("pre"), { textContent: "BOXES" + JSON.stringify(out) }));
}, 300));
</script></body></html>`;
  const tmp = mkdtempSync(path.join(os.tmpdir(), "layout-measure-"));
  const file = path.join(tmp, "measure.html");
  writeFileSync(file, html);
  try {
    const dom = execFileSync("chromium", [
      "--headless=new", "--no-sandbox", "--disable-gpu",
      "--user-data-dir=" + path.join(tmp, "profile"),
      "--virtual-time-budget=4000", "--dump-dom", "file://" + file,
    ], { cwd: STORE, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const m = dom.match(/BOXES(\{.*\})/s);
    if (!m) return null;
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/* ---- heading/body pairing ------------------------------------------------ */
function isHeading(el, next) {
  return (
    el.type === "text" && next?.type === "text" &&
    (el.size ?? 16) >= 24 && String(el.text ?? "").length <= 60
  );
}

/* ---- grouping (classified from PRISTINE elements, before any mutation) --- */
function classify(elements) {
  const groups = [];
  let i = 0;
  /* leading centered header blocks: title (first heading) + wide intro.
     Header detection uses align=center, not width, so re-running arrange
     on an already-arranged layout is stable (all elements get widths). */
  while (i < elements.length) {
    const el = elements[i];
    if (groups.length === 0 || el.align === "center") { groups.push({ kind: "header", els: [el] }); i++; }
    else break;
  }
  /* remaining elements grouped into heading+body pairs, or lone blocks */
  while (i < elements.length) {
    if (isHeading(elements[i], elements[i + 1])) {
      groups.push({ kind: "pair", els: [elements[i], elements[i + 1]] });
      i += 2;
    } else {
      groups.push({ kind: "lone", els: [elements[i]] });
      i++;
    }
  }
  return groups;
}

/* ---- stack blocks in a column grid -------------------------------------- */
function arrange(elements, groups, heightOf) {
  /* leading centered header blocks: title (first heading) + wide intro */
  const header = groups.filter((g) => g.kind === "header").flatMap((g) => g.els);

  /* remaining elements grouped into heading+body pairs, or lone blocks */
  const blocks = groups
    .filter((g) => g.kind !== "header")
    .map((g) => g.kind === "pair" ? { heading: g.els[0], body: g.els[1] } : { heading: null, body: g.els[0] });

  const inner = canvas.width - 2 * opts.margin;
  const columns = opts.columns ?? [0, 1, 2].map((c) => ({
    x: opts.margin + (c * inner) / 3 + 20,
    width: inner / 3 - 40,
  }));
  const cursors = columns.map(() => 0);

  let y = opts.margin;
  for (const el of header) {
    el.x = opts.margin;
    el.width = inner;
    el.align = "center";
    el.y = y;
    y += heightOf(el).h + opts.gap;
  }
  const bodyTop = y + opts.gap;

  /* pairs flow into the shortest column — balance is automatic */
  for (const block of blocks) {
    const c = cursors.indexOf(Math.min(...cursors));
    const col = columns[c];
    const el = block.body;
    el.x = col.x;
    el.width = col.width;
    delete el.align;
    let top = bodyTop + cursors[c];
    if (block.heading) {
      const h = block.heading;
      h.x = col.x;
      h.width = col.width;
      h.align = "left";
      h.y = top;
      top += heightOf(h).h + Math.round(opts.gap / 2);
    }
    el.y = top;
    cursors[c] = top - bodyTop + heightOf(el).h + opts.gap;
  }

  return { bodyTop, cursors, header, blocks, columns };
}

/* ---- main ---------------------------------------------------------------- */
const textEls = (layout.elements ?? []).filter((e) => e.type === "text");
const textOnly = (layout.elements ?? []).every((e) => e.type === "text");

if (cmd === "arrange" && !textOnly) {
  console.error("arrange only handles text-only layouts; fragments must be placed manually.");
  process.exit(2);
}

const measured = measureBoxes(textEls);
if (process.env.LAYOUT_DEBUG && measured) {
  for (const [i, b] of Object.entries(measured)) {
    console.log(`measured[${i}] w=${Math.round(b.w)} h=${Math.round(b.h)} "${String(textEls[i].text).slice(0, 25)}"`);
  }
}
const heightOf = (el) => {
  const idx = textEls.indexOf(el);
  if (measured?.[idx]) return measured[idx];
  return estimateBox(el);
};
if (!measured) console.error("note: chromium measurement unavailable, using conservative estimates");

if (cmd === "check") {
  const boxes = textEls
    .filter((e) => String(e.text ?? "").trim() !== "")
    .map((el) => ({ el, box: { x: el.x ?? 0, y: el.y ?? 0, ...heightOf(el) } }));
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  let bad = 0;
  for (let i = 0; i < boxes.length; i++) {
    const { el, box } = boxes[i];
    if (box.y + box.h > canvas.height - 1 || box.x + box.w > canvas.width - 1) {
      console.error(`OVERFLOW: "${String(el.text).slice(0, 40)}..." box ` +
        `(${Math.round(box.x)},${Math.round(box.y)}) ${Math.round(box.w)}x${Math.round(box.h)} ` +
        `exceeds canvas ${canvas.width}x${canvas.height}`);
      bad++;
    }
    for (let j = i + 1; j < boxes.length; j++) {
      const other = boxes[j];
      if (hit(box, other.box)) {
        console.error(`OVERLAP: "${String(el.text).slice(0, 30)}..." (element ${i}) ` +
          `overlaps "${String(other.el.text).slice(0, 30)}..." (element ${j}) — ` +
          `boxes ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.w)}x${Math.round(box.h)} ` +
          `and ${Math.round(other.box.x)},${Math.round(other.box.y)} ${Math.round(other.box.w)}x${Math.round(other.box.h)}`);
        bad++;
      }
    }
  }
  console.log(bad ? `${bad} problem(s) found — run 'node scripts/layout.mjs arrange'` :
    "no overlaps, no overflow.");
  process.exitCode = bad ? 2 : 0;
} else {
  /* two passes: measurements depend on column width, which arrange sets.
     Pass 1 sets widths with estimates; pass 2 re-measures and re-stacks.
     Grouping is classified once from the pristine elements. */
  /* elements with "pinned": true (footers, watermarks) are left untouched */
  const movable = textEls.filter((e) => !e.pinned);
  const groups = classify(movable);
  arrange(movable, groups, (el) => estimateBox(el));
  const remeasured = measureBoxes(movable);
  const h2 = (el) => {
    const idx = movable.indexOf(el);
    return (remeasured?.[idx]) ?? estimateBox(el);
  };
  const { bodyTop, cursors, header, blocks } = arrange(movable, groups, h2);

  const needed = bodyTop + Math.max(0, ...cursors) + opts.margin;
  if (needed > canvas.height) {
    canvas.height = Math.ceil(needed);
    layout.canvas = canvas;
    console.log(`canvas height grown to ${canvas.height} to fit content`);
  }

  writeFileSync(LAYOUT, JSON.stringify(layout, null, 2) + "\n");
  console.log(`arranged ${header.length} header + ${blocks.length} content block(s) ` +
    `${remeasured ? "(measured)" : "(estimated)"} into ${opts.columns?.length ?? 3} column(s); wrote layout.json`);
}
