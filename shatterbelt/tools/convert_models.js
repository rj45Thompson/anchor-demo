// Converts Star Fighter's FBX models into one small binary file the game loads directly.
//
//   node tools/convert_models.js      reads assets/models/*.FBX, writes assets/models/models.json + models.bin
//
// It parses them with Star Fighter's own loader (lib/fbxloader.js on three.js r128, with fflate), once,
// here. Loading the FBX files in the page instead printed 16 warnings and one uncaught error, all about
// the Photoshop textures the files point at, which the game never uses: render.js gives every model its
// own textures. So this tool takes geometry only, and says so: textures are not loaded at all.
//
// Each model is centred, turned so its nose points along +x (the game's angle 0), and scaled so its
// longest side is 1. Triangles are sorted by material, so a model has one draw group per material.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const HERE = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);

// name: [file, quarter turns about the vertical axis that bring its nose to +x]
const MODELS = {
  ship: ['vehicle_playerShip.FBX', 1],
  hunter: ['vehicle_enemyShip.FBX', 1],
  rock1: ['prop_asteroid_01.FBX', 0],
  rock2: ['prop_asteroid_02.FBX', 0],
  rock3: ['prop_asteroid_03.FBX', 0],
};

function loadThree() {
  const THREE = require(join(HERE, '..', 'three.min.js'));
  globalThis.THREE = THREE;
  vm.runInThisContext(readFileSync(join(HERE, 'lib', 'fflate.min.js'), 'utf8')); // sets globalThis.fflate
  // Geometry only: a texture request gets an empty texture and nothing is fetched (see the header).
  // FBXLoader still prints a warning for each Photoshop texture a file names; they are expected here.
  THREE.TextureLoader.prototype.load = () => new THREE.Texture();
  vm.runInThisContext(readFileSync(join(HERE, 'lib', 'fbxloader.js'), 'utf8'));
  return THREE;
}

function convert(THREE, file, quarterTurns) {
  const bytes = readFileSync(join(HERE, 'assets', 'models', file));
  const group = new THREE.FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), '');
  group.updateMatrixWorld(true);
  const meshes = [];
  group.traverse(o => { if (o.isMesh) meshes.push(o); });
  if (meshes.length !== 1) throw new Error(`${file}: expected one mesh, found ${meshes.length}`);
  const mesh = meshes[0];
  const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  geometry.rotateY(quarterTurns * Math.PI / 2);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const centre = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  geometry.translate(-centre.x, -centre.y, -centre.z);
  const longest = Math.max(size.x, size.y, size.z);
  geometry.scale(1 / longest, 1 / longest, 1 / longest);

  // triangles sorted by material, so each material is one contiguous draw group
  const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(m => m.name);
  const triangles = geometry.attributes.position.count / 3;
  const materialOf = new Array(triangles).fill(0);
  for (const g of geometry.groups) for (let t = g.start / 3; t < (g.start + g.count) / 3; t++) materialOf[t] = g.materialIndex;
  const order = [...Array(triangles).keys()].sort((a, b) => materialOf[a] - materialOf[b] || a - b);

  // corners that share position, normal and uv become one vertex, and triangles index them
  const position = [], normal = [], uv = [], index = [];
  const seen = new Map();
  const pos = geometry.attributes.position, nor = geometry.attributes.normal, tex = geometry.attributes.uv;
  for (const t of order) for (let k = 0; k < 3; k++) {
    const v = t * 3 + k;
    const corner = [pos.getX(v), pos.getY(v), pos.getZ(v), nor.getX(v), nor.getY(v), nor.getZ(v), tex.getX(v), tex.getY(v)];
    const key = corner.map(n => n.toFixed(5)).join(',');
    if (!seen.has(key)) {
      seen.set(key, position.length / 3);
      position.push(...corner.slice(0, 3));
      normal.push(...corner.slice(3, 6));
      uv.push(...corner.slice(6, 8));
    }
    index.push(seen.get(key));
  }
  if (position.length / 3 > 65535) throw new Error(`${file}: too many vertices for 16-bit indices`);
  const groups = [];
  order.forEach((t, i) => {
    const m = materialOf[t];
    if (groups.length && groups.at(-1).material === materials[m]) groups.at(-1).count += 3;
    else groups.push({ material: materials[m], start: i * 3, count: 3 });
  });
  return { position, normal, uv, index, groups, size: [size.x / longest, size.y / longest, size.z / longest] };
}

function main() {
  const THREE = loadThree();
  const manifest = { source: 'Star Fighter FBX models, converted by tools/convert_models.js', models: {} };
  const chunks = [];
  let offset = 0;
  for (const [name, [file, turns]] of Object.entries(MODELS)) {
    const model = convert(THREE, file, turns);
    const entry = { file, groups: model.groups, size: model.size.map(v => +v.toFixed(4)), attributes: {} };
    for (const [attr, itemSize, Type] of [['position', 3, Float32Array], ['normal', 3, Float32Array], ['uv', 2, Float32Array], ['index', 1, Uint16Array]]) {
      const data = new Type(model[attr]);
      entry.attributes[attr] = { itemSize, count: data.length / itemSize, byteOffset: offset, type: Type.name };
      chunks.push(Buffer.from(data.buffer));
      offset += data.byteLength + (data.byteLength % 4 ? 2 : 0); // keep the next block 4-byte aligned
      if (data.byteLength % 4) chunks.push(Buffer.alloc(2));
    }
    manifest.models[name] = entry;
    console.log(`${name.padEnd(7)} ${file.padEnd(24)} ${String(model.index.length / 3).padStart(5)} triangles, ${String(model.position.length / 3).padStart(5)} vertices, ` +
      `groups ${model.groups.map(g => `${g.material}:${g.count / 3}`).join(' ')}`);
  }
  writeFileSync(join(HERE, 'assets', 'models', 'models.bin'), Buffer.concat(chunks));
  writeFileSync(join(HERE, 'assets', 'models', 'models.json'), JSON.stringify(manifest, null, 1) + '\n');
  console.log(`models.bin ${offset} bytes`);
}

main();
