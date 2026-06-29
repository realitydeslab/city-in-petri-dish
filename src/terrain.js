import * as THREE from "three";
import {
  LAND_RADIUS, TERRAIN_SEGMENTS, TERRAIN_MAX_HEIGHT, ANCHORS, landMask,
} from "./config.js";

const WATER_Y = -0.28;

// --- tiny deterministic value noise (no deps) -----------------------------
function hash(x, z) {
  let h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return h - Math.floor(h);
}
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi);
  const c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
function fbm(x, z) {
  let amp = 0.5, freq = 1, sum = 0;
  for (let i = 0; i < 4; i++) { sum += amp * vnoise(x * freq, z * freq); freq *= 2.07; amp *= 0.5; }
  return sum;
}

// hills from named SF anchors
function hillField(nx, nz) {
  let h = 0;
  for (const k in ANCHORS) {
    const a = ANCHORS[k];
    if (!a.h) continue;
    const d = Math.hypot(nx - a.x, nz - a.z) / a.r;
    h += a.h * Math.exp(-d * d);
  }
  return h;
}

// Public: elevation + land/water for a world (x,z).
export function sample(x, z) {
  const nx = x / LAND_RADIUS, nz = z / LAND_RADIUS;
  const land = landMask(nx, nz);
  const hills = hillField(nx, nz) * TERRAIN_MAX_HEIGHT;
  const micro = (fbm(nx * 4.5 + 10, nz * 4.5 - 4) - 0.4) * 0.32;
  const landY = Math.max(0.02, hills + micro * (0.3 + hills));
  const y = WATER_Y * (1 - land) + landY * land;
  return { y, land, hills };
}

export function buildTerrain() {
  const group = new THREE.Group();
  const radius = LAND_RADIUS;
  const rings = TERRAIN_SEGMENTS;
  const sectors = TERRAIN_SEGMENTS;

  const positions = [];
  const colors = [];
  const indices = [];

  const cLandLow = new THREE.Color(0x2b3a30);   // coastal green-grey
  const cLandHi = new THREE.Color(0x6a6450);    // dry hill ochre
  const cWater = new THREE.Color(0x0a1622);     // bay
  const cWaterDeep = new THREE.Color(0x05080f);
  const cSand = new THREE.Color(0x3a3a32);

  // center vertex
  positions.push(0, sample(0, 0).y, 0);
  pushColor(0, 0);

  for (let r = 1; r <= rings; r++) {
    const rad = (r / rings) * radius;
    for (let s = 0; s < sectors; s++) {
      const th = (s / sectors) * Math.PI * 2;
      const x = Math.cos(th) * rad;
      const z = Math.sin(th) * rad;
      // taper the very edge down so it tucks under the dish rim
      const edge = r === rings ? -0.05 : 0;
      positions.push(x, sample(x, z).y + edge, z);
      pushColor(x, z);
    }
  }

  function pushColor(x, z) {
    const { land, hills } = sample(x, z);
    let col;
    if (land < 0.45) {
      col = cWaterDeep.clone().lerp(cWater, land / 0.45);
    } else {
      const t = Math.min(1, hills / 1.6);
      col = cLandLow.clone().lerp(cLandHi, t);
      if (land < 0.6) col.lerp(cSand, (0.6 - land) / 0.15 * 0.5); // beach band
    }
    colors.push(col.r, col.g, col.b);
  }

  // indices: fan for first ring, quads after
  for (let s = 0; s < sectors; s++) {
    const a = 1 + s;
    const b = 1 + ((s + 1) % sectors);
    indices.push(0, b, a);
  }
  for (let r = 1; r < rings; r++) {
    const base = 1 + (r - 1) * sectors;
    const next = 1 + r * sectors;
    for (let s = 0; s < sectors; s++) {
      const s1 = (s + 1) % sectors;
      const a = base + s, b = base + s1, c = next + s, d = next + s1;
      indices.push(a, d, c);
      indices.push(a, b, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.95,
    metalness: 0.0,
    flatShading: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  group.add(mesh);

  // a calm water disc just below sea level to read as the bay surface
  const waterGeo = new THREE.CircleGeometry(radius * 0.999, 96);
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x07111b, roughness: 0.18, metalness: 0.7,
    transparent: true, opacity: 0.85,
  });
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER_Y + 0.06;
  group.add(water);

  return group;
}
