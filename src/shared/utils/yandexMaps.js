/**
 * Построение URL для Яндекс.Карт и Яндекс.Навигатора
 */

export function buildYandexPlaceUrl(lat, lon) {
  return `https://yandex.ru/maps/?pt=${lon},${lat}&z=16&l=map`;
}

export function buildYandexRouteUrl(fromLat, fromLon, toLat, toLon) {
  const rtext = `${fromLat},${fromLon}~${toLat},${toLon}`;
  return `https://yandex.ru/maps/?rtext=${encodeURIComponent(rtext)}&rtt=auto`;
}

export function buildYandexMultiRouteUrl(points) {
  const rtext = points.map((p) => `${p.lat},${p.lon}`).join('~');
  return `https://yandex.ru/maps/?rtext=${encodeURIComponent(rtext)}&rtt=auto`;
}

export function buildYandexNavigatorPlaceUrl(lat, lon, name = '') {
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon), desc: name });
  return `yandexnavi://show_point_on_map?${params.toString()}`;
}

export function buildYandexNavigatorRouteUrl(fromLat, fromLon, toLat, toLon) {
  const params = new URLSearchParams({
    lat_to: String(toLat),
    lon_to: String(toLon),
    lat_from: String(fromLat),
    lon_from: String(fromLon),
  });
  return `yandexnavi://build_route_on_map?${params.toString()}`;
}

export function openWithFallback(primaryUrl, fallbackUrl) {
  const timeout = setTimeout(() => {
    window.location.href = fallbackUrl;
  }, 800);
  window.location.href = primaryUrl;
  setTimeout(() => clearTimeout(timeout), 1500);
}

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Алгоритм ближайшего соседа для оптимизации маршрута */
export function optimizeRoute(startPoint, points) {
  if (points.length === 0) return [];
  if (points.length === 1) return points;
  const route = [];
  const remaining = points.map((p) => ({ lat: p.lat, lon: p.lon }));
  let current = { ...startPoint };
  while (remaining.length > 0) {
    let nearestIdx = 0;
    let nearestDist = haversineDistance(
      current.lat,
      current.lon,
      remaining[0].lat,
      remaining[0].lon
    );
    for (let i = 1; i < remaining.length; i++) {
      const d = haversineDistance(
        current.lat,
        current.lon,
        remaining[i].lat,
        remaining[i].lon
      );
      if (d < nearestDist) {
        nearestDist = d;
        nearestIdx = i;
      }
    }
    const next = remaining.splice(nearestIdx, 1)[0];
    route.push(next);
    current = next;
  }
  return route;
}
