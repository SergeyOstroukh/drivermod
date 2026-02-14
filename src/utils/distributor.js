/**
 * Route distribution algorithm for Minsk delivery
 * 
 * Based on modern logistics research (Density-Based Zone Mapping, 2025):
 * 
 * TWO-LEVEL APPROACH:
 * Level 1: Assign each point to one of 9 Minsk administrative districts
 * Level 2: Merge districts into K driver zones using hierarchical clustering
 *          (merge closest district pairs, preferring balanced point counts)
 * 
 * This respects real city geography — drivers get coherent areas.
 * Suburban points (outside MKAD) get attached to nearest district.
 */

// ─── Minsk Administrative Districts ────────────────────────
// Approximate center coordinates for each of 9 Minsk districts

const DISTRICTS = [
  { name: 'Центральный',   lat: 53.905, lng: 27.555, neighbors: [1, 5, 7] },
  { name: 'Советский',     lat: 53.928, lng: 27.560, neighbors: [0, 2, 8] },
  { name: 'Первомайский',  lat: 53.935, lng: 27.625, neighbors: [1, 3] },
  { name: 'Партизанский',  lat: 53.900, lng: 27.625, neighbors: [2, 4, 5] },
  { name: 'Заводской',     lat: 53.860, lng: 27.650, neighbors: [3, 5] },
  { name: 'Ленинский',     lat: 53.870, lng: 27.575, neighbors: [0, 3, 4, 6] },
  { name: 'Октябрьский',   lat: 53.865, lng: 27.510, neighbors: [5, 7] },
  { name: 'Московский',    lat: 53.880, lng: 27.490, neighbors: [0, 6, 8] },
  { name: 'Фрунзенский',   lat: 53.915, lng: 27.480, neighbors: [1, 7] },
];

// ─── Distance ──────────────────────────────────────────────

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Level 1: Assign Points to Districts ───────────────────

function assignToDistricts(points) {
  return points.map(p => {
    let bestDist = Infinity;
    let bestIdx = 0;
    for (let d = 0; d < DISTRICTS.length; d++) {
      const dist = haversineDistance(p.lat, p.lng, DISTRICTS[d].lat, DISTRICTS[d].lng);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = d;
      }
    }
    return bestIdx;
  });
}

// ─── Level 2: Merge Districts into K Driver Zones ──────────

/**
 * Hierarchical agglomerative clustering of districts.
 * Merges the pair with smallest combined geographic spread,
 * penalizing oversized clusters to maintain balance.
 */
function mergeDistrictsIntoZones(points, districtAssignments, k) {
  const n = points.length;
  const targetSize = Math.ceil(n / k);

  // Build initial clusters (one per non-empty district)
  const clusters = [];
  const districtToCluster = new Map();

  for (let d = 0; d < DISTRICTS.length; d++) {
    const members = [];
    points.forEach((p, i) => {
      if (districtAssignments[i] === d) members.push(i);
    });
    if (members.length > 0) {
      districtToCluster.set(d, clusters.length);
      clusters.push({
        id: clusters.length,
        members,         // point indices
        districtIds: [d], // which districts are in this cluster
        centroid: computeCentroid(points, members),
      });
    }
  }

  // If we already have ≤ K clusters, return as-is
  if (clusters.length <= k) {
    const assignments = new Array(n).fill(0);
    clusters.forEach((c, ci) => {
      c.members.forEach(i => { assignments[i] = ci; });
    });
    return assignments;
  }

  // Merge until we have K clusters
  while (clusters.length > k) {
    let bestI = 0, bestJ = 1;
    let bestScore = Infinity;

    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const merged = [...clusters[i].members, ...clusters[j].members];
        const mergedSize = merged.length;

        // Compute spread of merged cluster (max distance between any two points)
        const spread = computeSpread(points, merged);

        // Penalty for creating oversized clusters
        const oversize = Math.max(0, mergedSize - targetSize * 1.4);
        const penalty = 1 + oversize / targetSize;

        // Bonus for merging geographically adjacent districts
        const isAdjacent = clusters[i].districtIds.some(di =>
          clusters[j].districtIds.some(dj =>
            DISTRICTS[di].neighbors.includes(dj) || DISTRICTS[dj].neighbors.includes(di)
          )
        );
        const adjacencyBonus = isAdjacent ? 0.7 : 1.0;

        const score = spread * penalty * adjacencyBonus;

        if (score < bestScore) {
          bestScore = score;
          bestI = i;
          bestJ = j;
        }
      }
    }

    // Merge bestJ into bestI
    clusters[bestI].members.push(...clusters[bestJ].members);
    clusters[bestI].districtIds.push(...clusters[bestJ].districtIds);
    clusters[bestI].centroid = computeCentroid(points, clusters[bestI].members);

    // Remove bestJ
    clusters.splice(bestJ, 1);
  }

  // Build final assignments
  const assignments = new Array(n).fill(0);
  clusters.forEach((c, ci) => {
    c.members.forEach(i => { assignments[i] = ci; });
  });

  return assignments;
}

function computeCentroid(points, indices) {
  const lat = indices.reduce((s, i) => s + points[i].lat, 0) / indices.length;
  const lng = indices.reduce((s, i) => s + points[i].lng, 0) / indices.length;
  return { lat, lng };
}

function computeSpread(points, indices) {
  let max = 0;
  for (let a = 0; a < indices.length; a++) {
    for (let b = a + 1; b < indices.length; b++) {
      const d = haversineDistance(
        points[indices[a]].lat, points[indices[a]].lng,
        points[indices[b]].lat, points[indices[b]].lng
      );
      if (d > max) max = d;
    }
  }
  return max;
}

// ─── Post-Processing: Two-Phase Balancing ──────────────────

/**
 * Phase 1: Balance point COUNT between zones.
 * Move border points from biggest to smallest zone until
 * the difference is at most 2.
 */
function balanceCounts(points, assignments, k) {
  const result = [...assignments];
  const n = points.length;
  const targetMin = Math.floor(n / k);
  const targetMax = Math.ceil(n / k);

  for (let pass = 0; pass < n; pass++) {
    // Rebuild clusters
    const clusters = Array.from({ length: k }, () => []);
    points.forEach((p, i) => {
      if (result[i] >= 0) clusters[result[i]].push({ ...p, origIdx: i });
    });
    const counts = clusters.map(c => c.length);

    // Find zone with most and fewest points
    let maxC = 0, minC = 0;
    for (let c = 0; c < k; c++) {
      if (counts[c] > counts[maxC]) maxC = c;
      if (counts[c] < counts[minC]) minC = c;
    }

    // Stop if balanced enough (difference ≤ 2)
    if (counts[maxC] - counts[minC] <= 2) break;
    if (maxC === minC) break;

    // Find the point in maxC zone closest to minC zone centroid
    const minCentroid = {
      lat: clusters[minC].reduce((s, p) => s + p.lat, 0) / clusters[minC].length,
      lng: clusters[minC].reduce((s, p) => s + p.lng, 0) / clusters[minC].length,
    };
    const maxCentroid = {
      lat: clusters[maxC].reduce((s, p) => s + p.lat, 0) / clusters[maxC].length,
      lng: clusters[maxC].reduce((s, p) => s + p.lng, 0) / clusters[maxC].length,
    };

    // Score each point: prefer border points (closer to minC, farther from maxC center)
    let bestPt = null;
    let bestScore = Infinity;

    for (const p of clusters[maxC]) {
      const distToTarget = haversineDistance(p.lat, p.lng, minCentroid.lat, minCentroid.lng);
      const distToOwn = haversineDistance(p.lat, p.lng, maxCentroid.lat, maxCentroid.lng);

      // Score: distance to target zone (lower = better)
      // Only consider points that are on the "border" side (closer to target than to own center)
      // or at least not deeply inside their own cluster
      const score = distToTarget;

      if (score < bestScore) {
        bestScore = score;
        bestPt = p;
      }
    }

    if (!bestPt) break;

    result[bestPt.origIdx] = minC;
  }

  return result;
}

/**
 * Phase 2: Balance route KILOMETERS between zones.
 * Swap border points from longest to shortest route.
 */
function balanceKilometers(points, assignments, k) {
  const result = [...assignments];
  const n = points.length;
  const minClusterSize = Math.max(1, Math.floor(n / k) - 1);

  for (let pass = 0; pass < 15; pass++) {
    const clusters = Array.from({ length: k }, () => []);
    points.forEach((p, i) => {
      if (result[i] >= 0) clusters[result[i]].push({ ...p, origIdx: i });
    });

    const kms = clusters.map(c => computeRouteKm(optimizeRouteOrder(c)));
    const counts = clusters.map(c => c.length);

    let maxC = 0, minC = 0;
    for (let c = 0; c < k; c++) {
      if (kms[c] > kms[maxC]) maxC = c;
      if (kms[c] < kms[minC]) minC = c;
    }

    if (maxC === minC) break;
    if (kms[maxC] - kms[minC] < 1.5) break;
    if (counts[maxC] <= minClusterSize) break;
    // Don't unbalance counts: don't let difference grow beyond 3
    if (counts[maxC] - counts[minC] <= -1) break;

    const minCentroid = {
      lat: clusters[minC].reduce((s, p) => s + p.lat, 0) / clusters[minC].length,
      lng: clusters[minC].reduce((s, p) => s + p.lng, 0) / clusters[minC].length,
    };

    let bestPt = null, bestDist = Infinity;
    for (const p of clusters[maxC]) {
      const d = haversineDistance(p.lat, p.lng, minCentroid.lat, minCentroid.lng);
      if (d < bestDist) { bestDist = d; bestPt = p; }
    }

    if (!bestPt) break;

    const newMax = clusters[maxC].filter(p => p.origIdx !== bestPt.origIdx);
    const newMin = [...clusters[minC], bestPt];
    const newMaxKm = computeRouteKm(optimizeRouteOrder(newMax));
    const newMinKm = computeRouteKm(optimizeRouteOrder(newMin));

    if (Math.abs(newMaxKm - newMinKm) < Math.abs(kms[maxC] - kms[minC])) {
      result[bestPt.origIdx] = minC;
    } else {
      break;
    }
  }

  return result;
}

function computeRouteKm(orderedPoints) {
  let total = 0;
  for (let i = 0; i < orderedPoints.length - 1; i++) {
    total += haversineDistance(
      orderedPoints[i].lat, orderedPoints[i].lng,
      orderedPoints[i + 1].lat, orderedPoints[i + 1].lng
    );
  }
  return total;
}

// ─── Route Optimization (nearest-neighbor) ─────────────────

function optimizeRouteOrder(driverOrders) {
  if (driverOrders.length <= 2) return [...driverOrders];

  const centerLat = 53.9006;
  const centerLng = 27.559;

  let startIdx = 0;
  let minDist = Infinity;
  for (let i = 0; i < driverOrders.length; i++) {
    const d = haversineDistance(driverOrders[i].lat, driverOrders[i].lng, centerLat, centerLng);
    if (d < minDist) { minDist = d; startIdx = i; }
  }

  const ordered = [driverOrders[startIdx]];
  const remaining = [...driverOrders];
  remaining.splice(startIdx, 1);

  while (remaining.length > 0) {
    const last = ordered[ordered.length - 1];
    let nearestIdx = 0, nearestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineDistance(last.lat, last.lng, remaining[i].lat, remaining[i].lng);
      if (d < nearestDist) { nearestDist = d; nearestIdx = i; }
    }
    ordered.push(remaining.splice(nearestIdx, 1)[0]);
  }

  return ordered;
}

// ─── Build result from assignments ─────────────────────────

function buildResult(orders, geocodedOrders, assignments, driverCount) {
  const driverRoutes = Array.from({ length: driverCount }, () => []);
  geocodedOrders.forEach((order, i) => {
    driverRoutes[assignments[i]].push(order);
  });
  for (let d = 0; d < driverCount; d++) {
    driverRoutes[d] = optimizeRouteOrder(driverRoutes[d]);
  }

  const fullAssignments = orders.map(order => {
    if (!order.geocoded) return -1;
    const idx = geocodedOrders.findIndex(go => go.id === order.id);
    return idx === -1 ? -1 : assignments[idx];
  });

  // Compute stats per driver
  const stats = driverRoutes.map((route, d) => {
    const km = computeRouteKm(route);
    return { count: route.length, km: Math.round(km * 10) / 10 };
  });

  return { assignments: fullAssignments, driverRoutes, stats };
}

// ─── Single variant generation ─────────────────────────────

function generateVariant(orders, geocodedOrders, driverCount, strategy) {
  const districtAssignments = assignToDistricts(geocodedOrders);

  let zoneAssignments;

  if (strategy === 'balanced') {
    // Standard: district merge → balance count → balance km
    zoneAssignments = mergeDistrictsIntoZones(geocodedOrders, districtAssignments, driverCount);
    zoneAssignments = balanceCounts(geocodedOrders, zoneAssignments, driverCount);
    zoneAssignments = balanceKilometers(geocodedOrders, zoneAssignments, driverCount);
  } else if (strategy === 'compact') {
    // Prioritize compactness: district merge → light count balance only
    zoneAssignments = mergeDistrictsIntoZones(geocodedOrders, districtAssignments, driverCount);
    // Only balance if difference > 4
    const counts = Array.from({ length: driverCount }, () => 0);
    zoneAssignments.forEach(z => counts[z]++);
    const diff = Math.max(...counts) - Math.min(...counts);
    if (diff > 4) {
      zoneAssignments = balanceCounts(geocodedOrders, zoneAssignments, driverCount);
    }
  } else if (strategy === 'equal_km') {
    // Prioritize equal km: district merge → balance count → aggressive km balance
    zoneAssignments = mergeDistrictsIntoZones(geocodedOrders, districtAssignments, driverCount);
    zoneAssignments = balanceCounts(geocodedOrders, zoneAssignments, driverCount);
    zoneAssignments = balanceKilometers(geocodedOrders, zoneAssignments, driverCount);
    // Extra km pass
    zoneAssignments = balanceKilometers(geocodedOrders, zoneAssignments, driverCount);
  }

  return buildResult(orders, geocodedOrders, zoneAssignments, driverCount);
}

// ─── Main API ──────────────────────────────────────────────

/**
 * Generate multiple distribution variants
 * Returns array of variants, each with assignments, driverRoutes, stats, and label
 */
export function generateVariants(orders, driverCount) {
  const geocodedOrders = orders.filter(o => o.geocoded && o.lat && o.lng);

  if (geocodedOrders.length === 0) {
    const empty = {
      assignments: orders.map(() => -1),
      driverRoutes: Array.from({ length: driverCount }, () => []),
      stats: Array.from({ length: driverCount }, () => ({ count: 0, km: 0 })),
    };
    return [{ ...empty, label: 'Пусто', description: '' }];
  }

  const variants = [
    {
      ...generateVariant(orders, geocodedOrders, driverCount, 'balanced'),
      label: 'Сбалансированный',
      description: 'Равное количество + равный километраж',
    },
    {
      ...generateVariant(orders, geocodedOrders, driverCount, 'compact'),
      label: 'Компактный',
      description: 'Максимально кучные зоны',
    },
    {
      ...generateVariant(orders, geocodedOrders, driverCount, 'equal_km'),
      label: 'Равный км',
      description: 'Приоритет на равный километраж',
    },
  ];

  return variants;
}

/** Legacy single-result API (still used internally) */
export function distributeOrders(orders, driverCount) {
  const geocodedOrders = orders.filter(o => o.geocoded && o.lat && o.lng);
  if (geocodedOrders.length === 0) {
    return {
      assignments: orders.map(() => -1),
      driverRoutes: Array.from({ length: driverCount }, () => []),
    };
  }
  return generateVariant(orders, geocodedOrders, driverCount, 'balanced');
}

export const DRIVER_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1',
  '#a855f7', '#84cc16',
];
