'use strict';

// ── Pure JS road network graph using adjacency list + Dijkstra ────────
// No external dependencies — works with your existing road GeoJSON data

const networkService = {
  graph: new Map(),   // node_key → [{to, dist, roadId}]
  nodes: new Map(),   // node_key → {lon, lat}
  built: false,

  // ── Build graph from road features ───────────────────────────────────
  buildFromRoads(roads) {
    this.graph.clear();
    this.nodes.clear();
    this.built = false;
    let edgeCount = 0;

    for (const road of roads) {
      if (!road.geojson) continue;
      let geom;
      try { geom = JSON.parse(road.geojson); } catch { continue; }

      const segments = geom.type === 'MultiLineString'
        ? geom.coordinates : [geom.coordinates];

      for (const seg of segments) {
        if (!seg || seg.length < 2) continue;
        // Add each consecutive pair of coordinates as a graph edge
        for (let i = 0; i < seg.length - 1; i++) {
          const [lon1, lat1] = seg[i];
          const [lon2, lat2] = seg[i + 1];
          if (!lon1 || !lat1 || !lon2 || !lat2) continue;

          const dist = this._haversine(lon1, lat1, lon2, lat2);
          if (dist < 0.001) continue; // skip zero-length

          const k1 = this._snap(lon1, lat1);
          const k2 = this._snap(lon2, lat2);

          // Store nodes
          if (!this.nodes.has(k1)) this.nodes.set(k1, { lon: lon1, lat: lat1 });
          if (!this.nodes.has(k2)) this.nodes.set(k2, { lon: lon2, lat: lat2 });

          // Bidirectional edges
          if (!this.graph.has(k1)) this.graph.set(k1, []);
          if (!this.graph.has(k2)) this.graph.set(k2, []);
          this.graph.get(k1).push({ to: k2, dist, roadId: road.id });
          this.graph.get(k2).push({ to: k1, dist, roadId: road.id });
          edgeCount++;
        }
      }
    }

    this.built = true;
    console.log(`   ✅ Network: ${this.nodes.size} nodes, ${edgeCount} edges`);
    return { nodes: this.nodes.size, edges: edgeCount };
  },

  // ── Snap coordinate to grid (5 decimal places ≈ 1m precision) ────────
  _snap(lon, lat) {
    return `${lon.toFixed(4)}_${lat.toFixed(4)}`;
  },

  // ── Find nearest network node to a lon/lat point ──────────────────────
  nearestNode(lon, lat) {
    let best = null, bestDist = Infinity;
    for (const [key, node] of this.nodes) {
      const d = this._haversine(lon, lat, node.lon, node.lat);
      if (d < bestDist) { bestDist = d; best = key; }
    }
    return { key: best, snapDist: bestDist };
  },

  // ── Dijkstra shortest path ────────────────────────────────────────────
  dijkstra(startKey, endKey) {
    if (!this.graph.has(startKey) || !this.graph.has(endKey)) return null;
    if (startKey === endKey) return { dist: 0, path: [startKey] };

    const dist  = new Map([[startKey, 0]]);
    const prev  = new Map();
    const queue = new Set(this.graph.keys()); // simple set-based priority queue

    // Initialize all distances to Infinity
    for (const key of this.graph.keys()) {
      if (key !== startKey) dist.set(key, Infinity);
    }

    while (queue.size > 0) {
      // Find minimum distance node in queue
      let u = null;
      for (const key of queue) {
        if (u === null || (dist.get(key) ?? Infinity) < (dist.get(u) ?? Infinity)) u = key;
      }
      if (u === null || (dist.get(u) ?? Infinity) === Infinity) break;
      if (u === endKey) break;
      queue.delete(u);

      for (const { to, dist: edgeDist } of (this.graph.get(u) || [])) {
        if (!queue.has(to)) continue;
        const alt = (dist.get(u) ?? Infinity) + edgeDist;
        if (alt < (dist.get(to) ?? Infinity)) {
          dist.set(to, alt);
          prev.set(to, u);
        }
      }
    }

    const totalDist = dist.get(endKey) ?? Infinity;
    if (totalDist === Infinity) return null;

    // Reconstruct path
    const path = [];
    let cur = endKey;
    while (cur !== undefined) { path.unshift(cur); cur = prev.get(cur); }

    return { dist: totalDist, path };
  },

  // ── Network distance from point to nearest school ─────────────────────
  networkDistToNearestSchool(fromLon, fromLat, schools) {
    if (!this.built || this.nodes.size === 0) {
      // Fallback to straight-line if no network
      return this._straightLineNearest(fromLon, fromLat, schools);
    }

    const { key: fromNode, snapDist: fromSnap } = this.nearestNode(fromLon, fromLat);
    if (!fromNode) return this._straightLineNearest(fromLon, fromLat, schools);

    let best = null, bestNetDist = Infinity;

    for (const school of schools) {
      if (!school.lon || !school.lat) continue;
      const { key: toNode, snapDist: toSnap } = this.nearestNode(school.lon, school.lat);
      if (!toNode) continue;

      let netDist;
      if (fromNode === toNode) {
        netDist = 0;
      } else {
        const result = this.dijkstra(fromNode, toNode);
        netDist = result ? result.dist : Infinity;
      }

      // Total = snap distance to network + network distance + snap from network to school
      const total = fromSnap + netDist + toSnap;

      if (total < bestNetDist) {
        bestNetDist = total;
        best = {
          school,
          networkDist: netDist,
          totalDist:   total,
          snapToNet:   fromSnap,
          snapFromNet: toSnap,
          onNetwork:   netDist < Infinity,
        };
      }
    }

    return best || this._straightLineNearest(fromLon, fromLat, schools);
  },

  // ── Straight-line fallback ────────────────────────────────────────────
  _straightLineNearest(lon, lat, schools) {
    let best = null, bestDist = Infinity;
    for (const s of schools) {
      if (!s.lon || !s.lat) continue;
      const d = this._haversine(lon, lat, s.lon, s.lat);
      if (d < bestDist) { bestDist = d; best = s; }
    }
    return best ? {
      school: best, totalDist: bestDist,
      networkDist: bestDist, onNetwork: false,
    } : null;
  },

  // ── Road connectivity score for an area ──────────────────────────────
  connectivityScore(centerLon, centerLat, radiusKm, roads) {
    const nearby = roads.filter(r => {
      if (!r.lon || !r.lat) return false;
      return this._haversine(centerLon, centerLat, r.lon, r.lat) <= radiusKm;
    });

    if (!nearby.length) return 0;

    // Count network nodes within radius
    let nodeCount = 0;
    for (const [, node] of this.nodes) {
      if (this._haversine(centerLon, centerLat, node.lon, node.lat) <= radiusKm)
        nodeCount++;
    }

    // Score = combination of road count, total length, and node density
    const totalLen   = nearby.reduce((s, r) => s + (r.length_m || 0), 0) / 1000;
    const lenScore   = Math.min(100, (totalLen / (radiusKm * 2)) * 100);
    const countScore = Math.min(100, (nearby.length / 10) * 100);
    const nodeScore  = Math.min(100, (nodeCount / 50) * 100);
    return +(lenScore * 0.5 + countScore * 0.3 + nodeScore * 0.2).toFixed(1);
  },

  // ── Generate proposed road between two points ─────────────────────────
  generateProposedRoad(fromLon, fromLat, toLon, toLat, priority, label) {
    const dist = this._haversine(fromLon, fromLat, toLon, toLat);
    return {
      priority,
      priority_label: label,
      estimated_length_km: +dist.toFixed(2),
      benefit_score: Math.max(0, 100 - dist * 20),
      intervention_type: dist > 5 ? 'New Road Construction' : 'Road Improvement',
      geojson: JSON.stringify({
        type: 'LineString',
        coordinates: [[fromLon, fromLat], [toLon, toLat]],
      }),
    };
  },

  // ── Detect isolated sectors (no road access within threshold) ─────────
  detectIsolatedSectors(sectors, roads, thresholdKm = 1.0) {
    return sectors.filter(sector => {
      if (!sector.lon || !sector.lat) return false;
      const nearby = roads.filter(r =>
        r.lon && r.lat &&
        this._haversine(sector.lon, sector.lat, r.lon, r.lat) <= thresholdKm
      );
      return nearby.length === 0;
    });
  },

  // ── Haversine distance in km ──────────────────────────────────────────
  _haversine(lon1, lat1, lon2, lat2) {
    const R  = 6371;
    const dL = (lat2 - lat1) * Math.PI / 180;
    const dl = (lon2 - lon1) * Math.PI / 180;
    const a  = Math.sin(dL/2)**2 +
               Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dl/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  },
};

module.exports = networkService;
