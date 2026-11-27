/* tests/pngio.test.mjs — node --test suite for scripts/pngio.mjs and
 * scripts/trace-cutout.mjs. No external test libraries — node:test only.
 *
 * pngio: synthetic roundtrip (encoder + filter-0 unfiltering) and a real-asset
 * decode/re-encode/compare against resources/ship-crew.png (which stores every
 * scanline Sub-filtered — covers filter-1 reconstruction).
 *
 * trace-cutout: end-to-end run of the REAL CLI against a synthetic scene
 * (wood-brown background, dark-neutral "character" blob with a red dot, a
 * bone pixel, and a wood-coloured speck inside the blob that only enclosed-
 * hole filling can recover). Asserts the separation contract: character alpha
 * in the blob, hole alpha in the background, wood left behind, hole fill.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pngio = await import(path.join(ROOT, "scripts", "pngio.mjs"));

function runTrace(...args) {
  return spawnSync(process.execPath, ["scripts/trace-cutout.mjs", ...args], {
    cwd: ROOT, encoding: "utf8",
  });
}

test("pngio: encode -> decode roundtrip preserves straight-alpha RGBA", () => {
  const w = 33, h = 21, a = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    a[i * 4] = (i * 7) & 255; a[i * 4 + 1] = (i * 13) & 255;
    a[i * 4 + 2] = (i * 29) & 255; a[i * 4 + 3] = (i * 2) % 256;
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), "pngio-"));
  try {
    const f = path.join(dir, "rt.png");
    pngio.encode(f, w, h, a);
    const d = pngio.decode(f);
    assert.equal(d.w, w); assert.equal(d.h, h);
    assert.deepEqual([...d.rgba], [...a]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("pngio: decode -> re-encode -> decode matches on a Sub-filtered real PNG", () => {
  const src = pngio.decode(path.join(ROOT, "resources", "ship-crew.png"));
  const dir = mkdtempSync(path.join(os.tmpdir(), "pngio-"));
  try {
    const f = path.join(dir, "re.png");
    pngio.encode(f, src.w, src.h, src.rgba);
    const dst = pngio.decode(f);
    assert.equal(dst.w, src.w); assert.equal(dst.h, src.h);
    assert.deepEqual([...dst.rgba], [...src.rgba]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("trace-cutout: separates a synthetic character, fills enclosed holes", () => {
  // 64x64 scene: wood-brown background, dark-neutral blob at (20,20)-(43,43).
  const W = 64, H = 64;
  const rgba = new Uint8Array(W * H * 4);
  const put = (x, y, r, g, b) => { const i = (y * W + x) * 4; rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255; };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, 120, 70, 20); // wood
  for (let y = 20; y <= 43; y++) for (let x = 20; x <= 43; x++) put(x, y, 20, 20, 24); // character
  put(25, 25, 210, 190, 160);  // bone pixel (kept by the pale family)
  put(25, 30, 150, 40, 35);    // red pixel (kept by the red family)
  put(30, 30, 120, 70, 20);    // wood-coloured speck INSIDE the blob: hole-fill only
  const dir = mkdtempSync(path.join(os.tmpdir(), "trace-"));
  try {
    const src = path.join(dir, "scene.png"), hints = path.join(dir, "hints.json");
    const cut = path.join(dir, "cut.png"), bg = path.join(dir, "bg.png");
    pngio.encode(src, W, H, rgba);
    writeFileSync(hints, JSON.stringify({
      seedBoxes: [[22, 22, 26, 26]],
      forceBoxes: [],
      classify: {}, // defaults are tuned for wood-interior scenes like ship-crew
    }));
    const r = runTrace(src, hints, cut, bg);
    assert.equal(r.status, 0, r.stderr + r.stdout);

    const C = pngio.decode(cut), B = pngio.decode(bg);
    // feathered bbox: hard mask is 24x24, blur extends ~1-2 px per side
    assert.ok(C.w >= 24 && C.w <= 30, `cutout width ${C.w}`);
    assert.ok(C.h >= 24 && C.h <= 30, `cutout height ${C.h}`);

    const aAt = (img, x, y) => img.rgba[(y * img.w + x) * 4 + 3];
    // blob centre: opaque character, and the enclosed wood speck was hole-filled in —
    // the crop's central quarter must have no fully-transparent pixel
    for (let y = C.h >> 2; y < C.h - (C.h >> 2); y++)
      for (let x = C.w >> 2; x < C.w - (C.w >> 2); x++)
        assert.ok(aAt(C, x, y) > 0, `cutout hole at centre (${x},${y}) — hole fill failed`);
    // background: hole where the blob is, wood elsewhere
    assert.equal(aAt(B, 32, 32), 0, "blob centre transparent in background");
    assert.equal(aAt(B, 0, 0), 255, "canvas corner opaque wood");
    assert.equal(aAt(B, 50, 30), 255, "wood away from the blob stays opaque (past the feather)");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
