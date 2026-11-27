/* tests/layout.test.mjs — node --test suite for scripts/layout.mjs.
 *
 * Runs the REAL CLI against fixture layouts (swapped into project/layout.json
 * with save/restore), asserting the lint contract: OVERLAP / OVERFLOW exit
 * codes, and that arrange() leaves pinned ("pinned": true) elements alone.
 * No external test libraries — node:test only. Render tests are intentionally
 * absent: pandoc/chromium live in the container, not on the host.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LAYOUT = path.join(ROOT, "project", "layout.json");

function runLayout(...args) {
  return spawnSync(process.execPath, ["scripts/layout.mjs", ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

/* Swap in a fixture layout, run, restore — even when the test fails. */
function withLayout(elements, fn) {
  const original = readFileSync(LAYOUT, "utf8");
  writeFileSync(LAYOUT, JSON.stringify({
    title: "test layout",
    canvas: { width: 1200, height: 800, background: "#ffffff" },
    elements,
  }, null, 2));
  try {
    return fn();
  } finally {
    writeFileSync(LAYOUT, original);
  }
}

const textEl = (text, x, y, extra = {}) => ({
  type: "text", text, x, y, font: "X", size: 16, ...extra,
});

test("check passes on a clean layout (exit 0)", () => {
  withLayout([
    textEl("hello", 10, 10),
    textEl("world", 10, 200),
  ], () => {
    const r = runLayout("check");
    assert.equal(r.status, 0, r.stderr || r.stdout);
    assert.match(r.stdout, /no overlaps, no overflow/);
  });
});

test("check reports OVERLAP and exits 2 on colliding elements", () => {
  withLayout([
    textEl("first block of text", 10, 10),
    textEl("second block of text", 10, 12), // collides on purpose
  ], () => {
    const r = runLayout("check");
    assert.equal(r.status, 2);
    assert.match(r.stderr, /OVERLAP/);
  });
});

test("check reports OVERFLOW when an element exits the canvas", () => {
  withLayout([
    textEl("off the edge", 1100, 700), // 1200x800 canvas: spills right/bottom
  ], () => {
    const r = runLayout("check");
    assert.equal(r.status, 2);
    assert.match(r.stderr, /OVERFLOW/);
  });
});

test("arrange leaves pinned elements untouched", () => {
  withLayout([
    textEl("Title Heading", 10, 10, { width: 1100, align: "center" }),
    textEl("body paragraph one", 10, 60, { width: 1100 }),
    textEl("made with cinnamon-print", 40, 760, { width: 1120, align: "center", pinned: true }),
  ], () => {
    const r = runLayout("arrange");
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const layout = JSON.parse(readFileSync(LAYOUT, "utf8"));
    const footer = layout.elements.find((e) => e.text.startsWith("made with"));
    assert.deepEqual(
      { x: footer.x, y: footer.y, width: footer.width },
      { x: 40, y: 760, width: 1120 },
      "pinned footer was moved by arrange"
    );
  });
});

test("arrange resolves overlaps (check passes afterwards)", () => {
  withLayout([
    textEl("Title Heading", 10, 10, { width: 1100, align: "center" }),
    textEl("body paragraph one", 10, 60, { width: 1100 }),
    textEl("body paragraph two", 10, 60, { width: 1100 }), // same slot on purpose
  ], () => {
    const r = runLayout("arrange");
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const after = runLayout("check");
    assert.equal(after.status, 0, after.stdout);
  });
});
