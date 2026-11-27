#!/usr/bin/env node
// hec-plaster.mjs — monte-carlo plaster, cloud-step style:
//
//   1. scale the canvas up (S = crop diagonal + headroom) so any accumulated
//      rotation/shear always keeps the final crop area on the visible canvas
//      (diagonal-to-diagonal: crop's diagonal must fit the greater canvas' width)
//   2. throw each cat cube (hexagon alpha-masked, slight drop shadow) at a
//      point whose ROTATION-ACCOUNTED bounding circle never overlaps the
//      centre-text bounding rect
//   3. after every blit, transform the whole canvas — 1 random rotation or
//      2 random shears, chosen per step — so the cube from the previous blit
//      (and every cube before it) is rotated/sheared onward
//   4. crop back down to the regular canvas resolution
//
// Equivalent-but-exact implementation: a stamp's final geometry is its
// placement pushed through the PRODUCT of all subsequent step transforms,
// so we pre-generate the seeded transform chain and draw each cube once,
// directly at its accumulated final position (no per-step re-rasterize).
//
// Container-native: node + chromium only, same DOM-dump pattern as
// scripts/frag-render.sh — no imagemagick, no screenshot races.
//
// Usage:
//   node scripts/hec-plaster.mjs <base.png> <stamp.png> <out.png> \
//        [count=256] [seed=112] [excl=x0,y0,x1,y1 (final-crop coords)] [crop=1200] \
//        [shadow.png (144x144, e.g. rasterized from resources/shaders/hec-cube-shadow.frag)]
import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { execFileSync } from "child_process";
import { join } from "path";
import { tmpdir } from "os";

const [, , base, stamp, out, countArg, seedArg, exclArg, cropArg, shadowArg] = process.argv;
if (!base || !stamp || !out) {
  console.error("usage: hec-plaster.mjs <base.png> <stamp.png> <out.png> [count] [seed] [excl=x0,y0,x1,y1] [crop]");
  process.exit(1);
}
const COUNT = Number(countArg ?? 256);
const SEED = Number(seedArg ?? 112);
const CROP = Number(cropArg ?? 1200);
// final-crop text keep-out rect (as measured on the rendered cover)
const EXCL = (exclArg ?? "55,470,1185,720").split(",").map(Number);
const b64 = (p) => readFileSync(p).toString("base64");
// shader-rasterized drop shadow (resources/shaders/hec-cube-shadow.frag):
// 144x144 cube-px units, hexagon centre baked 3px below the image centre
const SHADOW = shadowArg ? JSON.stringify(b64(shadowArg)) : "null";

// mulberry32 — tiny deterministic PRNG so re-runs are reproducible.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// canvas affine {a,b,c,d,e,f}: x' = a x + c y + e ; y' = b x + d y + f
const IDENT = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
// compose(A, B): apply B first, then A  →  A ∘ B
function compose(A, B) {
  return {
    a: A.a * B.a + A.c * B.b,
    b: A.b * B.a + A.d * B.b,
    c: A.a * B.c + A.c * B.d,
    d: A.b * B.c + A.d * B.d,
    e: A.e + A.a * B.e + A.c * B.f,
    f: A.f + A.b * B.e + A.d * B.f,
  };
}
// about-centre pivot: translate(C) ∘ lin ∘ translate(-C)
function aboutCenter(lin, cx, cy) {
  return {
    a: lin.a, b: lin.b, c: lin.c, d: lin.d,
    e: cx - (lin.a * cx + lin.c * cy),
    f: cy - (lin.b * cx + lin.d * cy),
  };
}
// largest singular-value bound of the linear part = worst-case stretch
function stretch(m) {
  return Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d));
}

const S = Math.ceil((CROP * Math.SQRT2 + 100) / 2) * 2; // 1200*√2 ≈ 1697 → S=1800

const html = `<!doctype html><meta charset="utf-8"><body></body><script>
const COUNT = ${COUNT}, SEED = ${SEED}, CROP = ${CROP}, S = ${S};
const EXCL = ${JSON.stringify(EXCL)}.map(v => v + (S - CROP) / 2);  // offset into work coords
function mulberry32(a){return function(){a|=0;a=(a+0x6d2b79f5)|0;let t=Math.imul(a^(a>>>15),1|a);t=(t+Math.imul(t^(t>>>7),61|t))^t;return((t^(t>>>14))>>>0)/4294967296;}}
const rand = mulberry32(SEED);
function load(src){return new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error("load "+src));i.src=src;});}
const deg = Math.PI / 180;
const IDENT = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
function compose(A, B) {   // apply B first, then A
  return {
    a: A.a * B.a + A.c * B.b, b: A.b * B.a + A.d * B.b,
    c: A.a * B.c + A.c * B.d, d: A.b * B.c + A.d * B.d,
    e: A.e + A.a * B.e + A.c * B.f, f: A.f + A.b * B.e + A.d * B.f,
  };
}
function aboutCenter(lin, cx, cy) {
  return { a: lin.a, b: lin.b, c: lin.c, d: lin.d,
           e: cx - (lin.a * cx + lin.c * cy), f: cy - (lin.b * cx + lin.d * cy) };
}
function stretch(m) {
  return Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d));
}

(async () => {
  try {
    const [baseImg, stampImg, shadowImg] = await Promise.all([
      load("data:image/png;base64,${b64(base)}"),
      load("data:image/png;base64,${b64(stamp)}"),
      ${SHADOW} ? load("data:image/png;base64," + ${SHADOW}) : Promise.resolve(null),
    ]);

    // ---- hexagon alpha mask (per-vertex ray-cast fit against the black bg)
    const half = stampImg.width / 2;
    const off = document.createElement("canvas");
    off.width = off.height = stampImg.width;
    const oc = off.getContext("2d", { willReadFrequently: true });
    oc.drawImage(stampImg, 0, 0);
    const px = oc.getImageData(0, 0, off.width, off.height).data;
    const brightAt = (x, y) => {
      if (x < 0 || y < 0 || x >= off.width || y >= off.height) return -1;
      const i = ((y | 0) * off.width + (x | 0)) * 4;
      return px[i] + px[i + 1] + px[i + 2];
    };
    const Rv = [];
    for (let k = 0; k < 6; k++) {
      const a = deg * (30 + 60 * k);
      let r = 0;
      for (let t = off.width * 0.71; t > 0; t -= 0.25) {
        const v = brightAt(half + Math.cos(a) * t, half + Math.sin(a) * t);
        if (v < 0) continue;
        if (v > 45) { r = t; break; }
      }
      Rv.push(r);
    }
    if (Math.min(...Rv) > 0) {
      oc.globalCompositeOperation = "destination-in";
      oc.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = deg * (30 + 60 * k);
        const hx = half + Math.cos(a) * Rv[k], hy = half + Math.sin(a) * Rv[k];
        k ? oc.lineTo(hx, hy) : oc.moveTo(hx, hy);
      }
      oc.closePath();
      oc.fillStyle = "#fff";
      oc.fill();
    }
    const stamp = Math.min(...Rv) > 0 ? off : stampImg;

    // ---- 1. greater canvas: diagonal-to-diagonal safe; the cover sits 1:1
    // CENTRED, with a padding ring around it that absorbs transform bleed —
    // the centre CROP x CROP area then corresponds exactly to the original
    // cover, so the centre text lands back where it belongs.
    const work = document.createElement("canvas");
    work.width = work.height = S;
    const ctx = work.getContext("2d");
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, S, S);
    ctx.imageSmoothingQuality = "high";
    const off0 = (S - CROP) / 2;
    ctx.drawImage(baseImg, off0, off0, CROP, CROP);

    // ---- transform chain: m_i per step — ROTATION ONLY (±30°, cloud-style).
    // Products of rotations are pure rotations, so the accumulated stretch
    // stays exactly 1: previous blits spin onward but never smear into ribbons.
    const cx = S / 2, cy = S / 2;
    const steps = [];
    for (let i = 0; i < COUNT; i++) {
      const t = (rand() * 60 - 30) * deg;             // ±30° rotation
      const lin = { a: Math.cos(t), b: Math.sin(t), c: -Math.sin(t), d: Math.cos(t) };
      steps.push(aboutCenter(lin, cx, cy));
    }
    // suffix products: P[i] = m_{i+1} ∘ … ∘ m_N ∘ m_i  (m_i first — the step's
    // own transform also hits the cube just blitted, as in cloud-step)
    const P = new Array(COUNT);
    let acc = IDENT;
    for (let i = COUNT - 1; i >= 0; i--) {
      acc = compose(acc, steps[i]);
      P[i] = acc;
    }

    // ---- 2+3. throw cubes directly at their final accumulated positions
    const margin = 6;
    const okSpot = (qx, qy, r) => {
      if (qx - r < 0 || qy - r < 0 || qx + r > S || qy + r > S) return false;
      return qx + r < EXCL[0] - margin || qx - r > EXCL[2] + margin ||
             qy + r < EXCL[1] - margin || qy - r > EXCL[3] + margin;
    };
    let placed = 0, tries = 0;
    while (placed < COUNT && tries < COUNT * 300) {
      tries++;
      const i = placed;
      const m = P[i];
      const st = stretch(m);
      // smaller cubes (a tad), slightly damped when the chain is violent
      const s = (0.55 + rand() * 0.4) / Math.max(1, Math.sqrt(st));
      const rot = rand() * Math.PI * 2;
      // shadow allowance: offset 3px + ~2.5σ gaussian tail, all cube px
      const r = (half * Math.SQRT2 + 14) * s * st;   // rotation-accounted circle
      const qx = r + rand() * (S - 2 * r);
      const qy = r + rand() * (S - 2 * r);
      if (!okSpot(qx, qy, r)) continue;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.translate(qx, qy);
      ctx.transform(m.a, m.b, m.c, m.d, 0, 0);   // accumulated step transforms
      ctx.rotate(rot);
      ctx.scale(s, s);
      ctx.shadowColor = "rgba(0,0,0,0)";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
      if (shadowImg) {
        // shader-rasterized shadow under the cube: the hexagon centre inside
        // the png is baked 3px below the image centre, so a centered draw
        // puts it exactly under the cube — and it rotates/scales along with it
        ctx.drawImage(shadowImg, -shadowImg.width / 2, -shadowImg.height / 2);
      }
      ctx.drawImage(stamp, -half, -half);
      ctx.restore();
      placed++;
    }

    // ---- 4. crop back down to the regular canvas resolution
    const cv = document.createElement("canvas");
    cv.width = cv.height = CROP;
    const cc = cv.getContext("2d");
    cc.drawImage(work, -(S - CROP) / 2, -(S - CROP) / 2);

    document.body.textContent = "DATAURL:" + cv.toDataURL("image/png")
      + "|PLACED:" + placed + "/" + COUNT
      + "|HEXR:" + Rv.map((r) => r.toFixed(1)).join(",")
      + "|S:" + S + "|EXCL:" + EXCL.map((v) => v.toFixed(0)).join(",");
  } catch (e) {
    document.body.textContent = "RENDER_ERROR:" + e.message;
  }
})();
</script>`;

const dir = mkdtempSync(join(tmpdir(), "hec-plaster-"));
const page = join(dir, "plaster.html");
const dom = join(dir, "dom.html");
writeFileSync(page, html);

const CHROME = process.env.CHROME_BIN ||
  ["google-chrome", "chromium", "chromium-browser"].map((c) => {
    try { return execFileSync("which", [c], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return null; }
  }).find(Boolean);
if (!CHROME) { console.error("no chromium found (set CHROME_BIN)"); process.exit(1); }

execFileSync(CHROME, [
  "--headless", "--disable-gpu", "--no-sandbox",
  "--virtual-time-budget=10000", "--dump-dom", "file://" + page,
], { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 28 })
  .toString()
  .replace(/<[^>]*>/g, "")
  .split("\n")
  .forEach((line) => {
    const m = line.match(/DATAURL:data:image\/png;base64,([A-Za-z0-9+/=]+)\|PLACED:(\d+)\/(\d+)\|HEXR:([\d.,]+)\|S:(\d+)\|EXCL:([\d,]+)/);
    if (!m) return;
    const png = Buffer.from(m[1], "base64");
    if (png.length < 24 || png.toString("ascii", 1, 4) !== "PNG") {
      console.error("render failed: output is not a valid PNG"); process.exit(1);
    }
    writeFileSync(out, png);
    console.log(`wrote ${out} (${png.readUInt32BE(16)}x${png.readUInt32BE(20)}), ` +
      `placed ${m[2]}/${m[3]} stamps, hexagon R=[${m[4]}], canvas ${m[5]}, excl ${m[6]} (work coords)`);
    process.exit(0);
  });
console.error("render failed: no dataURL in DOM dump (chromium crashed?)");
process.exit(1);
