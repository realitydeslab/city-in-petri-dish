// Shared constants for the installation.
// The whole "culture" lives inside a petri dish of radius DISH_RADIUS, centred at origin.

export const DISH_RADIUS = 10;       // world units
export const DISH_WALL_HEIGHT = 1.4; // glass rim height
export const LAND_RADIUS = 9.75;     // terrain disc radius (fills up to the rim)

export const TERRAIN_SEGMENTS = 150; // heightfield resolution
export const TERRAIN_MAX_HEIGHT = 2.1;

// San Francisco geographic anchor (for SunCalc — real sun path).
export const SF = { lat: 37.7749, lon: -122.4194 };

// Buildings
export const BUILDING_COUNT = 460;
export const DOWNTOWN_MAX_HEIGHT = 2.6;   // financial district towers
export const SUBURB_MAX_HEIGHT = 0.45;

// Energy model
export const SHARE_RADIUS = 1.15;   // buildings link to neighbours within this distance
export const MAX_LINKS = 4;         // links per building (keeps the graph legible)

// Downtown / hill anchors in normalised dish space (x,z in [-1,1]); +z = north.
// Stylised but SF-flavoured: financial district hugs the NE bay shore,
// Twin Peaks ridge runs through the middle, hills to the north.
export const ANCHORS = {
  downtown:   { x:  0.42, z:  0.34, r: 0.30 }, // Financial District (NE, by the bay)
  twinPeaks:  { x: -0.06, z: -0.10, r: 0.42, h: 1.0 },
  mtSutro:    { x: -0.18, z:  0.06, r: 0.26, h: 0.78 },
  nobHill:    { x:  0.20, z:  0.30, r: 0.20, h: 0.55 },
  potrero:    { x:  0.30, z: -0.34, r: 0.24, h: 0.5 },
  richmond:   { x: -0.55, z:  0.30, r: 0.30, h: 0.18 },
  sunset:     { x: -0.45, z: -0.30, r: 0.34, h: 0.16 },
};

// Circular island that fills the dish: land everywhere, fading to a thin coastal
// ring at the rim, with one subtle bay notch on the NE shore for SF character.
export function landMask(nx, nz) {
  // nx,nz in [-1,1]. Returns 0..1 (1 = solid land, 0 = open water).
  const r = Math.hypot(nx, nz);
  // radial coastline: solid land out to ~0.9, beach ring, water only past the rim
  let m = smooth(1.0, 0.86, r);
  // a single bay notch biting in from the NE shore (the SF bay), kept small
  const inlet = dist(nx, nz, 0.78, 0.36);
  m *= smooth(0.10, 0.26, inlet);
  return clamp01(m);
}

function smooth(edge0, edge1, x) {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
function dist(ax, az, bx, bz) { return Math.hypot(ax - bx, az - bz); }
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
