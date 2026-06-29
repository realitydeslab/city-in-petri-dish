import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import { SHARE_RADIUS, MAX_LINKS } from "./config.js";

// Build a spatial energy-sharing graph over the building plots and partition it
// into energy communities (districts) à la Zhuang et al. "Across Scales:
// Hierarchical Urban Graph ... Decentralized Energy Autonomy" (ACADIA 2024).
export function buildEnergyGraph(plots) {
  const graph = new Graph({ type: "undirected" });
  for (let i = 0; i < plots.length; i++) graph.addNode(i, { x: plots[i].x, z: plots[i].z });

  const links = []; // {a, b}
  for (let i = 0; i < plots.length; i++) {
    // nearest neighbours within SHARE_RADIUS, capped at MAX_LINKS
    const cand = [];
    for (let j = 0; j < plots.length; j++) {
      if (i === j) continue;
      const d = Math.hypot(plots[i].x - plots[j].x, plots[i].z - plots[j].z);
      if (d < SHARE_RADIUS) cand.push({ j, d });
    }
    cand.sort((a, b) => a.d - b.d);
    for (let k = 0; k < Math.min(MAX_LINKS, cand.length); k++) {
      const j = cand[k].j;
      if (!graph.hasEdge(i, j)) { graph.addEdge(i, j, { w: 1 / (cand[k].d + 0.01) }); links.push({ a: i, b: j }); }
    }
  }

  // community detection => districts (the self-organised hierarchy)
  louvain.assign(graph, { resolution: 1.0 });
  const community = new Int32Array(plots.length);
  let maxC = 0;
  graph.forEachNode((node, attr) => {
    const c = attr.community ?? 0;
    community[+node] = c;
    if (c > maxC) maxC = c;
  });

  return { graph, links, community, communityCount: maxC + 1 };
}

// Two-level hierarchical redistribution: pool within each district first
// (decentralised community sharing), then settle district surpluses/deficits
// at the city scale. Mirrors the "across scales" energy-autonomy idea.
//
// Inputs (per plot, typed arrays): gen, demand, alive (0/1)
// Outputs: satisfaction[i] in 0..1 (how much of demand was met),
//          plus an aggregate autonomy ratio for the readout.
export function redistribute(state, eg, sharing) {
  const n = state.gen.length;
  const { community, communityCount } = eg;
  const sat = state.satisfaction;

  if (!sharing) {
    let totGen = 0, totDem = 0;
    for (let i = 0; i < n; i++) {
      if (!state.alive[i]) { sat[i] = 0; continue; }
      sat[i] = state.demand[i] > 0 ? Math.min(1, state.gen[i] / state.demand[i]) : 1;
      totGen += state.gen[i]; totDem += state.demand[i];
    }
    return totDem > 0 ? Math.min(1, totGen / totDem) : 0;
  }

  // --- level 1: within-community pooling ---
  const cGen = new Float64Array(communityCount);
  const cDem = new Float64Array(communityCount);
  for (let i = 0; i < n; i++) {
    if (!state.alive[i]) { sat[i] = 0; continue; }
    cGen[community[i]] += state.gen[i];
    cDem[community[i]] += state.demand[i];
  }

  // --- level 2: city pool of community surpluses ---
  let cityPool = 0, cityNeed = 0;
  for (let c = 0; c < communityCount; c++) {
    if (cGen[c] >= cDem[c]) cityPool += cGen[c] - cDem[c];
    else cityNeed += cDem[c] - cGen[c];
  }
  const cityFill = cityNeed > 0 ? Math.min(1, cityPool / cityNeed) : 1;

  // effective supply available to each community after city-level transfer
  const cSupply = new Float64Array(communityCount);
  for (let c = 0; c < communityCount; c++) {
    if (cGen[c] >= cDem[c]) cSupply[c] = cDem[c]; // its own demand met; surplus exported
    else cSupply[c] = cGen[c] + (cDem[c] - cGen[c]) * cityFill;
  }

  // distribute community supply to its members proportional to demand
  let totGen = 0, totDem = 0;
  for (let i = 0; i < n; i++) {
    if (!state.alive[i]) continue;
    const c = community[i];
    const frac = cDem[c] > 0 ? cSupply[c] / cDem[c] : 1;
    sat[i] = Math.min(1, frac); // demand-weighted share
    totGen += state.gen[i]; totDem += state.demand[i];
  }
  return totDem > 0 ? Math.min(1, totGen / totDem) : 0;
}
