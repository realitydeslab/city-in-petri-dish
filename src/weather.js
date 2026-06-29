import * as THREE from "three";
import { DISH_RADIUS } from "./config.js";

const CLOUD_Y = 4.6;
const MAX_PUFFS = 28;        // user-painted clouds/storms
const RAIN_DROPS = 800;
const WIND_STREAKS = 60;

// soft radial-alpha disc texture for cloud puffs (generated once)
function softDisc() {
  const s = 128;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.5, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}
function clampToDish(x, z, margin = 0.96) {
  const r = Math.hypot(x, z), lim = DISH_RADIUS * margin;
  if (r > lim) return [x * lim / r, z * lim / r];
  return [x, z];
}

// Drifting weather the viewer paints into the dish with tools:
//   cloud -> a shading puff (city withers beneath it)
//   rain  -> a darker storm puff that rains
//   wind  -> a gust that pushes puffs around and disperses them
// Clouds shade the culture (sampled per building via shadowFactorAt) and drift on
// the wind. Light (the flashlight) punches through.
export function buildWeather() {
  const group = new THREE.Group();
  const tex = softDisc();

  // global wind vector (gusts add to it; it decays toward a gentle ambient drift)
  const wind = { x: 0.12, z: 0.05 };

  // puffs: {x,z,r,density,life,maxLife,raining}
  const puffs = [];

  // --- sprite pool for puffs ---
  const sprites = [];
  for (let i = 0; i < MAX_PUFFS; i++) {
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false });
    const sp = new THREE.Sprite(mat);
    sp.visible = false;
    group.add(sp);
    sprites.push(sp);
  }

  // --- rain pool (line streaks) ---
  const rainGeo = new THREE.BufferGeometry();
  const rpos = new Float32Array(RAIN_DROPS * 2 * 3);
  rainGeo.setAttribute("position", new THREE.BufferAttribute(rpos, 3));
  const rainMat = new THREE.LineBasicMaterial({ color: 0x9fc4e8, transparent: true, opacity: 0.5, depthWrite: false });
  const rain = new THREE.LineSegments(rainGeo, rainMat);
  rain.frustumCulled = false;
  group.add(rain);
  const drops = [];
  for (let i = 0; i < RAIN_DROPS; i++) drops.push({ x: 0, z: 0, y: -1, spd: 6 + Math.random() * 5, puff: -1 });

  // --- wind streak pool (short fading lines showing gusts) ---
  const windGeo = new THREE.BufferGeometry();
  const wpos = new Float32Array(WIND_STREAKS * 2 * 3);
  const wcol = new Float32Array(WIND_STREAKS * 2 * 3);
  windGeo.setAttribute("position", new THREE.BufferAttribute(wpos, 3));
  windGeo.setAttribute("color", new THREE.BufferAttribute(wcol, 3));
  const windMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending });
  const windLines = new THREE.LineSegments(windGeo, windMat);
  windLines.frustumCulled = false;
  group.add(windLines);
  const streaks = [];
  for (let i = 0; i < WIND_STREAKS; i++) streaks.push({ life: 0 });

  const params = { ambient: 0.0 }; // ambient overcast (0 = clear sky)
  let ambientPhase = 0;

  // ---- tools (called from pointer handlers) ----
  function paintCloud(x, z, raining) {
    [x, z] = clampToDish(x, z);
    // merge into a nearby same-type puff instead of stacking
    for (const p of puffs) {
      if (p.raining === raining && (p.x - x) ** 2 + (p.z - z) ** 2 < (p.r * 0.5) ** 2) {
        p.life = p.maxLife; p.density = Math.min(1, p.density + 0.06); return;
      }
    }
    if (puffs.length >= MAX_PUFFS) puffs.shift();
    const maxLife = raining ? 7 : 11;
    puffs.push({ x, z, r: raining ? 2.0 : 2.4, density: raining ? 0.85 : 0.6, life: maxLife, maxLife, raining });
  }
  function gust(x, z, dx, dz) {
    [x, z] = clampToDish(x, z, 1.2);
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len, uz = dz / len;
    // steer the global wind toward the gust
    wind.x = THREE.MathUtils.clamp(wind.x + ux * 0.9, -2.5, 2.5);
    wind.z = THREE.MathUtils.clamp(wind.z + uz * 0.9, -2.5, 2.5);
    // push & disperse nearby puffs
    for (const p of puffs) {
      const d2 = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d2 < 12) {
        const f = (1 - d2 / 12);
        p.x += ux * f * 1.2; p.z += uz * f * 1.2;
        p.life -= f * 1.5;          // gusts tear clouds apart
        p.density *= (1 - 0.15 * f);
      }
    }
    // spawn a visible streak
    for (const s of streaks) {
      if (s.life <= 0) {
        s.life = 1; s.x = x; s.z = z; s.y = 0.4 + Math.random() * CLOUD_Y;
        s.ux = ux; s.uz = uz; s.len = 1.4 + Math.random();
        break;
      }
    }
  }

  function update(dt) {
    dt = Math.min(dt, 0.05);
    ambientPhase += dt;
    // wind decays toward a gentle ambient drift
    wind.x += (0.12 - wind.x) * Math.min(1, dt * 0.3);
    wind.z += (0.05 - wind.z) * Math.min(1, dt * 0.3);

    // advance puffs
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i];
      p.x += wind.x * dt; p.z += wind.z * dt;
      p.life -= dt;
      // bounce gently at the rim so painted weather stays in view
      const r = Math.hypot(p.x, p.z);
      if (r > DISH_RADIUS * 1.15) { p.x *= 0.92; p.z *= 0.92; }
      if (p.life <= 0 || p.density < 0.05) { puffs.splice(i, 1); }
    }

    // draw puffs on sprite pool
    let si = 0;
    for (const p of puffs) {
      if (si >= sprites.length) break;
      const sp = sprites[si++];
      const fade = Math.min(1, p.life / 1.5) * Math.min(1, (p.maxLife - p.life) / 0.6 + 0.2);
      sp.visible = true;
      sp.position.set(p.x, CLOUD_Y + (p.raining ? -0.3 : 0), p.z);
      sp.scale.set(p.r * 2.4, p.r * 1.5, 1);
      sp.material.opacity = 0.9 * p.density * fade;
      sp.material.color.setHex(p.raining ? 0x8d97a4 : 0xdfe7ef);
    }
    for (; si < sprites.length; si++) sprites[si].visible = false;

    // rain: assign drops to raining puffs
    const rainingPuffs = puffs.filter((p) => p.raining);
    rain.visible = rainingPuffs.length > 0;
    if (rain.visible) {
      for (let i = 0; i < RAIN_DROPS; i++) {
        const d = drops[i];
        if (d.puff < 0 || d.puff >= rainingPuffs.length || d.y < 0.1) {
          const p = rainingPuffs[i % rainingPuffs.length];
          d.puff = i % rainingPuffs.length;
          const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * p.r;
          d.x = p.x + Math.cos(a) * rr; d.z = p.z + Math.sin(a) * rr; d.y = CLOUD_Y;
        }
        d.x += wind.x * dt * 0.5; d.z += wind.z * dt * 0.5;
        d.y -= d.spd * dt;
        const o = i * 6;
        rpos[o] = d.x; rpos[o + 1] = d.y; rpos[o + 2] = d.z;
        rpos[o + 3] = d.x + wind.x * 0.04; rpos[o + 4] = d.y - 0.35; rpos[o + 5] = d.z + wind.z * 0.04;
      }
      rainGeo.attributes.position.needsUpdate = true;
    }

    // wind streaks
    let anyStreak = false;
    for (let i = 0; i < streaks.length; i++) {
      const s = streaks[i];
      const o = i * 6;
      if (s.life > 0) {
        anyStreak = true;
        s.life -= dt * 1.6;
        s.x += s.ux * dt * 6; s.z += s.uz * dt * 6;
        const a = Math.max(0, s.life);
        wpos[o] = s.x; wpos[o + 1] = s.y; wpos[o + 2] = s.z;
        wpos[o + 3] = s.x - s.ux * s.len; wpos[o + 4] = s.y; wpos[o + 5] = s.z - s.uz * s.len;
        wcol[o] = 0.7 * a; wcol[o + 1] = 0.85 * a; wcol[o + 2] = 1.0 * a;
        wcol[o + 3] = 0; wcol[o + 4] = 0; wcol[o + 5] = 0;
      } else {
        wpos[o] = wpos[o + 3] = 0; wpos[o + 1] = wpos[o + 4] = -5; wpos[o + 2] = wpos[o + 5] = 0;
      }
    }
    windLines.visible = anyStreak;
    if (anyStreak) {
      windGeo.attributes.position.needsUpdate = true;
      windGeo.attributes.color.needsUpdate = true;
    }
  }

  // 0..1 fraction of direct sun reaching (x,z); 1 = clear, lower under cloud/storm
  function shadowFactorAt(x, z) {
    let shade = params.ambient * 0.7;
    for (const p of puffs) {
      const d2 = (x - p.x) ** 2 + (z - p.z) ** 2;
      const lifeFade = Math.min(1, p.life / 1.5);
      shade += p.density * lifeFade * Math.exp(-d2 / (2 * p.r * p.r));
    }
    return THREE.MathUtils.clamp(1 - shade, 0.04, 1);
  }

  return {
    group, update, shadowFactorAt, params,
    paintCloud, gust,
    get puffCount() { return puffs.length; },
    clear() { puffs.length = 0; },
  };
}
