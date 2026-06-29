import * as THREE from "three";
import { DISH_RADIUS } from "./config.js";

const FLASH_RADIUS = 2.6;     // world radius of the energising pool
const FLASH_STRENGTH = 1.8;   // peak light added to the energy model

// A hand-held beam the viewer sweeps across the dish. It both lights the scene
// (real spotlight + shadows) and injects growth energy where it lands.
export function buildFlashlight(scene, camera) {
  const target = new THREE.Object3D();
  target.position.set(0, 0, 0);
  scene.add(target);

  const spot = new THREE.SpotLight(0xfff1d0, 220, 0, Math.PI * 0.16, 0.45, 1.3);
  spot.castShadow = true;
  spot.shadow.mapSize.set(512, 512);
  spot.shadow.camera.near = 1;
  spot.shadow.camera.far = 30;
  spot.shadow.bias = -0.0012;
  spot.target = target;
  scene.add(spot);

  // glowing pool where the beam meets the ground (reads on camera + bloom)
  const pool = new THREE.Mesh(
    new THREE.CircleGeometry(FLASH_RADIUS, 48),
    new THREE.MeshBasicMaterial({
      color: 0xffe9b8, transparent: true, opacity: 0.16,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  pool.rotation.x = -Math.PI / 2;
  scene.add(pool);

  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3(0, 0, 0);
  const ndc = new THREE.Vector2();
  let active = false;

  function setFromPointer(clientX, clientY, w, h) {
    ndc.set((clientX / w) * 2 - 1, -(clientY / h) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (ray.ray.intersectPlane(plane, hit)) {
      // clamp to dish
      const r = Math.hypot(hit.x, hit.z);
      if (r > DISH_RADIUS) { hit.x *= DISH_RADIUS / r; hit.z *= DISH_RADIUS / r; }
      active = true;
    }
  }

  // smoothed beam position
  const cur = new THREE.Vector3(0, 0, 0);
  function update(dt) {
    cur.lerp(hit, Math.min(1, 9 * dt));
    target.position.copy(cur);
    // beam comes in at an angle => long expressive shadows
    spot.position.set(cur.x + 3.2, 9.5, cur.z + 3.2);
    pool.position.set(cur.x, 0.06, cur.z);
    pool.material.opacity = active ? 0.18 : 0.0;
    spot.intensity = active ? 220 : 0;
  }

  // radial energy injection used by the growth model
  function lightAt(x, z) {
    if (!active) return 0;
    const d = Math.hypot(x - cur.x, z - cur.z);
    const f = Math.exp(-(d * d) / (2 * (FLASH_RADIUS * 0.5) ** 2));
    return FLASH_STRENGTH * f;
  }

  function setWorld(x, z) { hit.set(x, 0, z); active = true; }

  // non-mutating: raycast screen -> ground, return {x,z} (clamped to dish) or null
  const pickV = new THREE.Vector3();
  function pick(clientX, clientY, w, h) {
    ndc.set((clientX / w) * 2 - 1, -(clientY / h) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    if (!ray.ray.intersectPlane(plane, pickV)) return null;
    let x = pickV.x, z = pickV.z;
    const r = Math.hypot(x, z);
    if (r > DISH_RADIUS) { x *= DISH_RADIUS / r; z *= DISH_RADIUS / r; }
    return { x, z };
  }

  return { spot, pool, target, update, setFromPointer, lightAt, setWorld, pick,
    setActive: (v) => { active = v; } };
}
