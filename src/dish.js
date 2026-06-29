import * as THREE from "three";
import { DISH_RADIUS, DISH_WALL_HEIGHT } from "./config.js";

const FLOOR_Y = -0.5;

export function buildDish() {
  const group = new THREE.Group();

  // Cheap "glass" — no transmission pass (which would re-render the whole scene
  // every frame). A faint transparent shell + a bright rim reads as a vessel and
  // catches the bloom just as well, at a fraction of the cost.
  const glass = new THREE.MeshStandardMaterial({
    color: 0xbfe0ff,
    metalness: 0.0,
    roughness: 0.5,
    envMapIntensity: 0.35,
    transparent: true,
    opacity: 0.05,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  // outer wall
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(DISH_RADIUS, DISH_RADIUS, DISH_WALL_HEIGHT, 128, 1, true),
    glass
  );
  wall.position.y = FLOOR_Y + DISH_WALL_HEIGHT / 2;
  wall.renderOrder = 3;
  group.add(wall);

  // glass floor (slightly thicker disc)
  const floor = new THREE.Mesh(
    new THREE.CylinderGeometry(DISH_RADIUS, DISH_RADIUS, 0.18, 128),
    glass
  );
  floor.position.y = FLOOR_Y - 0.02;
  floor.renderOrder = 1;
  group.add(floor);

  // rim highlight
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(DISH_RADIUS, 0.05, 16, 160),
    new THREE.MeshStandardMaterial({ color: 0xdff0ff, roughness: 0.1, metalness: 0.4,
      emissive: 0x223344, emissiveIntensity: 0.4 })
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = FLOOR_Y + DISH_WALL_HEIGHT;
  group.add(rim);

  // faint agar substrate the terrain sits on
  const agar = new THREE.Mesh(
    new THREE.CircleGeometry(DISH_RADIUS * 0.985, 96),
    new THREE.MeshStandardMaterial({ color: 0x0c1a18, roughness: 1.0, transparent: true, opacity: 0.6 })
  );
  agar.rotation.x = -Math.PI / 2;
  agar.position.y = FLOOR_Y + 0.02;
  group.add(agar);

  // the lab bench / void floor
  const bench = new THREE.Mesh(
    new THREE.CircleGeometry(DISH_RADIUS * 4, 96),
    new THREE.MeshStandardMaterial({ color: 0x070a0e, roughness: 0.5, metalness: 0.3 })
  );
  bench.rotation.x = -Math.PI / 2;
  bench.position.y = FLOOR_Y - 0.12;
  bench.receiveShadow = true;
  group.add(bench);

  return group;
}
