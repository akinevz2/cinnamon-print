/* pngio.mjs — minimal 8-bit RGBA PNG codec built on node's zlib.
 *
 * The container ships no image CLI (no ImageMagick) and no npm deps, but node
 * has zlib — so pixel work in cinnamon-print scripts (e.g. trace-cutout.mjs)
 * decodes and encodes PNGs through this module instead.
 *
 * decode(file)  -> { w, h, rgba: Uint8Array(w*h*4) }   straight alpha
 *                 reads 8-bit depth, color types 0 (grey), 2 (RGB), 3 (palette
 *                 + optional tRNS) and 6 (RGBA); non-interlaced only.
 * encode(file, w, h, rgba)  — straight-alpha RGBA, filter 0 scanlines.
 */
import fs from "fs";
import zlib from "zlib";

// ---- CRC32 ------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const PAETH = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

export function decode(file) {
  const b = fs.readFileSync(file);
  if (b.toString("ascii", 1, 4) !== "PNG") throw new Error("not a PNG");
  let off = 8, w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idats = [];
  let palette = null, trns = null;
  while (off < b.length) {
    const len = b.readUInt32BE(off);
    const type = b.toString("ascii", off + 4, off + 8);
    const data = b.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === "IDAT") idats.push(data);
    else if (type === "PLTE") palette = Buffer.from(data);
    else if (type === "tRNS") trns = Buffer.from(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`);
  if (interlace) throw new Error("interlaced PNG unsupported");
  const ch = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 0 ? 1 : colorType === 3 ? 1 : -1;
  if (ch < 0) throw new Error(`unsupported color type ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idats));
  const stride = w * ch;
  const recon = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      // first PIXEL of the line has no left/top-left neighbour (x < ch, NOT x%ch)
      const a = x < ch ? 0 : recon[dst + x - ch];
      const c = y === 0 || x < ch ? 0 : recon[dst - stride + x - ch];
      const bb = y === 0 ? 0 : recon[dst - stride + x];
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += bb;
      else if (f === 3) v += (a + bb) >> 1;
      else if (f === 4) v += PAETH(a, bb, c);
      recon[dst + x] = v & 0xff;
    }
  }
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    if (colorType === 6) { rgba.set(recon.subarray(i * 4, i * 4 + 4), i * 4); }
    else if (colorType === 2) {
      rgba[i * 4] = recon[i * 3]; rgba[i * 4 + 1] = recon[i * 3 + 1]; rgba[i * 4 + 2] = recon[i * 3 + 2]; rgba[i * 4 + 3] = 255;
    } else if (colorType === 0) {
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = recon[i]; rgba[i * 4 + 3] = 255;
    } else if (colorType === 3) {
      const pi = recon[i] * 3;
      rgba[i * 4] = palette[pi]; rgba[i * 4 + 1] = palette[pi + 1]; rgba[i * 4 + 2] = palette[pi + 2];
      rgba[i * 4 + 3] = trns && pi / 3 < trns.length ? trns[pi / 3] : 255;
    }
  }
  return { w, h, rgba };
}

export function encode(file, w, h, rgba) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]));
}
