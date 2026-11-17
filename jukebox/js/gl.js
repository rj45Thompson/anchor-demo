// The WebGL 2 backend. Draws the scene's quad and line buffers additively into a
// half-float target, then tone maps that to the canvas, so hundreds of overlapping
// neon shapes glow instead of clipping to white.
//
// gpu.js is the same scene in WGSL. The shape functions below are duplicated there
// line for line: change one, change both, or the two backends stop matching.
import { LINE_FLOATS, QUAD_FLOATS } from "./scene.js";

export const EXPOSURE = 1.25;

// uv runs -1..1 across a quad. Kept in one string so the two shaders in this file
// share it, and so it can be compared against the WGSL by eye.
const GL_SHAPES = `
float shapeAlpha(vec2 uv, float style) {
  float r = length(uv);
  if (style < 0.5) {                      // flat: a soft-edged panel
    float d = max(abs(uv.x), abs(uv.y));
    return smoothstep(1.0, 0.72, d);
  } else if (style < 1.5) {               // gem: a diamond with a bright rim
    float m = abs(uv.x) + abs(uv.y);
    return smoothstep(1.05, 0.92, m) * 0.85
         + smoothstep(0.55, 0.0, m) * 0.5
         + smoothstep(0.10, 0.0, abs(m - 0.95)) * 1.6;
  } else if (style < 2.5) {               // ring: the fret target
    return smoothstep(0.13, 0.0, abs(r - 0.78)) * 1.5
         + smoothstep(1.0, 0.55, r) * 0.18;
  } else if (style < 3.5) {               // glow: a hit blooming
    return exp(-r * r * 2.6) * 1.2;
  }
  return smoothstep(1.0, 0.80, abs(uv.x)) * smoothstep(1.0, 0.35, abs(uv.y)); // bar
}`;

const QUAD_VS = `#version 300 es
precision highp float;
uniform mat4 vp;
layout(location=0) in vec3 centre;
layout(location=1) in vec3 right;
layout(location=2) in vec3 up;
layout(location=3) in vec3 colour;
layout(location=4) in float glow;
layout(location=5) in float style;
out vec2 vUv; out vec3 vCol; out float vGlow; out float vStyle;
const vec2 q[4] = vec2[4](vec2(-1,-1), vec2(1,-1), vec2(-1,1), vec2(1,1));
void main() {
  vec2 c = q[gl_VertexID];
  vUv = c; vCol = colour; vGlow = glow; vStyle = style;
  gl_Position = vp * vec4(centre + right * c.x + up * c.y, 1.0);
}`;

const QUAD_FS = `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vCol; in float vGlow; in float vStyle;
out vec4 outColour;
${GL_SHAPES}
void main() { outColour = vec4(vCol * shapeAlpha(vUv, vStyle) * vGlow, 1.0); }`;

// A line is a quad expanded in screen space, so its width is in pixels and does not
// thin out into the distance.
const LINE_VS = `#version 300 es
precision highp float;
uniform mat4 vp; uniform vec2 res;
layout(location=0) in vec3 a;
layout(location=1) in vec3 b;
layout(location=2) in vec3 colour;
layout(location=3) in float width;
layout(location=4) in float glow;
out float vSide; out vec3 vCol; out float vGlow;
const vec2 q[4] = vec2[4](vec2(0,-1), vec2(1,-1), vec2(0,1), vec2(1,1));
void main() {
  vec2 c = q[gl_VertexID];
  vSide = c.y; vCol = colour; vGlow = glow;
  vec4 ca = vp * vec4(a, 1.0), cb = vp * vec4(b, 1.0);
  const float n = 0.5;
  if (ca.w < n && cb.w < n) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  if (ca.w < n) ca = mix(ca, cb, (n - ca.w) / (cb.w - ca.w));
  if (cb.w < n) cb = mix(cb, ca, (n - cb.w) / (ca.w - cb.w));
  vec2 d = (cb.xy / cb.w - ca.xy / ca.w) * res;
  float l = length(d);
  d = l < 0.001 ? vec2(1.0, 0.0) : d / l;
  vec2 off = vec2(-d.y, d.x) * c.y * (width + 1.0) / res * 2.0;
  vec4 p = mix(ca, cb, c.x);
  gl_Position = p + vec4(off * p.w, 0.0, 0.0);
}`;

const LINE_FS = `#version 300 es
precision highp float;
in float vSide; in vec3 vCol; in float vGlow;
out vec4 outColour;
void main() { outColour = vec4(vCol * smoothstep(1.0, 0.15, abs(vSide)) * vGlow, 1.0); }`;

const PRESENT_VS = `#version 300 es
precision highp float;
const vec2 q[3] = vec2[3](vec2(-1,-1), vec2(3,-1), vec2(-1,3));
void main() { gl_Position = vec4(q[gl_VertexID], 0.0, 1.0); }`;

const PRESENT_FS = `#version 300 es
precision highp float;
uniform sampler2D hdr; uniform float exposure;
out vec4 outColour;
void main() {
  vec3 c = texelFetch(hdr, ivec2(gl_FragCoord.xy), 0).rgb;
  vec3 mapped = vec3(1.0) - exp(-c * exposure);
  // A touch of dither, so a dark sky does not band.
  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  outColour = vec4(mapped + vec3(n / 255.0), 1.0);
}`;

function compile(gl, type, src, what) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(`${what} did not compile: ${gl.getShaderInfoLog(sh)}`);
  }
  return sh;
}

function program(gl, vs, fs, what) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs, `${what} vertex shader`));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs, `${what} fragment shader`));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`${what} did not link: ${gl.getProgramInfoLog(p)}`);
  }
  return p;
}

// attributes: [location, floats, floatOffset][]
function instanceBuffer(gl, stride, attributes) {
  const vao = gl.createVertexArray();
  const buf = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  for (const [loc, size, offset] of attributes) {
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride * 4, offset * 4);
    gl.vertexAttribDivisor(loc, 1);
  }
  gl.bindVertexArray(null);
  return { vao, buf, capacity: 0 };
}

function upload(gl, target, floats) {
  gl.bindBuffer(gl.ARRAY_BUFFER, target.buf);
  if (floats.length > target.capacity) {
    gl.bufferData(gl.ARRAY_BUFFER, floats, gl.DYNAMIC_DRAW);
    target.capacity = floats.length;
  } else {
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, floats);
  }
}

export async function createGlBackend(canvas) {
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, powerPreference: "high-performance" });
  if (!gl) throw new Error("this browser has no WebGL 2");
  // The float target is what lets the glow add up; without it the neon clips.
  const float = gl.getExtension("EXT_color_buffer_float");
  if (!float) throw new Error("this browser's WebGL 2 cannot render to a float target (EXT_color_buffer_float)");
  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); backend.lost = "the WebGL context was lost"; });

  const quadProg = program(gl, QUAD_VS, QUAD_FS, "the quad");
  const lineProg = program(gl, LINE_VS, LINE_FS, "the line");
  const presentProg = program(gl, PRESENT_VS, PRESENT_FS, "the present");
  const quads = instanceBuffer(gl, QUAD_FLOATS, [[0, 3, 0], [1, 3, 3], [2, 3, 6], [3, 3, 9], [4, 1, 12], [5, 1, 13]]);
  const lines = instanceBuffer(gl, LINE_FLOATS, [[0, 3, 0], [1, 3, 3], [2, 3, 6], [3, 1, 9], [4, 1, 10]]);
  const u = {
    quadVp: gl.getUniformLocation(quadProg, "vp"),
    lineVp: gl.getUniformLocation(lineProg, "vp"),
    lineRes: gl.getUniformLocation(lineProg, "res"),
    hdr: gl.getUniformLocation(presentProg, "hdr"),
    exposure: gl.getUniformLocation(presentProg, "exposure"),
  };
  const emptyVao = gl.createVertexArray();

  let fbo = null, tex = null, texW = 0, texH = 0;
  function sizeTarget(w, h) {
    if (w === texW && h === texH) return;
    if (tex) { gl.deleteTexture(tex); gl.deleteFramebuffer(fbo); }
    tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (ok !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`the float target is not usable (status ${ok})`);
    texW = w; texH = h;
  }

  const backend = {
    name: "WebGL 2",
    depth01: false,                  // WebGL clip space runs z in -1..1
    lost: null,
    info: gl.getExtension("WEBGL_debug_renderer_info")
      ? gl.getParameter(gl.getExtension("WEBGL_debug_renderer_info").UNMASKED_RENDERER_WEBGL)
      : "WebGL 2",
    draw(scene, vp, width, height) {
      if (backend.lost) return;
      sizeTarget(width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, width, height);
      gl.disable(gl.DEPTH_TEST);
      gl.clearColor(0.004, 0.006, 0.016, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      // Additive: every shape only ever brightens what is under it.
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);

      if (scene.lines.count > 0) {
        gl.useProgram(lineProg);
        gl.uniformMatrix4fv(u.lineVp, false, vp);
        gl.uniform2f(u.lineRes, width, height);
        gl.bindVertexArray(lines.vao);
        upload(gl, lines, scene.lines.bytes);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, scene.lines.count);
      }
      if (scene.quads.count > 0) {
        gl.useProgram(quadProg);
        gl.uniformMatrix4fv(u.quadVp, false, vp);
        gl.bindVertexArray(quads.vao);
        upload(gl, quads, scene.quads.bytes);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, scene.quads.count);
      }

      // Tone map onto the canvas.
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.disable(gl.BLEND);
      gl.useProgram(presentProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(u.hdr, 0);
      gl.uniform1f(u.exposure, EXPOSURE);
      gl.bindVertexArray(emptyVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    },
    destroy() {
      if (tex) { gl.deleteTexture(tex); gl.deleteFramebuffer(fbo); }
      for (const p of [quadProg, lineProg, presentProg]) gl.deleteProgram(p);
    },
  };
  return backend;
}
