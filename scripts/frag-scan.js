/**
 * frag-scan.js — Frag Bench: client-side WebGL renderer for live .frag shaders.
 *
 * Served at http://localhost:8899/frag by serve.mjs. Lists resources/shaders/
 * via /api/shaders, re-renders on SSE {shaders:1} events (server watches the
 * folder), and shows each shader as a draggable PNG swatch (or an error card
 * with the compile/link log when the agent wrote broken GLSL).
 *
 * Drag-out is native: the swatch is a real <img> backed by a blob URL, so
 * Chromium honours the DownloadURL hint and Firefox serializes the image on
 * drop — no JS drag-and-drop overrides. A per-swatch "save" anchor exists as
 * a fallback for browsers whose file-manager drag needs help.
 *
 * GL context policy: alpha:false (opaque fills — shader textures composite
 * predictably in the layout pipeline; a shader that wants transparency must
 * be exported and cut, not blended here).
 */
export class FragBench {
  constructor(width = 1024, height = 1024) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;
    this.lost = false;
    this.canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.lost = true;
    });
    this.canvas.addEventListener("webglcontextrestored", () => {
      this.#initGL();
      this.lost = false;
    });
    this.#initGL();
  }

  #initGL() {
    this.gl = this.canvas.getContext("webgl2", {
      preserveDrawingBuffer: true,
      alpha: false, // opaque fills; see header note
    });
    if (this.gl) this.#setupQuad();
  }

  #setupQuad() {
    const gl = this.gl;
    // Fullscreen triangle (faster and cleaner than two triangles).
    const vs = `#version 300 es
      in vec2 pos;
      void main() { gl_Position = vec4(pos, 0.0, 1.0); }`;
    this.vShader = this.compile(gl.VERTEX_SHADER, vs);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  }

  compile(type, src) {
    const gl = this.gl;
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const err = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(err);
    }
    return s;
  }

  // Deterministic seed: the same shader name always previews as the same
  // texture (no gallery flicker on re-render); explicit seed overrides.
  seedFrom(name) {
    let h = 0x811c9dc5; // FNV-1a
    for (let i = 0; i < name.length; i++) {
      h ^= name.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return (h % 10000) / 100;
  }

  // Turns .frag code into a draggable PNG swatch, or an error card with the
  // compile/link log if the agent wrote broken GLSL.
  // Returns { name, img, dataUrl } on success or { name, error } on failure.
  async renderToImage(name, fragSource, opts = {}) {
    const { time = 0.0, seed, width, height } = opts;
    if (this.lost || !this.gl) return { name, error: "WebGL context lost — waiting for restore" };

    const gl = this.gl;
    if (width) this.canvas.width = width;   // per-render size override
    if (height) this.canvas.height = height;

    const prog = gl.createProgram();
    let fShader = null;
    gl.attachShader(prog, this.vShader);

    try {
      fShader = this.compile(gl.FRAGMENT_SHADER, fragSource);
      gl.attachShader(prog, fShader);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        const err = gl.getProgramInfoLog(prog);
        throw new Error(`link error:\n${err}`);
      }
      gl.useProgram(prog);

      const loc = gl.getAttribLocation(prog, "pos");
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      // Base uniforms (null locations are silently ignored by GL).
      gl.uniform2f(gl.getUniformLocation(prog, "u_resolution"), this.canvas.width, this.canvas.height);
      gl.uniform1f(gl.getUniformLocation(prog, "u_time"), time);
      gl.uniform1f(gl.getUniformLocation(prog, "u_seed"), seed ?? this.seedFrom(name));

      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      const blob = await new Promise((res) => this.canvas.toBlob(res, "image/png"));
      if (!blob) throw new Error("canvas.toBlob returned null");
      const url = URL.createObjectURL(blob);

      const img = document.createElement("img");
      img.src = url;
      img.alt = name;
      img.draggable = true;

      // Native drag-out hint for Chromium (Firefox drags <img> natively).
      const cleanName = name.replace(/\.frag$/, "") + ".png";
      img.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("DownloadURL", `image/png:${cleanName}:${url}`);
      });

      // The blob URL outlives this render (the <img> needs it); hand the
      // caller a dataURL too for server-assisted saving.
      return { name, img, dataUrl: this.canvas.toDataURL("image/png") };
    } catch (err) {
      return { name, error: err.message };
    } finally {
      if (fShader) {
        gl.detachShader(prog, fShader);
        gl.deleteShader(fShader); // no shader leak across re-renders
      }
      gl.deleteProgram(prog);
    }
  }
}

// ---- Bench UI --------------------------------------------------------------
// (auto-runs when the page loads; frag.html provides #bench)
const bench = new FragBench(1024, 1024);
const grid = document.getElementById("bench");
const status = document.getElementById("bench-status");
const cache = new Map(); // name -> { mtime, node }

function card(node, name, extra) {
  const el = document.createElement("div");
  el.className = "swatch";
  el.append(node, extra);
  return el;
}

function swatchFor(name, source, mtime) {
  const wrap = document.createElement("div");
  wrap.className = "swatch-wrap";
  const label = document.createElement("div");
  label.className = "swatch-label";
  label.textContent = name + " · seed=" + bench.seedFrom(name).toFixed(2);
  wrap.append(label);

  bench.renderToImage(name, source).then((r) => {
    if (r.error) {
      const errBox = document.createElement("pre");
      errBox.className = "frag-error";
      errBox.textContent = `[${r.name}]\n${r.error}`;
      wrap.append(errBox);
    } else {
      const cardEl = document.createElement("div");
      cardEl.className = "swatch";
      // Native drag: the <img> itself; save fallback for stubborn browsers.
      const save = document.createElement("a");
      save.href = r.dataUrl;
      save.download = r.name.replace(/\.frag$/, "") + ".png";
      save.className = "swatch-save";
      save.textContent = "Save As";
      const post = document.createElement("a");
      post.className = "swatch-save";
      post.textContent = "→ fragments";
      post.onclick = async () => {
        const res = await fetch("/api/fragments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: r.name.replace(/\.frag$/, ""),
            dataUrl: r.dataUrl,
          }),
        });
        post.textContent = res.ok ? "✓ dropped" : "✗ failed";
        setTimeout(() => (post.textContent = "→ fragments"), 1500);
      };
      cardEl.append(r.img, save, post);
      wrap.append(cardEl);
    }
  });
  return wrap;
}

async function refreshShaders() {
  let shaders = [];
  try {
    shaders = await (await fetch("/api/shaders")).json();
  } catch {
    status.textContent = "server unreachable";
    return;
  }
  const seen = new Set();
  for (const { name, mtime } of shaders) {
    seen.add(name);
    const prev = cache.get(name);
    if (prev && prev.mtime === mtime) continue; // unchanged
    if (prev) prev.node.remove();
    try {
      const src = await (await fetch("/resources/shaders/" + name)).text();
      const node = swatchFor(name, src, mtime);
      cache.set(name, { mtime, node });
      grid.appendChild(node);
    } catch (e) {
      status.textContent = "fetch failed: " + name;
    }
  }
  for (const [name, prev] of cache)
    if (!seen.has(name)) {
      prev.node.remove();
      cache.delete(name);
    }
  status.textContent = `${shaders.length} shader(s) — drag a swatch to your file manager, or "→ fragments"`;
}

// Live updates: the server watches resources/shaders/ and pushes {shaders:1}.
const es = new EventSource("/cloud/events");
es.onmessage = (e) => {
  if (!e.data) return;
  const d = JSON.parse(e.data);
  if (d.shaders) refreshShaders();
};
es.onopen = () => refreshShaders();
es.onerror = () => (status.textContent = "event stream down — retrying");
