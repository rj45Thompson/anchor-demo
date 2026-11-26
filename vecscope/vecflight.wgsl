// vecflight.wgsl - serves USE_CASES.md UC-VS-02 steps 5-7. Draws the recorded forward pass; NO analysis,
// and no inference: every position it reads was measured by dump_trace.py and is only being replayed.
//
// Three things are computed here and nothing else:
//   1. the 1024 -> 3 projection of a residual against an orthonormal basis (shared with vecscope.wgsl, and
//      cross-checked against a CPU computation in the page),
//   2. screen-space line expansion, because WebGPU has no thick-line primitive,
//   3. screen-space node quads, so a node stays legible however far the camera flies from it.
//
// NO COSINE (R-VS-DEPTH): no data vector is normalised. Projected coordinates are real lengths along an
// orthonormal axis and the part not shown comes back as `hidden` in .w for the page to report.

struct Cfg { n_vec : u32, dim : u32, mean_sub : u32, _pad : u32, };

@group(0) @binding(0) var<storage, read>       vecs  : array<f32>;
@group(0) @binding(1) var<storage, read>       basis : array<f32>;
@group(0) @binding(2) var<storage, read_write> proj  : array<vec4<f32>>;
@group(0) @binding(3) var<uniform>             cfg   : Cfg;
@group(0) @binding(4) var<storage, read>       meanv : array<f32>;

@compute @workgroup_size(64)
fn project(@builtin(global_invocation_id) gid : vec3<u32>) {
    let i = gid.x;
    if (i >= cfg.n_vec) { return; }
    let base = i * cfg.dim;
    var c0 = 0.0; var c1 = 0.0; var c2 = 0.0;
    for (var j : u32 = 0u; j < cfg.dim; j = j + 1u) {
        var v = vecs[base + j];
        if (cfg.mean_sub == 1u) { v = v - meanv[j]; }
        c0 = c0 + v * basis[j];
        c1 = c1 + v * basis[cfg.dim + j];
        c2 = c2 + v * basis[2u * cfg.dim + j];
    }
    // The discarded part is computed as the norm of the REMAINDER v - (c0*b0 + c1*b1 + c2*b2), not as
    // sqrt(|v|^2 - |c|^2). The Pythagorean form catastrophically cancels when the basis captures nearly all
    // of a large vector - measured 2026-11-25: it put the GPU 2.06e-4 relative away from the same sum in
    // JS and tripped the page's own GPU-vs-CPU guard. This form is stable and brought it to ~1e-6.
    var rem = 0.0;
    for (var j : u32 = 0u; j < cfg.dim; j = j + 1u) {
        var v = vecs[base + j];
        if (cfg.mean_sub == 1u) { v = v - meanv[j]; }
        let r = v - (c0 * basis[j] + c1 * basis[cfg.dim + j] + c2 * basis[2u * cfg.dim + j]);
        rem = rem + r * r;
    }
    proj[i] = vec4<f32>(c0, c1, c2, sqrt(max(0.0, rem)));
}

// ---------------------------------------------------------------- drawing
struct Seg {
    ab    : vec4<i32>,   // .x start, .y end, .z flags, .w unused
    color : vec4<f32>,
    opts  : vec4<f32>,   // .x magnification, .y half width (px), .z anchor index into `extra` (-1 = none)
};
struct Node {
    pos   : vec4<f32>,   // .xyz world, .w radius in PIXELS
    color : vec4<f32>,
};
struct View {
    mvp        : mat4x4<f32>,
    viewport   : vec2<f32>,
    disp_scale : f32,
    depth_scale: f32,
};

@group(1) @binding(0) var<storage, read> segs   : array<Seg>;
@group(1) @binding(1) var<uniform>       view   : View;
@group(1) @binding(2) var<storage, read> extra  : array<vec4<f32>>;
@group(1) @binding(3) var<storage, read> projRO : array<vec4<f32>>;
@group(1) @binding(4) var<storage, read> nodes  : array<Node>;

const FLAG_A_EXTRA : i32 = 1;
const FLAG_B_EXTRA : i32 = 2;
const FLAG_B_REL   : i32 = 4;   // end = start + magnification * projRO[b]

fn to_world(c : vec3<f32>) -> vec3<f32> {
    return vec3<f32>(c.x, c.y, c.z * view.depth_scale) / view.disp_scale;
}

// A projected residual is drawn ANCHORED at a point on the layer axis, so the vector sits at its own layer
// in the fly-through rather than all of them piling onto one origin.
fn anchor_of(s : Seg) -> vec3<f32> {
    let a = i32(s.opts.z);
    if (a < 0) { return vec3<f32>(0.0, 0.0, 0.0); }
    return extra[a].xyz;
}

fn ends(s : Seg) -> array<vec3<f32>, 2> {
    let anc = anchor_of(s);
    var a : vec3<f32>;
    if ((s.ab.z & FLAG_A_EXTRA) != 0) { a = extra[s.ab.x].xyz; }
    else { a = anc + to_world(projRO[s.ab.x].xyz * s.opts.x); }
    var b : vec3<f32>;
    if ((s.ab.z & FLAG_B_REL) != 0) {
        var a0 : vec3<f32>;
        if ((s.ab.z & FLAG_A_EXTRA) != 0) { a0 = extra[s.ab.x].xyz; }
        else { a0 = anc + to_world(projRO[s.ab.x].xyz); }
        b = a0 + to_world(projRO[s.ab.y].xyz * s.opts.x);
        a = a0;
    } else if ((s.ab.z & FLAG_B_EXTRA) != 0) { b = extra[s.ab.y].xyz; }
    else { b = anc + to_world(projRO[s.ab.y].xyz * s.opts.x); }
    return array<vec3<f32>, 2>(a, b);
}

struct VsOut {
    @builtin(position) pos   : vec4<f32>,
    @location(0)       color : vec4<f32>,
    @location(1)       uv    : vec2<f32>,
};

@vertex
fn vs_seg(@builtin(vertex_index) vi : u32, @builtin(instance_index) ii : u32) -> VsOut {
    let s = segs[ii];
    let e = ends(s);
    let ca = view.mvp * vec4<f32>(e[0], 1.0);
    let cb = view.mvp * vec4<f32>(e[1], 1.0);
    var ts = array<vec2<f32>, 6>(
        vec2<f32>(0.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
        vec2<f32>(0.0, -1.0), vec2<f32>(1.0,  1.0), vec2<f32>(0.0, 1.0));
    let k = ts[vi];
    let na = ca.xy / max(ca.w, 1e-6);
    let nb = cb.xy / max(cb.w, 1e-6);
    let dir = (nb - na) * view.viewport;
    let l = length(dir);
    var nrm = vec2<f32>(0.0, 0.0);
    if (l > 1e-9) { nrm = vec2<f32>(-dir.y, dir.x) / l; }
    let clip = mix(ca, cb, k.x);
    let w = max(clip.w, 1e-6);
    let off = nrm * k.y * s.opts.y / view.viewport * w * 2.0;
    var o : VsOut;
    o.pos = vec4<f32>(clip.x + off.x, clip.y + off.y, clip.z, clip.w);
    o.color = s.color;
    o.uv = vec2<f32>(0.0, 0.0);
    return o;
}

@vertex
fn vs_head(@builtin(vertex_index) vi : u32, @builtin(instance_index) ii : u32) -> VsOut {
    let s = segs[ii];
    let e = ends(s);
    let ca = view.mvp * vec4<f32>(e[0], 1.0);
    let cb = view.mvp * vec4<f32>(e[1], 1.0);
    let na = ca.xy / max(ca.w, 1e-6);
    let nb = cb.xy / max(cb.w, 1e-6);
    let dir = (nb - na) * view.viewport;
    let l = length(dir);
    var u = vec2<f32>(0.0, 1.0);
    if (l > 1e-9) { u = dir / l; }
    let v = vec2<f32>(-u.y, u.x);
    let len = s.opts.y * 4.5;
    let wid = s.opts.y * 2.4;
    var pts = array<vec2<f32>, 3>(vec2<f32>(0.0, 0.0), -u * len + v * wid, -u * len - v * wid);
    let p = pts[vi];
    let w = max(cb.w, 1e-6);
    var o : VsOut;
    o.pos = vec4<f32>(cb.x + p.x / view.viewport.x * w * 2.0, cb.y + p.y / view.viewport.y * w * 2.0, cb.z, cb.w);
    o.color = s.color;
    o.uv = vec2<f32>(0.0, 0.0);
    return o;
}

// One recorded residual = one node. The quad is expanded in SCREEN space so a node stays readable from any
// distance as the camera flies down the stack.
@vertex
fn vs_node(@builtin(vertex_index) vi : u32, @builtin(instance_index) ii : u32) -> VsOut {
    let n = nodes[ii];
    let c = view.mvp * vec4<f32>(n.pos.xyz, 1.0);
    var q = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
        vec2<f32>(-1.0, -1.0), vec2<f32>(1.0,  1.0), vec2<f32>(-1.0, 1.0));
    let k = q[vi];
    let w = max(c.w, 1e-6);
    var o : VsOut;
    o.pos = vec4<f32>(c.x + k.x * n.pos.w / view.viewport.x * w * 2.0,
                      c.y + k.y * n.pos.w / view.viewport.y * w * 2.0, c.z, c.w);
    o.color = n.color;
    o.uv = k;
    return o;
}

@fragment
fn fs(i : VsOut) -> @location(0) vec4<f32> { return i.color; }

@fragment
fn fs_node(i : VsOut) -> @location(0) vec4<f32> {
    let r = length(i.uv);
    if (r > 1.0) { discard; }
    let edge = smoothstep(1.0, 0.72, r);          // a soft disc, so the grid reads as points not squares
    return vec4<f32>(i.color.rgb, i.color.a * edge);
}
