// vecscope.wgsl - serves USE_CASES.md UC-VS-01 steps 7-8. Draws the vectors; carries NO analysis.
//
// Every number this file consumes was measured by dump_residual.py. The only things computed here are
// (a) the 1024 -> 3 projection against an orthonormal basis, and (b) screen-space line expansion.
// The projection is cross-checked against a CPU computation in vecscope.html at load (path A1b), so the
// shader is verifiably right rather than decoratively used.
//
// NO COSINE (R-VS-DEPTH): nothing here normalises a DATA vector. The basis is orthonormal, so a projected
// coordinate is a real length along that axis, and the part NOT shown is returned as `hidden` in .w so the
// page can report it. A viewer that dropped that number would be hiding its own projection.
// The one place a length IS divided out is `opts.z` (fixed display length), used only for the unembedding
// DIRECTIONS, whose own lengths (~3) are a different quantity from the residual's (~279); those lengths are
// printed as numbers in the readout instead of being drawn, and the UI says so.
//
// `proj` is bound TWICE on purpose: read_write at @group(0) for the compute pass, read-only at @group(1) for
// the vertex stage. WebGPU forbids a writable storage buffer in the vertex stage, and one WGSL module cannot
// declare the same binding with two access modes - hence the two separate declarations.

struct Cfg {
    n_vec      : u32,   // how many d-dimensional vectors are in `vecs`
    dim        : u32,   // 1024 for gpt2-medium
    mean_sub   : u32,   // 1 = subtract the dump's mean z first (a declared presentation choice)
    _pad       : u32,
};

@group(0) @binding(0) var<storage, read>       vecs  : array<f32>;        // n_vec * dim, row major
@group(0) @binding(1) var<storage, read>       basis : array<f32>;        // 3 * dim, orthonormal rows
@group(0) @binding(2) var<storage, read_write> proj  : array<vec4<f32>>;  // n_vec: (c0, c1, c2, hidden)
@group(0) @binding(3) var<uniform>             cfg   : Cfg;
@group(0) @binding(4) var<storage, read>       meanv : array<f32>;        // dim

// ---------------------------------------------------------------- the projection (steps 7-8)
@compute @workgroup_size(64)
fn project(@builtin(global_invocation_id) gid : vec3<u32>) {
    let i = gid.x;
    if (i >= cfg.n_vec) { return; }
    let base = i * cfg.dim;

    var c0 = 0.0; var c1 = 0.0; var c2 = 0.0; var sq = 0.0;
    for (var j : u32 = 0u; j < cfg.dim; j = j + 1u) {
        var v = vecs[base + j];
        if (cfg.mean_sub == 1u) { v = v - meanv[j]; }
        c0 = c0 + v * basis[j];
        c1 = c1 + v * basis[cfg.dim + j];
        c2 = c2 + v * basis[2u * cfg.dim + j];
        sq = sq + v * v;
    }
    // what the three axes do NOT hold, as a length in the same units: the projection's own honesty number
    let kept = c0 * c0 + c1 * c1 + c2 * c2;
    proj[i] = vec4<f32>(c0, c1, c2, sqrt(max(0.0, sq - kept)));
}

// ---------------------------------------------------------------- drawing
struct Seg {
    ab      : vec4<i32>,   // .x start index, .y end index, .z flags, .w unused
    color   : vec4<f32>,
    opts    : vec4<f32>,   // .x magnification, .y half width (px), .z fixed display length (0 = true scale)
};

struct View {
    mvp         : mat4x4<f32>,
    viewport    : vec2<f32>,   // pixels
    disp_scale  : f32,         // data units per world unit
    depth_scale : f32,         // extra squash on axis 3 (declared in the UI)
};

@group(1) @binding(0) var<storage, read> segs   : array<Seg>;
@group(1) @binding(1) var<uniform>       view   : View;
@group(1) @binding(2) var<storage, read> extra  : array<vec4<f32>>;  // literal world-space points (grid, axes)
@group(1) @binding(3) var<storage, read> projRO : array<vec4<f32>>;  // the same buffer as `proj`, read-only

const FLAG_A_EXTRA : i32 = 1;   // the start index addresses `extra`
const FLAG_B_EXTRA : i32 = 2;   // the end index addresses `extra`
const FLAG_B_REL   : i32 = 4;   // the end is start + magnification * projRO[b]: an arrow hanging off a tip,
                                // which is how the error is drawn against the vector it is the error OF

fn to_world(c_in : vec3<f32>, fixed_len : f32) -> vec3<f32> {
    var c = c_in;
    if (fixed_len > 0.0) {
        let n = length(c);
        if (n > 1e-12) { c = c / n * fixed_len * view.disp_scale; }
    }
    return vec3<f32>(c.x, c.y, c.z * view.depth_scale) / view.disp_scale;
}

fn ends(s : Seg) -> array<vec3<f32>, 2> {
    var a : vec3<f32>;
    if ((s.ab.z & FLAG_A_EXTRA) != 0) {
        a = extra[s.ab.x].xyz;
    } else {
        a = to_world(projRO[s.ab.x].xyz * s.opts.x, s.opts.z);
    }
    var b : vec3<f32>;
    if ((s.ab.z & FLAG_B_REL) != 0) {
        // the start WITHOUT magnification, then the magnified offset: keeps the tip where the data puts it
        var a0 : vec3<f32>;
        if ((s.ab.z & FLAG_A_EXTRA) != 0) { a0 = extra[s.ab.x].xyz; } else { a0 = to_world(projRO[s.ab.x].xyz, 0.0); }
        b = a0 + to_world(projRO[s.ab.y].xyz * s.opts.x, 0.0);
        a = a0;
    } else if ((s.ab.z & FLAG_B_EXTRA) != 0) {
        b = extra[s.ab.y].xyz;
    } else {
        b = to_world(projRO[s.ab.y].xyz * s.opts.x, s.opts.z);
    }
    return array<vec3<f32>, 2>(a, b);
}

struct VsOut {
    @builtin(position) pos   : vec4<f32>,
    @location(0)       color : vec4<f32>,
};

// Screen-space expanded line: 6 vertices per segment instance, so width is in PIXELS and a vector stays
// legible however far the camera is. WebGPU has no thick-line primitive, hence the quad.
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
    let dir = (nb - na) * view.viewport;           // pixel space, so the normal is pixel-true
    let l = length(dir);
    var nrm = vec2<f32>(0.0, 0.0);
    if (l > 1e-9) { nrm = vec2<f32>(-dir.y, dir.x) / l; }

    let clip = mix(ca, cb, k.x);
    let w = max(clip.w, 1e-6);
    let off = nrm * k.y * s.opts.y / view.viewport * w * 2.0;

    var o : VsOut;
    o.pos = vec4<f32>(clip.x + off.x, clip.y + off.y, clip.z, clip.w);
    o.color = s.color;
    return o;
}

// An arrowhead at the segment's tip: one screen-space triangle, so it stays the same size on screen.
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

    let len = s.opts.y * 4.5;      // head size in pixels, tied to the line width
    let wid = s.opts.y * 2.4;
    var pts = array<vec2<f32>, 3>(vec2<f32>(0.0, 0.0), -u * len + v * wid, -u * len - v * wid);
    let p = pts[vi];

    let w = max(cb.w, 1e-6);
    let off = p / view.viewport * w * 2.0;
    var o : VsOut;
    o.pos = vec4<f32>(cb.x + off.x, cb.y + off.y, cb.z, cb.w);
    o.color = s.color;
    return o;
}

@fragment
fn fs(i : VsOut) -> @location(0) vec4<f32> {
    return i.color;
}
