/**
 * DriveControl — Route distribution algorithm
 * Zone-based: assign → merge districts → balance count → balance km
 */
(() => {
  "use strict";

  var DISTRICTS = [
    { name: 'Центральный',  lat: 53.905, lng: 27.555, neighbors: [1, 5, 7] },
    { name: 'Советский',    lat: 53.928, lng: 27.560, neighbors: [0, 2, 8] },
    { name: 'Первомайский', lat: 53.935, lng: 27.625, neighbors: [1, 3] },
    { name: 'Партизанский', lat: 53.900, lng: 27.625, neighbors: [2, 4, 5] },
    { name: 'Заводской',    lat: 53.860, lng: 27.650, neighbors: [3, 5] },
    { name: 'Ленинский',    lat: 53.870, lng: 27.575, neighbors: [0, 3, 4, 6] },
    { name: 'Октябрьский',  lat: 53.865, lng: 27.510, neighbors: [5, 7] },
    { name: 'Московский',   lat: 53.880, lng: 27.490, neighbors: [0, 6, 8] },
    { name: 'Фрунзенский',  lat: 53.915, lng: 27.480, neighbors: [1, 7] },
  ];

  var DRIVER_COLORS = [
    '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
    '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1',
    '#a855f7', '#84cc16',
  ];

  function haversineDistance(lat1, lng1, lat2, lng2) {
    var R = 6371;
    var dLat = ((lat2 - lat1) * Math.PI) / 180;
    var dLng = ((lng2 - lng1) * Math.PI) / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function assignToDistricts(points) {
    return points.map(function (p) {
      var best = Infinity, idx = 0;
      for (var d = 0; d < DISTRICTS.length; d++) {
        var dist = haversineDistance(p.lat, p.lng, DISTRICTS[d].lat, DISTRICTS[d].lng);
        if (dist < best) { best = dist; idx = d; }
      }
      return idx;
    });
  }

  function computeCentroid(points, indices) {
    var lat = 0, lng = 0;
    for (var i = 0; i < indices.length; i++) { lat += points[indices[i]].lat; lng += points[indices[i]].lng; }
    return { lat: lat / indices.length, lng: lng / indices.length };
  }

  function computeSpread(points, indices) {
    var max = 0;
    for (var a = 0; a < indices.length; a++) {
      for (var b = a + 1; b < indices.length; b++) {
        var d = haversineDistance(points[indices[a]].lat, points[indices[a]].lng, points[indices[b]].lat, points[indices[b]].lng);
        if (d > max) max = d;
      }
    }
    return max;
  }

  function mergeDistrictsIntoZones(points, districtAssignments, k) {
    var n = points.length;
    var targetSize = Math.ceil(n / k);
    var clusters = [];
    for (var d = 0; d < DISTRICTS.length; d++) {
      var members = [];
      for (var i = 0; i < n; i++) { if (districtAssignments[i] === d) members.push(i); }
      if (members.length > 0) {
        clusters.push({ members: members, districtIds: [d], centroid: computeCentroid(points, members) });
      }
    }
    if (clusters.length <= k) {
      var assignments = new Array(n).fill(0);
      clusters.forEach(function (c, ci) { c.members.forEach(function (i) { assignments[i] = ci; }); });
      return assignments;
    }
    while (clusters.length > k) {
      var bestI = 0, bestJ = 1, bestScore = Infinity;
      for (var i = 0; i < clusters.length; i++) {
        for (var j = i + 1; j < clusters.length; j++) {
          var merged = clusters[i].members.concat(clusters[j].members);
          var spread = computeSpread(points, merged);
          var oversize = Math.max(0, merged.length - targetSize * 1.4);
          var penalty = 1 + oversize / targetSize;
          var isAdj = clusters[i].districtIds.some(function (di) {
            return clusters[j].districtIds.some(function (dj) {
              return DISTRICTS[di].neighbors.indexOf(dj) >= 0 || DISTRICTS[dj].neighbors.indexOf(di) >= 0;
            });
          });
          var score = spread * penalty * (isAdj ? 0.7 : 1.0);
          if (score < bestScore) { bestScore = score; bestI = i; bestJ = j; }
        }
      }
      clusters[bestI].members = clusters[bestI].members.concat(clusters[bestJ].members);
      clusters[bestI].districtIds = clusters[bestI].districtIds.concat(clusters[bestJ].districtIds);
      clusters[bestI].centroid = computeCentroid(points, clusters[bestI].members);
      clusters.splice(bestJ, 1);
    }
    var assignments = new Array(n).fill(0);
    clusters.forEach(function (c, ci) { c.members.forEach(function (i) { assignments[i] = ci; }); });
    return assignments;
  }

  function balanceCounts(points, assignments, k) {
    var result = assignments.slice();
    var n = points.length;
    for (var pass = 0; pass < n; pass++) {
      var clusters = [];
      for (var c = 0; c < k; c++) clusters.push([]);
      for (var i = 0; i < n; i++) { if (result[i] >= 0) clusters[result[i]].push({ lat: points[i].lat, lng: points[i].lng, origIdx: i }); }
      var counts = clusters.map(function (c) { return c.length; });
      var maxC = 0, minC = 0;
      for (var c = 0; c < k; c++) { if (counts[c] > counts[maxC]) maxC = c; if (counts[c] < counts[minC]) minC = c; }
      if (counts[maxC] - counts[minC] <= 1 || maxC === minC) break;
      var minCentroid = { lat: clusters[minC].reduce(function (s, p) { return s + p.lat; }, 0) / clusters[minC].length, lng: clusters[minC].reduce(function (s, p) { return s + p.lng; }, 0) / clusters[minC].length };
      var bestPt = null, bestScore = Infinity;
      for (var j = 0; j < clusters[maxC].length; j++) {
        var p = clusters[maxC][j];
        var score = haversineDistance(p.lat, p.lng, minCentroid.lat, minCentroid.lng);
        if (score < bestScore) { bestScore = score; bestPt = p; }
      }
      if (!bestPt) break;
      result[bestPt.origIdx] = minC;
    }
    return result;
  }

  function computeRouteKm(orderedPoints) {
    var total = 0;
    for (var i = 0; i < orderedPoints.length - 1; i++) {
      total += haversineDistance(orderedPoints[i].lat, orderedPoints[i].lng, orderedPoints[i + 1].lat, orderedPoints[i + 1].lng);
    }
    return total;
  }

  function optimizeRouteOrder(driverOrders) {
    if (driverOrders.length <= 2) return driverOrders.slice();
    var startIdx = 0, minDist = Infinity;
    for (var i = 0; i < driverOrders.length; i++) {
      var d = haversineDistance(driverOrders[i].lat, driverOrders[i].lng, 53.9006, 27.559);
      if (d < minDist) { minDist = d; startIdx = i; }
    }
    var ordered = [driverOrders[startIdx]];
    var remaining = driverOrders.slice();
    remaining.splice(startIdx, 1);
    while (remaining.length > 0) {
      var last = ordered[ordered.length - 1];
      var nearIdx = 0, nearDist = Infinity;
      for (var i = 0; i < remaining.length; i++) {
        var d = haversineDistance(last.lat, last.lng, remaining[i].lat, remaining[i].lng);
        if (d < nearDist) { nearDist = d; nearIdx = i; }
      }
      ordered.push(remaining.splice(nearIdx, 1)[0]);
    }
    return ordered;
  }

  function balanceKilometers(points, assignments, k) {
    var result = assignments.slice();
    var n = points.length;
    var minCluster = Math.max(1, Math.floor(n / k) - 1);
    for (var pass = 0; pass < 15; pass++) {
      var clusters = [];
      for (var c = 0; c < k; c++) clusters.push([]);
      for (var i = 0; i < n; i++) { if (result[i] >= 0) clusters[result[i]].push({ lat: points[i].lat, lng: points[i].lng, origIdx: i }); }
      var kms = clusters.map(function (c) { return computeRouteKm(optimizeRouteOrder(c)); });
      var counts = clusters.map(function (c) { return c.length; });
      var maxC = 0, minC = 0;
      for (var c = 0; c < k; c++) { if (kms[c] > kms[maxC]) maxC = c; if (kms[c] < kms[minC]) minC = c; }
      if (maxC === minC || kms[maxC] - kms[minC] < 1.5 || counts[maxC] <= minCluster || counts[maxC] - counts[minC] <= -1) break;
      var minCentroid = { lat: clusters[minC].reduce(function (s, p) { return s + p.lat; }, 0) / clusters[minC].length, lng: clusters[minC].reduce(function (s, p) { return s + p.lng; }, 0) / clusters[minC].length };
      var bestPt = null, bestDist = Infinity;
      for (var j = 0; j < clusters[maxC].length; j++) {
        var p = clusters[maxC][j];
        var d = haversineDistance(p.lat, p.lng, minCentroid.lat, minCentroid.lng);
        if (d < bestDist) { bestDist = d; bestPt = p; }
      }
      if (!bestPt) break;
      var newMax = clusters[maxC].filter(function (p) { return p.origIdx !== bestPt.origIdx; });
      var newMin = clusters[minC].concat([bestPt]);
      if (Math.abs(computeRouteKm(optimizeRouteOrder(newMax)) - computeRouteKm(optimizeRouteOrder(newMin))) < Math.abs(kms[maxC] - kms[minC])) {
        result[bestPt.origIdx] = minC;
      } else break;
    }
    return result;
  }

  function buildResult(orders, geocodedOrders, assignments, driverCount) {
    var driverRoutes = [];
    for (var d = 0; d < driverCount; d++) driverRoutes.push([]);
    geocodedOrders.forEach(function (order, i) { driverRoutes[assignments[i]].push(order); });
    for (var d = 0; d < driverCount; d++) driverRoutes[d] = optimizeRouteOrder(driverRoutes[d]);

    var fullAssignments = orders.map(function (order) {
      if (!order.geocoded) return -1;
      var idx = -1;
      for (var j = 0; j < geocodedOrders.length; j++) { if (geocodedOrders[j].id === order.id) { idx = j; break; } }
      return idx === -1 ? -1 : assignments[idx];
    });

    var stats = driverRoutes.map(function (route) {
      return { count: route.length, km: Math.round(computeRouteKm(route) * 10) / 10 };
    });
    return { assignments: fullAssignments, driverRoutes: driverRoutes, stats: stats };
  }

  function generateVariant(orders, geocodedOrders, driverCount, strategy) {
    var districtAssignments = assignToDistricts(geocodedOrders);
    var zoneAssignments;
    if (strategy === 'balanced') {
      zoneAssignments = mergeDistrictsIntoZones(geocodedOrders, districtAssignments, driverCount);
      zoneAssignments = balanceCounts(geocodedOrders, zoneAssignments, driverCount);
      zoneAssignments = balanceKilometers(geocodedOrders, zoneAssignments, driverCount);
    } else if (strategy === 'compact') {
      zoneAssignments = mergeDistrictsIntoZones(geocodedOrders, districtAssignments, driverCount);
      var counts = new Array(driverCount).fill(0);
      zoneAssignments.forEach(function (z) { counts[z]++; });
      if (Math.max.apply(null, counts) - Math.min.apply(null, counts) > 4)
        zoneAssignments = balanceCounts(geocodedOrders, zoneAssignments, driverCount);
    } else if (strategy === 'equal_km') {
      zoneAssignments = mergeDistrictsIntoZones(geocodedOrders, districtAssignments, driverCount);
      zoneAssignments = balanceCounts(geocodedOrders, zoneAssignments, driverCount);
      zoneAssignments = balanceKilometers(geocodedOrders, zoneAssignments, driverCount);
      zoneAssignments = balanceKilometers(geocodedOrders, zoneAssignments, driverCount);
    }
    return buildResult(orders, geocodedOrders, zoneAssignments, driverCount);
  }

  function generateVariants(orders, driverCount) {
    // Only distribute address orders — suppliers keep their manual assignment
    var geocodedOrders = orders.filter(function (o) { return o.geocoded && o.lat && o.lng && !o.isSupplier; });
    if (geocodedOrders.length === 0) {
      var empty = { assignments: orders.map(function () { return -1; }), driverRoutes: [], stats: [] };
      for (var d = 0; d < driverCount; d++) { empty.driverRoutes.push([]); empty.stats.push({ count: 0, km: 0 }); }
      return [Object.assign({}, empty, { label: 'Пусто', description: '' })];
    }
    return [
      Object.assign({}, generateVariant(orders, geocodedOrders, driverCount, 'balanced'), { label: 'Сбалансированный', description: 'Равное количество + равный километраж' }),
      Object.assign({}, generateVariant(orders, geocodedOrders, driverCount, 'compact'), { label: 'Компактный', description: 'Максимально кучные зоны' }),
      Object.assign({}, generateVariant(orders, geocodedOrders, driverCount, 'equal_km'), { label: 'Равный км', description: 'Приоритет на равный километраж' }),
    ];
  }

  window.DistributionAlgo = {
    generateVariants: generateVariants,
    DRIVER_COLORS: DRIVER_COLORS,
  };
})();
