import * as THREE from "three";
import { sample as terrainSample } from "./terrain.js";
import { buildEnergyGraph, redistribute } from "./energy.js";
import {
  LAND_RADIUS, BUILDING_COUNT, DOWNTOWN_MAX_HEIGHT, SUBURB_MAX_HEIGHT, ANCHORS,
} from "./config.js";

// --- energy / growth tuning ------------------------------------------------
// Per-unit-footprint energetics (ratios), so dynamics are fast and shadow-
// sensitive regardless of building size.
const FACADE_GAIN = 0.4;   // modest facade solar on top of rooftop capture
const BASE_DEMAND = 0.18;  // baseline upkeep
const PER_FLOOR = 1.3;     // demand per floor -> tall towers are net consumers
const GROWTH = 4.5;        // surplus -> vitality (snappy growth under light)
const DECAY = 3.0;         // deficit -> withering
const EASE = 7.0;          // height easing toward vitality target

const C_GOLD = new THREE.Color(0xffc24d);  // generator (sunlit, surplus)
const C_CYAN = new THREE.Color(0x49d4ff);  // receiver (kept alive by the network)
const C_DYING = new THREE.Color(0xff4530); // starving in shadow
const DISTRICT_COLORS = [
  0xff7a5c, 0x6cc6ff, 0x9be36b, 0xffd45e, 0xc792ff,
  0x5ee0c0, 0xff8fb0, 0xb0b6ff, 0xffa94d, 0x7fe0a0,
].map((h) => new THREE.Color(h));

function rand() { return Math.random(); }
function gauss(mu, sigma) {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function smooth01(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }

export function buildCity() {
  // --- generate plots on land ---------------------------------------------
  const plots = [];
  let guard = 0;
  while (plots.length < BUILDING_COUNT && guard < BUILDING_COUNT * 40) {
    guard++;
    let x, z, downtownBias = rand() < 0.42;
    if (downtownBias) {
      const a = ANCHORS.downtown;
      x = gauss(a.x, a.r * 0.7) * LAND_RADIUS;
      z = gauss(a.z, a.r * 0.7) * LAND_RADIUS;
    } else {
      const r = Math.sqrt(rand()) * LAND_RADIUS;
      const th = rand() * Math.PI * 2;
      x = Math.cos(th) * r; z = Math.sin(th) * r;
    }
    const s = terrainSample(x, z);
    if (s.land < 0.62) continue; // only build on solid land

    // distance to downtown drives max height + footprint
    const dDown = Math.hypot(x / LAND_RADIUS - ANCHORS.downtown.x, z / LAND_RADIUS - ANCHORS.downtown.z);
    const urbanity = Math.max(0, 1 - dDown / 0.85);
    const maxH = THREE.MathUtils.lerp(SUBURB_MAX_HEIGHT, DOWNTOWN_MAX_HEIGHT, urbanity ** 1.7)
      * (0.6 + rand() * 0.8);
    const foot = THREE.MathUtils.lerp(0.07, 0.16, urbanity) * (0.8 + rand() * 0.5);
    plots.push({ x, z, gy: s.y, maxH, foot });
  }

  const n = plots.length;
  const eg = buildEnergyGraph(plots);

  // --- per-plot state ------------------------------------------------------
  const state = {
    height: new Float32Array(n),
    vitality: new Float32Array(n),
    gen: new Float64Array(n),
    demand: new Float64Array(n),
    satisfaction: new Float32Array(n),
    alive: new Uint8Array(n),
  };
  // seed an initial sparse settlement so there is something to evolve from
  for (let i = 0; i < n; i++) state.vitality[i] = rand() < 0.5 ? 0.15 + rand() * 0.3 : 0;

  // --- instanced building mesh --------------------------------------------
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0); // pivot at base so scale.y grows upward
  const mat = new THREE.MeshStandardMaterial({
    color: 0x0d1117, roughness: 0.55, metalness: 0.15,
  });
  const aTint = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  const aEnergy = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
  geo.setAttribute("aTint", aTint);
  geo.setAttribute("aEnergy", aEnergy);
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 aTint;\nattribute float aEnergy;\nvarying vec3 vTint;\nvarying float vEnergy;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvTint = aTint;\nvEnergy = aEnergy;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vTint;\nvarying float vEnergy;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vTint * vEnergy * 2.4;");
  };

  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

  const dummy = new THREE.Object3D();
  function writeMatrices() {
    for (let i = 0; i < n; i++) {
      const h = Math.max(0.0001, state.height[i]);
      dummy.position.set(plots[i].x, plots[i].gy, plots[i].z);
      dummy.scale.set(plots[i].foot, h, plots[i].foot);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
  writeMatrices();

  // --- energy-sharing network --------------------------------------------
  const L = eg.links.length;
  // (a) the connectivity graph: every link, drawn as a beam between rooftops.
  //     Dim when idle, gold->cyan gradient (giver->receiver) when energy flows.
  const lineGeo = new THREE.BufferGeometry();
  const linePos = new Float32Array(L * 2 * 3);
  const lineCol = new Float32Array(L * 2 * 3);
  lineGeo.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
  lineGeo.setAttribute("color", new THREE.BufferAttribute(lineCol, 3));
  const lineMat = new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.92,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const lines = new THREE.LineSegments(lineGeo, lineMat);
  lines.frustumCulled = false;

  // (b) energy packets streaming along active links (giver -> receiver)
  const PK = 3; // packets per active edge -> reads as a flowing current
  const flowPos = new Float32Array(L * PK * 3);
  const flowCol = new Float32Array(L * PK * 3);
  const flowGeo = new THREE.BufferGeometry();
  flowGeo.setAttribute("position", new THREE.BufferAttribute(flowPos, 3));
  flowGeo.setAttribute("color", new THREE.BufferAttribute(flowCol, 3));
  const flowMat = new THREE.PointsMaterial({
    size: 0.24, vertexColors: true, transparent: true, opacity: 1.0,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const flow = new THREE.Points(flowGeo, flowMat);
  flow.frustumCulled = false;
  // per-edge phase offset so packets are not synchronised
  const edgePhase = new Float32Array(L);
  for (let i = 0; i < L; i++) edgePhase[i] = rand();
  lines.userData.flow = flow; // keep them together

  // --- per-frame simulation -----------------------------------------------
  const tmpTint = new THREE.Color();
  let autonomy = 0, harvest = 0, aliveCount = 0, simTime = 0;

  function update(dt, ctx) {
    // ctx: { sunFactor (0..1), lightAt(x,z)->0..~2, sharing, showDistricts }
    dt = Math.min(dt, 0.05);
    const { sunFactor, lightAt, sharing } = ctx;
    const cloudAt = ctx.cloudAt || (() => 1);
    let genSum = 0;

    // 1. light -> generation/demand
    for (let i = 0; i < n; i++) {
      const p = plots[i];
      // sun is dimmed by drifting cloud shadow; flashlight punches through
      const light = sunFactor * cloudAt(p.x, p.z) + lightAt(p.x, p.z); // 0..~2.5
      const h = state.height[i];
      const footArea = p.foot * p.foot;
      // generation: rooftop + modest facade capture (Zhuang: whole-envelope solar)
      state.gen[i] = light * footArea * (1 + FACADE_GAIN * h);
      // demand grows with floors (volume) -> tall towers depend on strong light
      state.demand[i] = footArea * (BASE_DEMAND + PER_FLOOR * h);
      state.alive[i] = h > 0.015 ? 1 : 0; // set before redistribution (no frame lag)
      genSum += state.gen[i];
    }

    // 2. hierarchical energy redistribution across districts
    autonomy = redistribute(state, eg, sharing);

    // 3. vitality -> growth / death (the morphogenesis)
    // dim the buildings when focusing on the sharing network, so the
    // gold->cyan edges + flowing packets become the subject
    const glowScale = (sharing && ctx.showNetwork) ? 0.4 : 1.0;
    aliveCount = 0;
    for (let i = 0; i < n; i++) {
      const p = plots[i];
      // fitness = energy supply / demand (footprint cancels -> size-independent)
      const f = state.gen[i] / (state.demand[i] + 1e-6);
      const ownSurplus = f - 1;
      let v = state.vitality[i];
      if (f > 1) {
        v += GROWTH * Math.min(f - 1, 6) * dt;
      } else {
        const covered = sharing ? state.satisfaction[i] : f;
        v += (covered - 1) * DECAY * dt;
      }
      v = Math.max(0, Math.min(1, v));
      state.vitality[i] = v;

      const target = plots[i].maxH * smooth01(v);
      state.height[i] += (target - state.height[i]) * Math.min(1, EASE * dt);
      state.alive[i] = state.height[i] > 0.015 ? 1 : 0;
      aliveCount += state.alive[i];

      // colour / glow
      let tint;
      if (ctx.showDistricts && sharing) {
        tint = DISTRICT_COLORS[eg.community[i] % DISTRICT_COLORS.length];
      } else if (ownSurplus > 0.0005) {
        tint = C_GOLD;
      } else if ((sharing ? state.satisfaction[i] : 0) > 0.5) {
        tint = C_CYAN; // surviving on shared energy
      } else {
        tint = C_DYING;
      }
      const glow = state.alive[i]
        ? (0.12 + 0.55 * Math.min(1, lightAt(p.x, p.z) + sunFactor * 0.4) + 0.5 * v) * glowScale
        : 0;
      aTint.setXYZ(i, tint.r, tint.g, tint.b);
      aEnergy.setX(i, glow);
    }
    aTint.needsUpdate = true;
    aEnergy.needsUpdate = true;
    writeMatrices();

    // 4. energy-sharing network: connectivity graph + directional flow packets
    simTime += dt;
    const show = sharing && ctx.showNetwork;
    flow.visible = show;
    if (show) {
      for (let e = 0; e < L; e++) {
        const a = eg.links[e].a, b = eg.links[e].b;
        const i2 = e * 2;
        const aAlive = state.alive[a], bAlive = state.alive[b];
        const ax = plots[a].x, az = plots[a].z, ay = plots[a].gy + state.height[a];
        const bx = plots[b].x, bz = plots[b].z, by = plots[b].gy + state.height[b];
        // rooftop anchors
        linePos[i2 * 3] = ax; linePos[i2 * 3 + 1] = ay; linePos[i2 * 3 + 2] = az;
        linePos[(i2 + 1) * 3] = bx; linePos[(i2 + 1) * 3 + 1] = by; linePos[(i2 + 1) * 3 + 2] = bz;

        const sa = state.gen[a] - state.demand[a];
        const sb = state.gen[b] - state.demand[b];
        const active = aAlive && bAlive && ((sa > 0 && sb < 0) || (sb > 0 && sa < 0));

        const fb = e * PK; // base packet index for this edge
        if (!aAlive || !bAlive) {
          // edge to a dead node: invisible
          lineCol[i2 * 3] = lineCol[i2 * 3 + 1] = lineCol[i2 * 3 + 2] = 0;
          lineCol[(i2 + 1) * 3] = lineCol[(i2 + 1) * 3 + 1] = lineCol[(i2 + 1) * 3 + 2] = 0;
          for (let k = 0; k < PK; k++) { const o = (fb + k) * 3; flowCol[o] = flowCol[o + 1] = flowCol[o + 2] = 0; }
        } else if (active) {
          const mag = Math.min(1, Math.min(Math.abs(sa), Math.abs(sb)) * 8 + 0.5);
          // giver end glows gold, receiver end glows cyan
          const aGiver = sa > 0;
          const gA = aGiver ? [1.0, 0.72, 0.28] : [0.28, 0.82, 1.0];
          const gB = aGiver ? [0.28, 0.82, 1.0] : [1.0, 0.72, 0.28];
          lineCol[i2 * 3] = gA[0] * mag; lineCol[i2 * 3 + 1] = gA[1] * mag; lineCol[i2 * 3 + 2] = gA[2] * mag;
          lineCol[(i2 + 1) * 3] = gB[0] * mag; lineCol[(i2 + 1) * 3 + 1] = gB[1] * mag; lineCol[(i2 + 1) * 3 + 2] = gB[2] * mag;
          // packets travel giver -> receiver as a current
          const sx = aGiver ? ax : bx, sy = aGiver ? ay : by, sz = aGiver ? az : bz;
          const tx = aGiver ? bx : ax, ty = aGiver ? by : ay, tz = aGiver ? bz : az;
          for (let k = 0; k < PK; k++) {
            const ph = (simTime * 0.85 + edgePhase[e] + k / PK) % 1;
            const o = (fb + k) * 3;
            flowPos[o] = sx + (tx - sx) * ph;
            flowPos[o + 1] = sy + (ty - sy) * ph + 0.06;
            flowPos[o + 2] = sz + (tz - sz) * ph;
            const b = mag * (0.5 + 0.5 * Math.sin(ph * Math.PI)); // brightest mid-span
            flowCol[o] = (1.0 - 0.7 * ph) * b;
            flowCol[o + 1] = (0.78 + 0.04 * ph) * b;
            flowCol[o + 2] = (0.3 + 0.7 * ph) * b;
          }
        } else {
          // both alive but balanced: faint connection to show the graph exists
          const c = 0.12;
          lineCol[i2 * 3] = c * 0.6; lineCol[i2 * 3 + 1] = c; lineCol[i2 * 3 + 2] = c * 1.4;
          lineCol[(i2 + 1) * 3] = c * 0.6; lineCol[(i2 + 1) * 3 + 1] = c; lineCol[(i2 + 1) * 3 + 2] = c * 1.4;
          for (let k = 0; k < PK; k++) { const o = (fb + k) * 3; flowCol[o] = flowCol[o + 1] = flowCol[o + 2] = 0; }
        }
      }
      lineGeo.attributes.position.needsUpdate = true;
      lineGeo.attributes.color.needsUpdate = true;
      flowGeo.attributes.position.needsUpdate = true;
      flowGeo.attributes.color.needsUpdate = true;
    }

    harvest = genSum;
  }

  return {
    mesh, lines, flow, plots, eg, state,
    update,
    get metrics() {
      return { autonomy, harvest, aliveCount, districts: eg.communityCount, total: n };
    },
    reseed() {
      for (let i = 0; i < n; i++) {
        state.vitality[i] = rand() < 0.4 ? 0.15 + rand() * 0.3 : 0;
        state.height[i] = 0;
      }
    },
  };
}
