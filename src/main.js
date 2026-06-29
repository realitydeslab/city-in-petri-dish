import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import GUI from "lil-gui";

import { buildDish } from "./dish.js";
import { buildTerrain } from "./terrain.js";
import { buildCity } from "./city.js";
import { buildSun } from "./sun.js";
import { buildFlashlight } from "./flashlight.js";
import { buildWeather } from "./weather.js";

const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04060a);
scene.fog = new THREE.FogExp2(0x04060a, 0.018);

// environment for the glass
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(0, 13, 18);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.4, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 8;
controls.maxDistance = 40;
controls.maxPolarAngle = Math.PI * 0.49;
controls.autoRotateSpeed = 0.45;

// --- build the world -------------------------------------------------------
scene.add(buildDish());
scene.add(buildTerrain());
const sun = buildSun(scene);
const city = buildCity();
scene.add(city.mesh, city.lines, city.flow);
const flashlight = buildFlashlight(scene, camera);
const weather = buildWeather();
scene.add(weather.group);
window.__petri = { city, sun, flashlight, weather, get settings() { return settings; } };

// --- postprocessing --------------------------------------------------------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight), 0.6, 0.5, 0.62
);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// --- adaptive resolution: keep frame time low on any hardware ---------------
const SCALE_MAX = Math.min(window.devicePixelRatio, 1.5);
const SCALE_MIN = 0.6;
let renderScale = SCALE_MAX;
function setScale(s) {
  renderScale = THREE.MathUtils.clamp(s, SCALE_MIN, SCALE_MAX);
  renderer.setPixelRatio(renderScale);
  composer.setPixelRatio(renderScale);
}
setScale(SCALE_MAX);

// debug/capture hooks (used to verify behaviour even when rAF is throttled)
window.__petri.renderNow = () => composer.render();
window.__petri.step = (n = 1, dt = 0.03) => {
  for (let k = 0; k < n; k++) {
    flashlight.update(dt);
    weather.update(dt);
    city.update(dt, {
      sunFactor: sun.sunFactor, lightAt: flashlight.lightAt, cloudAt: weather.shadowFactorAt,
      sharing: settings.sharing, showNetwork: settings.showNetwork, showDistricts: settings.showDistricts,
    });
  }
  city.lines.visible = settings.sharing && settings.showNetwork;
  composer.render();
};

// --- interaction -----------------------------------------------------------
const settings = {
  hour: 13.5, day: 172, quality: 0.85,
  tool: "light", // light | cloud | rain | wind
  autoSun: false, sharing: true, showNetwork: true, showDistricts: false,
  autoRotate: true, bloom: 0.6, lifeSpeed: 1.0, adaptiveRes: true,
  reseed: () => city.reseed(),
  clearWeather: () => weather.clear(),
};

function pushSun() { sun.params.hour = settings.hour; sun.params.day = settings.day; sun.params.quality = settings.quality; sun.apply(); }
pushSun();

const gui = new GUI({ title: "petri dish" });
const fSun = gui.addFolder("sunlight");
fSun.add(settings, "hour", 0, 24, 0.1).name("time of day").onChange(pushSun);
fSun.add(settings, "day", 1, 365, 1).name("day of year").onChange(pushSun);
fSun.add(settings, "quality", 0, 1, 0.01).name("sky clarity").onChange(pushSun);
fSun.add(settings, "autoSun").name("animate day");
const fWeather = gui.addFolder("weather");
const toolCtl = fWeather.add(settings, "tool", ["light", "cloud", "rain", "wind"]).name("tool (1-4)");
fWeather.add(weather.params, "ambient", 0, 1, 0.01).name("overcast");
fWeather.add(settings, "clearWeather").name("clear sky");
const fEnergy = gui.addFolder("energy");
fEnergy.add(settings, "sharing").name("share energy");
fEnergy.add(settings, "showNetwork").name("show network");
fEnergy.add(settings, "showDistricts").name("show districts");
fEnergy.add(settings, "lifeSpeed", 0.2, 3, 0.05).name("life speed");
const fView = gui.addFolder("view");
fView.add(settings, "autoRotate").name("auto-rotate");
fView.add(settings, "bloom", 0, 2, 0.01).name("glow").onChange((v) => (bloom.strength = v));
fView.add(settings, "adaptiveRes").name("adaptive res");
gui.add(settings, "reseed").name("reseed culture");

// pointer drives the selected tool
let pointerDown = false;
let lastPaint = { x: 1e9, z: 1e9 };
let lastPos = null;

function applyTool(e, isDrag) {
  const w = window.innerWidth, h = window.innerHeight;
  if (settings.tool === "light") {
    flashlight.setFromPointer(e.clientX, e.clientY, w, h);
    return;
  }
  flashlight.setActive(false);
  const p = flashlight.pick(e.clientX, e.clientY, w, h);
  if (!p) return;
  if (settings.tool === "wind") {
    if (isDrag && lastPos) gust(p, p.x - lastPos.x, p.z - lastPos.z);
  } else if (settings.tool === "cloud" || settings.tool === "rain") {
    // throttle puff creation by distance so a drag paints an even band
    const moved = (p.x - lastPaint.x) ** 2 + (p.z - lastPaint.z) ** 2;
    if (moved > 1.0 || !isDrag) {
      weather.paintCloud(p.x, p.z, settings.tool === "rain");
      lastPaint = { x: p.x, z: p.z };
    }
  }
  lastPos = p;
}
function gust(p, dx, dz) { weather.gust(p.x, p.z, dx, dz); }

window.addEventListener("pointermove", (e) => {
  if (settings.tool === "light") { applyTool(e, false); return; }
  const w = window.innerWidth, h = window.innerHeight;
  lastPos = flashlight.pick(e.clientX, e.clientY, w, h) || lastPos;
  if (pointerDown) applyTool(e, true);
});
canvas.addEventListener("pointerdown", (e) => {
  pointerDown = true;
  const w = window.innerWidth, h = window.innerHeight;
  lastPos = flashlight.pick(e.clientX, e.clientY, w, h);
  if (settings.tool !== "light") applyTool(e, false);
});
window.addEventListener("pointerup", () => { pointerDown = false; });
canvas.addEventListener("pointerleave", () => { flashlight.setActive(false); pointerDown = false; });

// selecting a tool: weather tools paint by dragging, so suspend camera-rotate
const HINTS = {
  light: "shine the flashlight · the lit city grows",
  cloud: "drag to paint clouds · the shaded city withers",
  rain: "drag to summon storms · rain darkens the culture",
  wind: "drag to gust · push the clouds across the dish",
};
const toolButtons = [...document.querySelectorAll(".tool")];
const hintText = document.getElementById("hint-text");
function updateToolChip() {
  toolButtons.forEach((b) => b.classList.toggle("active", b.dataset.tool === settings.tool));
  if (hintText) hintText.textContent = HINTS[settings.tool];
}
function setTool(t) {
  settings.tool = t;
  toolCtl.updateDisplay();
  controls.enableRotate = t === "light"; // drag = paint for weather tools
  if (t !== "light") flashlight.setActive(false);
  updateToolChip();
}
toolCtl.onChange(setTool);
toolButtons.forEach((b) => b.addEventListener("click", () => setTool(b.dataset.tool)));
updateToolChip();

// clean capture mode: ?clean in URL, or press H; number keys pick tools
if (new URLSearchParams(location.search).has("clean")) document.body.classList.add("clean");
window.addEventListener("keydown", (e) => {
  if (e.key === "h" || e.key === "H") document.body.classList.toggle("clean");
  else if (e.key === "1") setTool("light");
  else if (e.key === "2") setTool("cloud");
  else if (e.key === "3") setTool("rain");
  else if (e.key === "4") setTool("wind");
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// --- readout ---------------------------------------------------------------
const dom = {
  time: document.getElementById("m-time"),
  sun: document.getElementById("m-sun"),
  harvest: document.getElementById("m-harvest"),
  autonomy: document.getElementById("m-autonomy"),
  districts: document.getElementById("m-districts"),
};
let readoutT = 0;
function updateReadout() {
  const h = Math.floor(settings.hour);
  const m = Math.round((settings.hour % 1) * 60).toString().padStart(2, "0");
  dom.time.textContent = `${h.toString().padStart(2, "0")}:${m}`;
  dom.sun.textContent = `${Math.max(0, Math.round((sun.altitude * 180) / Math.PI))}° · ${Math.round(settings.quality * 100)}%`;
  const mtr = city.metrics;
  dom.harvest.textContent = (mtr.harvest * 1.3).toFixed(1);
  dom.autonomy.textContent = settings.sharing ? `${Math.round(mtr.autonomy * 100)}%` : "isolated";
  dom.districts.textContent = settings.showDistricts && settings.sharing
    ? `${mtr.districts}` : `${mtr.aliveCount}/${mtr.total} alive`;
}

// --- loop ------------------------------------------------------------------
const fpsEl = document.getElementById("fps");
const clock = new THREE.Clock();
let fpsT = 0, fpsFrames = 0, smoothFps = 60, adaptCooldown = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();

  if (settings.autoSun) {
    settings.hour = (settings.hour + dt * 1.2) % 24;
    pushSun();
  }

  flashlight.update(dt);
  weather.update(dt);
  city.update(dt * settings.lifeSpeed, {
    sunFactor: sun.sunFactor,
    lightAt: flashlight.lightAt,
    cloudAt: weather.shadowFactorAt,
    sharing: settings.sharing,
    showNetwork: settings.showNetwork,
    showDistricts: settings.showDistricts,
  });
  city.lines.visible = settings.sharing && settings.showNetwork;

  controls.autoRotate = settings.autoRotate;
  controls.update();

  readoutT += dt;
  if (readoutT > 0.2) { updateReadout(); readoutT = 0; }

  composer.render();

  // --- fps meter + adaptive resolution -------------------------------------
  fpsFrames++; fpsT += dt; adaptCooldown -= dt;
  if (fpsT >= 0.5) {
    const fps = fpsFrames / fpsT;
    smoothFps = smoothFps * 0.5 + fps * 0.5;
    fpsFrames = 0; fpsT = 0;
    if (fpsEl) fpsEl.textContent = `${Math.round(smoothFps)} fps · ${renderScale.toFixed(2)}×`;
    // adapt render scale toward a smooth ~58fps target (display-capped).
    // skip while the tab is hidden — its low fps is throttling, not GPU load.
    if (settings.adaptiveRes && adaptCooldown <= 0 && !document.hidden) {
      if (smoothFps < 50 && renderScale > SCALE_MIN) { setScale(renderScale - 0.15); adaptCooldown = 1.5; }
      else if (smoothFps > 58 && renderScale < SCALE_MAX) { setScale(renderScale + 0.1); adaptCooldown = 2.5; }
    }
  }
}
animate();
