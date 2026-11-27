#!/usr/bin/env node
/* trace-cutout.mjs — trace a foreground character out of a scene PNG.
 *
 * Container-native (node + zlib via scripts/pngio.mjs, nothing else). Builds a
 * per-pixel silhouette mask from colour-family classification + region growing,
 * then emits BOTH separation artifacts:
 *
 *   <out-cutout.png>      the character, tight bbox crop, feathered alpha
 *   <out-background.png>  the scene with a feathered character-shaped hole
 *
 * usage:
 *   node scripts/trace-cutout.mjs <input.png> <hints.json> <out-cutout.png> <out-background.png> [--debug DIR]
 *
 * The hints JSON carries the image-specific geometry and classifier knobs —
 * hand-authored from zoomed mask-overlay iterations (this is a TRACE tool, not
 * an auto-segmenter; see resources/ship-crew.trace.json for a worked example):
 *
 *   {
 *     "pole":  { "from": [x,y], "to": [x,y], "halfWidth": n },  // straight prop/staff band, force-included
 *     "seedBoxes":   [[x0,y0,x1,y1], ...],  // keep()-classified pixels here start the region grow
 *     "forceBoxes":  [[x0,y0,x1,y1], ...],  // EVERY pixel here joins the mask (wood-coloured gear worn by the character)
 *     "classify": {                          // colour-family knobs (defaults shown in CLASSIFY_DEFAULTS)
 *       "red":  { "minR": 55, "overG": 2.4, "overB": 2.1 },          // saturated cloth reds (r >> g,b)
 *       "bone": { "minR": 110, "minG": 100, "minB": 80, "maxRG": 30, "maxGB": 70 }, // pale warm neutrals (skin/bone/light trim)
 *       "dimBone": { "minR": 85, "minB": 55, "bOverR": 0.42, "gOverR": 0.55, "maxRG": 30 },      // shadowed bone (b/r ratio separates it from brown floor)
 *       "blue": { "minB": 70, "overR": 15, "overG": 8 },             // cool blues (weapon blades)
 *       "dressDark": { "maxV": 105, "bTolerance": -2 },              // near-neutral darks (cloth vs brown shadows: b >= r + bTolerance)
 *       "wood": { "rbGap": 13, "minR": 42, "gSlack": 6 }             // the REJECT class: browns/oranges (r > b + gap)
 *     }
 *   }
 *
 * pipeline: classify -> seed (boxes + pole band) -> BFS region-grow over
 * keep()-pixels -> drop components that never touched a seed -> fill enclosed
 * holes (background-coloured regions fully surrounded by the mask: worn gear,
 * see-through gaps connected to the border stay holes) -> feather.
 */
import { decode, encode } from "./pngio.mjs";
import fs from "fs";
import path from "path";

const CLASSIFY_DEFAULTS = {
  red: { minR: 55, overG: 2.4, overB: 2.1 },
  bone: { minR: 110, minG: 100, minB: 80, maxRG: 30, maxGB: 70 },
  dimBone: { minR: 85, minB: 55, bOverR: 0.42, gOverR: 0.55, maxRG: 30 },
  blue: { minB: 70, overR: 15, overG: 8 },
  dressDark: { maxV: 105, bTolerance: -2 },
  wood: { rbGap: 13, minR: 42, gSlack: 6 },
};

const [, , INPUT, HINTS, OUT_CUT, OUT_BG, ...rest] = process.argv;
if (!INPUT || !HINTS || !OUT_CUT || !OUT_BG) {
  console.error("usage: trace-cutout.mjs <input.png> <hints.json> <out-cutout.png> <out-background.png> [--debug DIR]");
  process.exit(2);
}
const DEBUG = rest[0] === "--debug" ? rest[1] : null;
const hints = JSON.parse(fs.readFileSync(HINTS, "utf8"));
const C = { ...CLASSIFY_DEFAULTS, ...(hints.classify || {}) };
for (const k of Object.keys(C)) C[k] = { ...CLASSIFY_DEFAULTS[k], ...C[k] };

const { w, h, rgba } = decode(INPUT);
const N = w * h;
const R = (i) => rgba[i * 4], G = (i) => rgba[i * 4 + 1], B = (i) => rgba[i * 4 + 2];

// ---- colour families --------------------------------------------------------
function isRed(i) { const r = R(i), g = G(i), b = B(i); return r > C.red.minR && r > g * C.red.overG && r > b * C.red.overB; }
function isBone(i) { const r = R(i), g = G(i), b = B(i); return r > C.bone.minR && g > C.bone.minG && b > C.bone.minB && r - g < C.bone.maxRG && g - b < C.bone.maxGB; }
function isDimBone(i) { const r = R(i), g = G(i), b = B(i); return r > C.dimBone.minR && b > C.dimBone.minB && b > r * C.dimBone.bOverR && g > r * C.dimBone.gOverR && r - g < C.dimBone.maxRG; }
function isBlue(i) { const r = R(i), g = G(i), b = B(i); return b > C.blue.minB && b > r + C.blue.overR && b > g + C.blue.overG; }
function isDressDark(i) { const r = R(i), g = G(i), b = B(i); return Math.max(r, g, b) < C.dressDark.maxV && b > r + C.dressDark.bTolerance; }
function isWood(i) { const r = R(i), g = G(i), b = B(i); return r > b + C.wood.rbGap && r > C.wood.minR && g < r + C.wood.gSlack && !isRed(i) && !isBone(i); }
function keep(i) { return isRed(i) || isBone(i) || isDimBone(i) || isBlue(i) || isDressDark(i); }

// ---- pole band --------------------------------------------------------------
const hasPole = !!hints.pole;
const PA = hasPole ? hints.pole.from : [0, 0];
const PB = hasPole ? hints.pole.to : [0, 0];
const HW = hasPole ? hints.pole.halfWidth : 0;
function inPoleBand(x, y) {
  if (!hasPole) return false;
  if (y < Math.min(PA[1], PB[1]) - 6 || y > Math.max(PA[1], PB[1]) + 6) return false;
  const t = (y - PA[1]) / (PB[1] - PA[1]);
  const cx = PA[0] + t * (PB[0] - PA[0]);
  return Math.abs(x - cx) <= HW;
}

// ---- seeds ------------------------------------------------------------------
const seed = new Uint8Array(N);
for (const box of hints.seedBoxes || [])
  for (let y = box[1]; y <= box[3]; y++) for (let x = box[0]; x <= box[2]; x++) {
    const i = y * w + x;
    if (keep(i) || inPoleBand(x, y)) seed[i] = 1;
  }
for (const box of hints.forceBoxes || [])
  for (let y = box[1]; y <= box[3]; y++) for (let x = box[0]; x <= box[2]; x++) seed[y * w + x] = 1;

// ---- region grow ------------------------------------------------------------
const mask = new Uint8Array(N);
const stack = new Int32Array(N);
let sp = 0;
for (let i = 0; i < N; i++) if (seed[i]) { mask[i] = 1; stack[sp++] = i; }
while (sp > 0) {
  const i = stack[--sp];
  const x = i % w, y = (i / w) | 0;
  const tryPush = (j, xx, yy) => {
    if (mask[j]) return;
    if (keep(j) || inPoleBand(xx, yy)) { mask[j] = 1; stack[sp++] = j; }
  };
  if (x > 0) tryPush(i - 1, x - 1, y);
  if (x < w - 1) tryPush(i + 1, x + 1, y);
  if (y > 0) tryPush(i - w, x, y - 1);
  if (y < h - 1) tryPush(i + w, x, y + 1);
}

// drop adopted components that never touched a seed
{
  const cid = new Int32Array(N).fill(-1);
  const comps = [];
  for (let s = 0; s < N; s++) {
    if (!mask[s] || cid[s] >= 0) continue;
    const id = comps.length; let sp2 = 0; stack[sp2++] = s; cid[s] = id;
    let touchesSeed = false;
    while (sp2 > 0) {
      const i = stack[--sp2];
      const x = i % w, y = (i / w) | 0;
      if (seed[i]) touchesSeed = true;
      if (x > 0 && mask[i - 1] && cid[i - 1] < 0) { cid[i - 1] = id; stack[sp2++] = i - 1; }
      if (x < w - 1 && mask[i + 1] && cid[i + 1] < 0) { cid[i + 1] = id; stack[sp2++] = i + 1; }
      if (y > 0 && mask[i - w] && cid[i - w] < 0) { cid[i - w] = id; stack[sp2++] = i - w; }
      if (y < h - 1 && mask[i + w] && cid[i + w] < 0) { cid[i + w] = id; stack[sp2++] = i + w; }
    }
    comps.push({ id, touchesSeed });
  }
  for (let i = 0; i < N; i++) if (mask[i] && !comps[cid[i]].touchesSeed) mask[i] = 0;
}

// ---- fill enclosed holes ----------------------------------------------------
// A background-coloured region fully enclosed by the mask belongs to the
// character (belt, buckle gaps). Regions connected to the image border
// (see-through gaps between arm and body) stay holes.
{
  const outside = new Uint8Array(N);
  const stk = new Int32Array(N); let sp2 = 0;
  for (let x = 0; x < w; x++) {
    if (!mask[x] && !outside[x]) { outside[x] = 1; stk[sp2++] = x; }
    const b0 = (h - 1) * w + x;
    if (!mask[b0] && !outside[b0]) { outside[b0] = 1; stk[sp2++] = b0; }
  }
  for (let y = 0; y < h; y++) {
    if (!mask[y * w] && !outside[y * w]) { outside[y * w] = 1; stk[sp2++] = y * w; }
    const r0 = y * w + w - 1;
    if (!mask[r0] && !outside[r0]) { outside[r0] = 1; stk[sp2++] = r0; }
  }
  while (sp2 > 0) {
    const i = stk[--sp2];
    const x = i % w, y = (i / w) | 0;
    const push = (j) => { if (!mask[j] && !outside[j]) { outside[j] = 1; stk[sp2++] = j; } };
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  let filled = 0;
  for (let i = 0; i < N; i++) if (!mask[i] && !outside[i]) { mask[i] = 1; filled++; }
  console.log(`hole fill: ${filled} px`);
}

// ---- stats ------------------------------------------------------------------
let minX = w, maxX = -1, minY = h, maxY = -1, count = 0;
for (let i = 0; i < N; i++) if (mask[i]) {
  count++;
  const x = i % w, y = (i / w) | 0;
  if (x < minX) minX = x; if (x > maxX) maxX = x;
  if (y < minY) minY = y; if (y > maxY) maxY = y;
}
console.log(`mask: ${count} px  bbox=(${minX},${minY})-(${maxX},${maxY})`);

// ---- feathered alpha + artifacts -------------------------------------------
const blur3 = (src) => {
  const out = new Float32Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = Math.min(Math.max(x + dx, 0), w - 1), yy = Math.min(Math.max(y + dy, 0), h - 1);
      s += src[yy * w + xx];
    }
    out[y * w + x] = s / 9;
  }
  return out;
};
const dilate = (src, r) => {
  let cur = Float32Array.from(src);
  for (let p = 0; p < r; p++) {
    const nxt = Float32Array.from(cur);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (cur[i]) continue;
      let m = 0;
      if (x > 0) m = Math.max(m, cur[i - 1]);
      if (x < w - 1) m = Math.max(m, cur[i + 1]);
      if (y > 0) m = Math.max(m, cur[i - w]);
      if (y < h - 1) m = Math.max(m, cur[i + w]);
      nxt[i] = m;
    }
    cur = nxt;
  }
  return cur;
};
const maskF = new Float32Array(N);
for (let i = 0; i < N; i++) maskF[i] = mask[i];
const cutA = blur3(maskF);
const holeA = blur3(dilate(maskF, 2));

// cutout: tight bbox crop, straight alpha — the bbox is taken over ALPHA
// (not the hard mask) so the full feather ramp survives the crop
const DW0 = Math.max(0, maxX - minX + 1), DH0 = Math.max(0, maxY - minY + 1);
let aMinX = w, aMaxX = -1, aMinY = h, aMaxY = -1;
for (let y = Math.max(0, minY - 3); y <= Math.min(h - 1, maxY + 3); y++)
  for (let x = Math.max(0, minX - 3); x <= Math.min(w - 1, maxX + 3); x++)
    if (Math.round(cutA[y * w + x] * 255) > 2) {
      if (x < aMinX) aMinX = x; if (x > aMaxX) aMaxX = x;
      if (y < aMinY) aMinY = y; if (y > aMaxY) aMaxY = y;
    }
const DW = aMaxX - aMinX + 1, DH = aMaxY - aMinY + 1;
const cut = new Uint8Array(DW * DH * 4);
for (let y = 0; y < DH; y++) for (let x = 0; x < DW; x++) {
  const si = ((aMinY + y) * w + aMinX + x) * 4, o = (y * DW + x) * 4;
  cut[o] = rgba[si]; cut[o + 1] = rgba[si + 1]; cut[o + 2] = rgba[si + 2];
  cut[o + 3] = Math.round(cutA[(aMinY + y) * w + aMinX + x] * 255);
}
encode(OUT_CUT, DW, DH, cut);

// background: full frame, feathered (2px-dilated) hole
const bg = new Uint8Array(N * 4);
for (let i = 0; i < N; i++) {
  const o = i * 4;
  bg[o] = R(i); bg[o + 1] = G(i); bg[o + 2] = B(i);
  bg[o + 3] = Math.round((1 - holeA[i]) * 255);
}
encode(OUT_BG, w, h, bg);
console.log(`cutout: ${DW}x${DH} at (${aMinX},${aMinY}); background: ${w}x${h}`);

// ---- optional debug renders -------------------------------------------------
if (DEBUG) {
  fs.mkdirSync(DEBUG, { recursive: true });
  const ov = Uint8Array.from(rgba);
  for (let i = 0; i < N; i++) if (mask[i]) {
    ov[i * 4] = (R(i) * 0.55) | 0; ov[i * 4 + 1] = G(i); ov[i * 4 + 2] = (B(i) * 0.55) | 0;
  }
  encode(path.join(DEBUG, "overlay.png"), w, h, ov);
  const prev = (img, name, W, H) => {
    const o2 = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, o = i * 4;
      const c = (((x / 16) | 0) + ((y / 16) | 0)) % 2 ? 95 : 65;
      const a = img[o + 3] / 255;
      o2[o] = (img[o] * a + c * (1 - a)) | 0;
      o2[o + 1] = (img[o + 1] * a + c * (1 - a)) | 0;
      o2[o + 2] = (img[o + 2] * a + c * (1 - a)) | 0;
      o2[o + 3] = 255;
    }
    encode(path.join(DEBUG, name), W, H, o2);
  };
  prev(cut, "cutout-checker.png", DW, DH);
  prev(bg, "background-checker.png", w, h);
  console.log(`debug renders in ${DEBUG}/`);
}
