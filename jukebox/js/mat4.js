// Just enough 4x4 matrix and vector maths for the highway camera. Column-major, the
// order both WebGPU and WebGL want, so a matrix goes straight into a uniform buffer.
// Pure functions (tests/mat4.test.mjs).

export function identity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

// a * b, applying b first.
export function multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = sum;
    }
  }
  return out;
}

export function transform(m, v) {
  const [x, y, z] = v;
  const w = v[3] === undefined ? 1 : v[3];
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12] * w,
    m[1] * x + m[5] * y + m[9] * z + m[13] * w,
    m[2] * x + m[6] * y + m[10] * z + m[14] * w,
    m[3] * x + m[7] * y + m[11] * z + m[15] * w,
  ];
}

// Right-handed perspective. `depth01` picks the clip-space depth range: WebGPU wants
// z in [0,1], WebGL in [-1,1], and the same scene must look the same in both.
export function perspective(fovYRadians, aspect, near, far, depth01) {
  const f = 1 / Math.tan(fovYRadians / 2);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[11] = -1;
  if (depth01) {
    out[10] = far / (near - far);
    out[14] = (far * near) / (near - far);
  } else {
    out[10] = (far + near) / (near - far);
    out[14] = (2 * far * near) / (near - far);
  }
  return out;
}

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
export function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export function length(a) { return Math.hypot(a[0], a[1], a[2]); }
export function normalize(a) {
  const l = length(a);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}

export function lookAt(eye, target, up) {
  const f = normalize(sub(target, eye));       // forward
  const s = normalize(cross(f, up));           // right
  const u = cross(s, f);                       // true up
  const out = new Float32Array(16);
  out[0] = s[0]; out[4] = s[1]; out[8] = s[2];
  out[1] = u[0]; out[5] = u[1]; out[9] = u[2];
  out[2] = -f[0]; out[6] = -f[1]; out[10] = -f[2];
  out[12] = -dot(s, eye);
  out[13] = -dot(u, eye);
  out[14] = dot(f, eye);
  out[15] = 1;
  return out;
}

// The view-projection the shaders take.
export function viewProjection(eye, target, up, fovYRadians, aspect, near, far, depth01) {
  return multiply(perspective(fovYRadians, aspect, near, far, depth01), lookAt(eye, target, up));
}
