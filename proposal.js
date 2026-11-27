class FragBench {
  constructor(width = 1024, height = 1024) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.gl = this.canvas.getContext('webgl2', { preserveDrawingBuffer: true });
    this.setupQuad();
  }

  setupQuad() {
    const gl = this.gl;
    // Полноэкранный треугольник (быстрее и чище, чем два треугольника)
    const vs = `#version 300 es
      in vec2 pos;
      void main() { gl_Position = vec4(pos, 0.0, 1.0); }`;
    this.vShader = this.compile(gl.VERTEX_SHADER, vs);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
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

  // Превращает .frag код в готовый draggable <img> или карточку с ошибкой компиляции
  async renderToImage(name, fragSource, uniforms = {}) {
    const gl = this.gl;
    const prog = gl.createProgram();
    gl.attachShader(prog, this.vShader);

    try {
      const fShader = this.compile(gl.FRAGMENT_SHADER, fragSource);
      gl.attachShader(prog, fShader);
      gl.linkProgram(prog);
      gl.useProgram(prog);

      const loc = gl.getAttribLocation(prog, 'pos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      // Базовые uniform-ы
      gl.uniform2f(gl.getUniformLocation(prog, 'u_resolution'), this.canvas.width, this.canvas.height);
      gl.uniform1f(gl.getUniformLocation(prog, 'u_time'), uniforms.time ?? 0.0);
      gl.uniform1f(gl.getUniformLocation(prog, 'u_seed'), uniforms.seed ?? Math.random() * 100);

      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      const blob = await new Promise(res => this.canvas.toBlob(res, 'image/png'));
      const url = URL.createObjectURL(blob);

      const img = document.createElement('img');
      img.src = url;
      img.alt = name;
      img.draggable = true;

      // Магия для прямого перетаскивания из браузера в папку ./resources в ОС (Chrome/Edge)
      img.addEventListener('dragstart', (e) => {
        const cleanName = name.replace(/\.frag$/, '') + '.png';
        e.dataTransfer.setData('DownloadURL', `image/png:${cleanName}:${url}`);
      });

      return img;
    } catch (err) {
      // Если OpenCode написал битый шейдер — вернём карточку с логом ошибки вместо падения
      const errBox = document.createElement('pre');
      errBox.className = 'frag-error';
      errBox.textContent = `[${name}]\n${err.message}`;
      return errBox;
    } finally {
      gl.deleteProgram(prog);
    }
  }
}

