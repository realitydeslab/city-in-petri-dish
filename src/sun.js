import * as THREE from "three";
import SunCalc from "suncalc";
import { SF, DISH_RADIUS } from "./config.js";

// The "sun" is a lamp over the petri dish, but it follows San Francisco's real
// solar geometry (SunCalc) for the chosen time of day and day of year.
export function buildSun(scene) {
  const light = new THREE.DirectionalLight(0xffffff, 1.0);
  light.castShadow = true;
  light.shadow.mapSize.set(1536, 1536);
  const cam = light.shadow.camera;
  cam.near = 1; cam.far = 60;
  cam.left = -DISH_RADIUS * 1.2; cam.right = DISH_RADIUS * 1.2;
  cam.top = DISH_RADIUS * 1.2; cam.bottom = -DISH_RADIUS * 1.2;
  light.shadow.bias = -0.0008;
  light.target.position.set(0, 0, 0);
  scene.add(light, light.target);

  const ambient = new THREE.HemisphereLight(0x88a0c0, 0x101418, 0.25);
  scene.add(ambient);

  // a visible glowing sun disc (catches bloom)
  const sunDisc = new THREE.Mesh(
    new THREE.SphereGeometry(0.9, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xffe6b0 })
  );
  scene.add(sunDisc);

  const warm = new THREE.Color(0xffb060);
  const cool = new THREE.Color(0xfff4e2);
  const R = DISH_RADIUS * 2.4;

  // params updated from UI
  const params = { hour: 13.5, day: 172, quality: 0.85 }; // quality: 1 clear .. 0 hazy

  function apply() {
    // day-of-year + fractional hour -> a concrete local SF datetime
    const d = new Date(2026, 0, 1 + (params.day - 1),
      Math.floor(params.hour), Math.round((params.hour % 1) * 60), 0);

    const pos = SunCalc.getPosition(d, SF.lat, SF.lon);
    const a = pos.altitude;          // radians above horizon
    const phi = pos.azimuth;         // from south, + toward west

    const dir = new THREE.Vector3(
      -Math.sin(phi) * Math.cos(a),
      Math.sin(a),
      -Math.cos(phi) * Math.cos(a)
    );
    light.position.copy(dir).multiplyScalar(R);
    sunDisc.position.copy(dir).multiplyScalar(R * 0.92);
    sunDisc.visible = a > -0.05;

    const above = Math.max(0, Math.sin(a)); // 0 at/under horizon, 1 at zenith
    // "quality": clear skies => strong direct + crisp shadows; hazy => soft, dimmer direct, more ambient
    const direct = above * (0.35 + 0.95 * params.quality);
    light.intensity = direct * 1.6;
    light.color.copy(warm).lerp(cool, Math.min(1, above * 1.6));
    light.castShadow = params.quality > 0.25 && above > 0.02;

    ambient.intensity = 0.12 + (1 - params.quality) * 0.55 * (0.3 + above) + above * 0.12;
    sunDisc.material.color.copy(warm).lerp(cool, above);

    // sunFactor drives photosynthesis in the energy model
    sun.sunFactor = above * (0.4 + 0.6 * params.quality);
    sun.altitude = a;
  }

  const sun = { light, ambient, sunDisc, params, apply, sunFactor: 0.8, altitude: 0.5 };
  apply();
  return sun;
}
