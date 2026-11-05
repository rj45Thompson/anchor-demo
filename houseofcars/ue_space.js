// ue_space.js - Unreal space (cm; X forward, Y right, Z up; left-handed) to the page's three.js space (m; Y up; right-handed),
// by the SAME rule Unreal's glTF exporter used for every mesh on this page (GLTFCoreUtilities.cpp ConvertVector: glTF = (X, Z, Y),
// ExportUniformScale 0.01), so data, physics and meshes agree. Pure; runs in the browser and in node.
// P swaps Y and Z; a rotation R in Unreal is P R P here (det stays +1), a point p is P p / 100.

export const toThreePoint = (p) => [p[0] / 100, p[2] / 100, p[1] / 100];
export const toThreeDir = (v) => [v[0], v[2], v[1]];

// FRotationMatrix (Core/Public/Math/RotationTranslationMatrix.h:66-84): the rows are the images of X, Y, Z
export function rotatorAxes(r) {
  const d = Math.PI / 180;
  const SP = Math.sin(r.pitch * d), CP = Math.cos(r.pitch * d);
  const SY = Math.sin(r.yaw * d), CY = Math.cos(r.yaw * d);
  const SR = Math.sin(r.roll * d), CR = Math.cos(r.roll * d);
  return [
    [CP * CY, CP * SY, SP],
    [SR * SP * CY - CR * SY, SR * SP * SY + CR * CY, -SR * CP],
    [-(CR * SP * CY + SR * SY), CY * SR - CR * SP * SY, CR * CP],
  ];
}

// a three.js Matrix4 element array (column-major) for an Unreal transform given as axes (3 world vectors: images of X, Y, Z),
// scale (per axis) and location (cm). Columns of the three rotation: P(axisX), P(axisZ), P(axisY).
export function threeMatrixFromAxes(axes, scale, locCm) {
  const [ax, ay, az] = axes, s = scale || [1, 1, 1];
  const cx = toThreeDir(ax).map((v) => v * s[0]), cz = toThreeDir(ay).map((v) => v * s[1]), cy = toThreeDir(az).map((v) => v * s[2]);
  const t = toThreePoint(locCm);
  return [cx[0], cx[1], cx[2], 0, cy[0], cy[1], cy[2], 0, cz[0], cz[1], cz[2], 0, t[0], t[1], t[2], 1];
}
export const threeMatrix = (rotator, scale, locCm) => threeMatrixFromAxes(rotatorAxes(rotator), scale, locCm);

// Unreal's camera FOV is horizontal; three.js PerspectiveCamera.fov is vertical
export function verticalFovDeg(horizontalDeg, aspect) {
  return 2 * Math.atan(Math.tan((horizontalDeg * Math.PI) / 360) / aspect) * (180 / Math.PI);
}
