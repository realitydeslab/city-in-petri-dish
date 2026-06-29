# City in a Petri Dish

An interactive artwork for **ALIFE 2026** (Art track). A solar-energy culture of
San Francisco grows inside a petri dish: buildings are organisms, sunlight is the
nutrient, and the viewer wields a flashlight as the selective pressure. Where light
falls, the city thrives and grows taller; where shadow falls, it withers and dies.
When the buildings **share energy**, a hierarchy of self-organising districts
emerges that keeps shadowed neighbourhoods alive — visualising the decentralised
energy-autonomy research of **Xinwei Zhuang** (https://xinwei-zhuang.github.io/).

## Run

```bash
npm install
npm run dev        # open the printed http://localhost:5173 URL
npm run build      # static, offline bundle in dist/ (for the exhibition kiosk)
npm run preview    # serve the production build locally
```

## Interact

The viewer wields four elemental **tools** over the culture (palette on the left,
or keys **1–4**):

- **☀ Light** (1) — move the cursor to shine the flashlight. The lit region gains an
  energy surplus and grows; sweep it and the city continuously reconfigures.
- **☁ Cloud** (2) — drag to paint drifting clouds. They shade the culture beneath
  them (less sun → withering) and blow on the wind.
- **🌧 Rain** (3) — drag to summon storms: darker clouds that rain and starve the
  city of light more aggressively.
- **≋ Wind** (4) — drag to gust. Pushes clouds across the dish and tears them apart,
  clearing the sky.

(Weather tools paint by dragging, so camera-rotate is suspended while one is
selected; switch back to Light, or use scroll to zoom, to move the camera.
*overcast* and *clear sky* live in the weather GUI folder.)
- **GUI panel (top-right)**
  - *sunlight*: time of day, day of year (real SF sun path via SunCalc), sky clarity,
    and an "animate day" toggle that runs a full diurnal cycle.
  - *energy*: `share energy` (on = shadowed districts survive on shared surplus);
    `show network` dims the city to a substrate and reveals the sharing graph —
    gold = giver (solar surplus), cyan = receiver (deficit), with energy packets
    streaming gold→cyan along the active edges; `show districts` colours buildings
    by the self-organised energy communities (the hierarchy); `life speed` scales
    the growth/decay pace for capture.
  - *view*: auto-rotate, glow (bloom) amount, and `reseed culture`.
- **H** — toggle the text/GUI overlay (for clean capture). `?clean` in the URL
  starts with the overlay hidden.

## Capturing the submission video

The simulation uses `requestAnimationFrame`, which browsers **throttle in
background tabs** — so record with the tab focused and in the foreground.

Suggested 60–90s shot list:
1. **Establishing** — `?clean`, auto-rotate on, midday (13:00), sky clarity high,
   `share energy` + `show network` on. The full city glows; gold = solar
   generators (suburbs), cyan = the dense downtown sink fed by the network.
2. **Diurnal** — enable *animate day*; let the sun arc to dusk. Watch the harvest
   fall and the unlit periphery begin to wither.
3. **The flashlight** — at dusk (≈20:20) turn *share energy* OFF; the culture dies
   back to dark. Now sweep the cursor across the dish; a living district blooms
   under the beam and follows it — the city chasing the light.
4. **The thesis** — turn *share energy* back ON while holding the light on one
   district; the surplus pipes outward along the network and distant
   neighbourhoods flicker back to life. Toggle *show districts* to reveal the
   self-organised hierarchy.

macOS screen capture: QuickTime (File ▸ New Screen Recording) or `⇧⌘5`.

## Architecture

Plain Vite + three.js, no backend. One module per concept:

| File | Role |
|---|---|
| `src/dish.js` | the glass petri dish, rim, agar substrate, lab void |
| `src/terrain.js` | stylised SF heightfield (Twin Peaks ridge, bay inlet, coast) |
| `src/city.js` | building organisms (InstancedMesh), the light→growth/death model |
| `src/energy.js` | spatial sharing graph + Louvain districts + hierarchical redistribution |
| `src/sun.js` | real SF sun geometry (SunCalc) → directional light + `sunFactor` |
| `src/flashlight.js` | pointer-driven beam: casts light/shadow and injects growth energy |
| `src/main.js` | scene, environment-lit glass, bloom, controls, UI, loop |

### The model (one line)
Each building's fitness `f = generation / demand`. Generation ∝ light × footprint
(rooftop + facade); demand ∝ floors. `f > 1` → vitality and height grow; `f < 1` →
they decay unless the energy network covers the deficit. Sun follows SF's real
solar path; the flashlight adds a local light surplus.

## Roadmap (post-deadline)
- Swap the stylised terrain/footprints for real **DataSF** building footprints (CC0)
  and a USGS DEM heightmap.
- Replace the approximate shadow term with Zhuang et al.'s **vector shadow
  projection** for physically-faithful per-facade irradiance (kWh/m²).
- WebGPU agent layer (slime-mold growth fronts) deciding *where* new buildings seed.

## Credits
Concept & code: collaboration referencing the urban-solar / energy-graph research of
**Xinwei Zhuang** (Texas A&M; PhD UC Berkeley / LBNL). Key references:
*Rapid Assessment of Solar Potential … Vector Processing* (Solar Energy, 2025);
*Across Scales: Hierarchical Urban Graph … Decentralized Energy Autonomy* (ACADIA 2024);
*Synthesis and Generation for 3D Architecture Volume* (IJAC, 2023).
