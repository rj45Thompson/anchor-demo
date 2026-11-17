// The WebGPU backend. Same scene, same look, same two draw calls as gl.js: quads and
// lines added into an rgba16float target, then tone mapped onto the canvas.
//
// The shape functions are gl.js's GL_SHAPES transliterated into WGSL. They must stay
// identical, or the two backends stop showing the same picture.
import { LINE_FLOATS, QUAD_FLOATS } from "./scene.js";
import { EXPOSURE } from "./gl.js";

const HDR_FORMAT = "rgba16float";
// vp (64) + res (8) + time (4) + exposure (4) = 80, which is already a multiple of 16.
const UNIFORM_BYTES = 80;

const SHAPES = `
fn shapeAlpha(uv: vec2f, style: f32) -> f32 {
  let r = length(uv);
  if (style < 0.5) {                      // flat: a soft-edged panel
    let d = max(abs(uv.x), abs(uv.y));
    return smoothstep(1.0, 0.72, d);
  } else if (style < 1.5) {               // gem: a diamond with a bright rim
    let m = abs(uv.x) + abs(uv.y);
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

const COMMON = `
struct U { vp: mat4x4f, res: vec2f, time: f32, exposure: f32 };
@group(0) @binding(0) var<uniform> u: U;`;

const QUAD_WGSL = COMMON + SHAPES + `
struct QO {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) col: vec3f,
  @location(2) glow: f32,
  @location(3) style: f32,
};
@vertex fn vs(@builtin(vertex_index) i: u32,
              @location(0) centre: vec3f, @location(1) right: vec3f, @location(2) up: vec3f,
              @location(3) col: vec3f, @location(4) glow: f32, @location(5) style: f32) -> QO {
  var q = array<vec2f, 4>(vec2f(-1, -1), vec2f(1, -1), vec2f(-1, 1), vec2f(1, 1));
  let c = q[i];
  var o: QO;
  o.uv = c; o.col = col; o.glow = glow; o.style = style;
  o.pos = u.vp * vec4f(centre + right * c.x + up * c.y, 1.0);
  return o;
}
@fragment fn fs(i: QO) -> @location(0) vec4f {
  return vec4f(i.col * shapeAlpha(i.uv, i.style) * i.glow, 1.0);
}`;

const LINE_WGSL = COMMON + `
struct LO {
  @builtin(position) pos: vec4f,
  @location(0) side: f32,
  @location(1) col: vec3f,
  @location(2) glow: f32,
};
@vertex fn vs(@builtin(vertex_index) i: u32,
              @location(0) a: vec3f, @location(1) b: vec3f, @location(2) col: vec3f,
              @location(3) width: f32, @location(4) glow: f32) -> LO {
  var q = array<vec2f, 4>(vec2f(0, -1), vec2f(1, -1), vec2f(0, 1), vec2f(1, 1));
  let c = q[i];
  var o: LO;
  o.side = c.y; o.col = col; o.glow = glow;
  var ca = u.vp * vec4f(a, 1.0);
  var cb = u.vp * vec4f(b, 1.0);
  let n = 0.5;
  if (ca.w < n && cb.w < n) { o.pos = vec4f(2.0, 2.0, 2.0, 1.0); return o; }
  if (ca.w < n) { ca = mix(ca, cb, (n - ca.w) / (cb.w - ca.w)); }
  if (cb.w < n) { cb = mix(cb, ca, (n - cb.w) / (ca.w - cb.w)); }
  var d = (cb.xy / cb.w - ca.xy / ca.w) * u.res;
  let l = length(d);
  if (l < 0.001) { d = vec2f(1.0, 0.0); } else { d = d / l; }
  let off = vec2f(-d.y, d.x) * c.y * (width + 1.0) / u.res * 2.0;
  let p = mix(ca, cb, c.x);
  o.pos = p + vec4f(off * p.w, 0.0, 0.0);
  return o;
}
@fragment fn fs(i: LO) -> @location(0) vec4f {
  return vec4f(i.col * smoothstep(1.0, 0.15, abs(i.side)) * i.glow, 1.0);
}`;

const PRESENT_WGSL = `
@group(0) @binding(0) var hdr: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  var q = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
  return vec4f(q[i], 0.0, 1.0);
}
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f {
  let c = textureLoad(hdr, vec2i(p.xy), 0).rgb;
  let mapped = vec3f(1.0) - exp(-c * ${EXPOSURE.toFixed(3)});
  let n = fract(sin(dot(p.xy, vec2f(12.9898, 78.233))) * 43758.5453) - 0.5;
  return vec4f(mapped + vec3f(n / 255.0), 1.0);
}`;

const ADD = {
  color: { srcFactor: "one", dstFactor: "one", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
};

export async function createGpuBackend(canvas) {
  if (!navigator.gpu) throw new Error("this browser has no WebGPU (navigator.gpu is missing)");
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("the browser gave the page no WebGPU adapter (see chrome://gpu)");
  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu");
  if (!context) throw new Error("this canvas gave no webgpu context");
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "opaque" });

  const quadModule = device.createShaderModule({ code: QUAD_WGSL, label: "jukebox quads" });
  const lineModule = device.createShaderModule({ code: LINE_WGSL, label: "jukebox lines" });
  const presentModule = device.createShaderModule({ code: PRESENT_WGSL, label: "jukebox present" });

  const uniform = device.createBuffer({ size: UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const sceneLayout = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } }],
  });
  const sceneBind = device.createBindGroup({ layout: sceneLayout, entries: [{ binding: 0, resource: { buffer: uniform } }] });
  const presentLayout = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "unfilterable-float" } }],
  });

  const f32 = (n) => n * 4;
  const quadPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [sceneLayout] }),
    vertex: {
      module: quadModule, entryPoint: "vs",
      buffers: [{
        arrayStride: f32(QUAD_FLOATS), stepMode: "instance",
        attributes: [
          { shaderLocation: 0, offset: f32(0), format: "float32x3" },
          { shaderLocation: 1, offset: f32(3), format: "float32x3" },
          { shaderLocation: 2, offset: f32(6), format: "float32x3" },
          { shaderLocation: 3, offset: f32(9), format: "float32x3" },
          { shaderLocation: 4, offset: f32(12), format: "float32" },
          { shaderLocation: 5, offset: f32(13), format: "float32" },
        ],
      }],
    },
    fragment: { module: quadModule, entryPoint: "fs", targets: [{ format: HDR_FORMAT, blend: ADD }] },
    primitive: { topology: "triangle-strip" },
  });
  const linePipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [sceneLayout] }),
    vertex: {
      module: lineModule, entryPoint: "vs",
      buffers: [{
        arrayStride: f32(LINE_FLOATS), stepMode: "instance",
        attributes: [
          { shaderLocation: 0, offset: f32(0), format: "float32x3" },
          { shaderLocation: 1, offset: f32(3), format: "float32x3" },
          { shaderLocation: 2, offset: f32(6), format: "float32x3" },
          { shaderLocation: 3, offset: f32(9), format: "float32" },
          { shaderLocation: 4, offset: f32(10), format: "float32" },
        ],
      }],
    },
    fragment: { module: lineModule, entryPoint: "fs", targets: [{ format: HDR_FORMAT, blend: ADD }] },
    primitive: { topology: "triangle-strip" },
  });
  const presentPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [presentLayout] }),
    vertex: { module: presentModule, entryPoint: "vs" },
    fragment: { module: presentModule, entryPoint: "fs", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });

  // Instance buffers that grow with the busiest frame so far.
  function growable(usage) {
    return { buffer: null, bytes: 0, usage };
  }
  const quadBuf = growable(GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);
  const lineBuf = growable(GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);
  function write(target, floats) {
    const needed = floats.byteLength;
    if (needed === 0) return;
    if (!target.buffer || target.bytes < needed) {
      if (target.buffer) target.buffer.destroy();
      // Round up, so a chart does not reallocate every frame it gets busier.
      target.bytes = Math.max(needed, Math.ceil(needed * 1.5 / 256) * 256);
      target.buffer = device.createBuffer({ size: target.bytes, usage: target.usage });
    }
    device.queue.writeBuffer(target.buffer, 0, floats.buffer, floats.byteOffset, needed);
  }

  let hdr = null, hdrView = null, hdrBind = null, texW = 0, texH = 0;
  function sizeTarget(w, h) {
    if (w === texW && h === texH) return;
    if (hdr) hdr.destroy();
    hdr = device.createTexture({
      size: { width: w, height: h }, format: HDR_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    hdrView = hdr.createView();
    hdrBind = device.createBindGroup({ layout: presentLayout, entries: [{ binding: 0, resource: hdrView }] });
    texW = w; texH = h;
  }

  const scratch = new Float32Array(UNIFORM_BYTES / 4);
  const backend = {
    name: "WebGPU",
    depth01: true,                   // WebGPU clip space runs z in 0..1
    lost: null,
    info: [adapter.info?.vendor, adapter.info?.architecture, adapter.info?.description]
      .filter(Boolean).join(" ") || "WebGPU",
    draw(scene, vp, width, height) {
      if (backend.lost) return;
      sizeTarget(width, height);
      scratch.set(vp, 0);
      scratch[16] = width; scratch[17] = height;
      scratch[18] = performance.now() / 1000;
      scratch[19] = EXPOSURE;
      device.queue.writeBuffer(uniform, 0, scratch.buffer, 0, UNIFORM_BYTES);
      write(quadBuf, scene.quads.bytes);
      write(lineBuf, scene.lines.bytes);

      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: hdrView, loadOp: "clear", storeOp: "store",
          clearValue: { r: 0.004, g: 0.006, b: 0.016, a: 1 },
        }],
      });
      pass.setBindGroup(0, sceneBind);
      if (scene.lines.count > 0 && lineBuf.buffer) {
        pass.setPipeline(linePipeline);
        pass.setVertexBuffer(0, lineBuf.buffer);
        pass.draw(4, scene.lines.count);
      }
      if (scene.quads.count > 0 && quadBuf.buffer) {
        pass.setPipeline(quadPipeline);
        pass.setVertexBuffer(0, quadBuf.buffer);
        pass.draw(4, scene.quads.count);
      }
      pass.end();

      const present = encoder.beginRenderPass({
        colorAttachments: [{
          view: context.getCurrentTexture().createView(),
          loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }],
      });
      present.setPipeline(presentPipeline);
      present.setBindGroup(0, hdrBind);
      present.draw(3);
      present.end();
      device.queue.submit([encoder.finish()]);
    },
    destroy() {
      if (hdr) hdr.destroy();
      if (quadBuf.buffer) quadBuf.buffer.destroy();
      if (lineBuf.buffer) lineBuf.buffer.destroy();
      uniform.destroy();
    },
  };
  device.lost.then((info) => { backend.lost = `the WebGPU device was lost: ${info.message || info.reason}`; });
  return backend;
}
