/**
 * Geocode addresses using Yandex Maps JS API (ymaps.geocode).
 * The ymaps script is loaded by YandexMapView component.
 * Falls back to Nominatim if Yandex fails.
 */

import { cleanAddressForGeocoding } from './parser';

// ─── Wait for ymaps to be ready ───────────────────────────

function waitForYmaps(timeout = 20000) {
  return new Promise((resolve, reject) => {
    if (window.ymaps && window.ymaps.geocode) {
      window.ymaps.ready(() => resolve(window.ymaps));
      return;
    }
    const start = Date.now();
    const interval = setInterval(() => {
      if (window.ymaps && window.ymaps.geocode) {
        clearInterval(interval);
        window.ymaps.ready(() => resolve(window.ymaps));
      } else if (Date.now() - start > timeout) {
        clearInterval(interval);
        reject(new Error('Яндекс Карты не загрузились'));
      }
    }, 300);
  });
}

// ─── Yandex Geocoder ───────────────────────────────────────

async function yandexGeocode(searchQuery) {
  const ymaps = await waitForYmaps();

  const result = await ymaps.geocode(searchQuery, {
    results: 1,
    boundedBy: [[53.75, 27.25], [54.15, 27.90]],
    strictBounds: false,
  });

  const geoObject = result.geoObjects.get(0);
  if (!geoObject) return null;

  const coords = geoObject.geometry.getCoordinates();
  const formattedAddress = geoObject.getAddressLine();

  // Check precision — skip if it only found a city/region, not a street
  const precision = geoObject.properties.get('metaDataProperty.GeocoderMetaData.precision');
  if (precision === 'other') return null;

  return {
    lat: coords[0],
    lng: coords[1],
    formattedAddress,
  };
}

// ─── Nominatim Fallback ────────────────────────────────────

async function nominatimGeocode(query) {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    limit: '1',
    countrycodes: 'by',
    'accept-language': 'ru',
    viewbox: '27.25,53.75,27.90,54.15',
    bounded: '0',
  });

  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { 'User-Agent': 'DriveControl/1.0' },
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (data.length === 0) return null;
    return {
      lat: parseFloat(data[0].lat),
      lng: parseFloat(data[0].lon),
      formattedAddress: data[0].display_name,
    };
  } catch {
    return null;
  }
}

// ─── Main geocode function ─────────────────────────────────

export async function geocodeAddress(rawAddress) {
  const cleanAddress = cleanAddressForGeocoding(rawAddress);

  // Determine context
  const isMinskRegion = /минск(ий|ого|ому)/i.test(cleanAddress) ||
    /прилуки|копище|богатырёво|богатырево|лесной|сеница|боровляны|колодищи|заславль|фаниполь/i.test(cleanAddress);
  const hasMinsk = /минск/i.test(cleanAddress);

  // Build queries to try (from most specific to least)
  const queries = [];

  if (isMinskRegion) {
    queries.push(`Беларусь, Минский район, ${cleanAddress}`);
    queries.push(cleanAddress);
  } else if (hasMinsk) {
    queries.push(`Беларусь, ${cleanAddress}`);
    queries.push(cleanAddress);
  } else {
    queries.push(`Минск, ${cleanAddress}`);
    queries.push(`Беларусь, Минск, ${cleanAddress}`);
  }

  // Also try simplified version
  const simplified = simplifyAddress(cleanAddress);
  if (simplified !== cleanAddress) {
    queries.push(`Минск, ${simplified}`);
  }

  // Try Yandex first with each query
  for (const q of queries) {
    try {
      const result = await yandexGeocode(q);
      if (result) return result;
    } catch {
      // Yandex failed, continue
    }
  }

  // Fallback to Nominatim
  for (const q of queries) {
    const result = await nominatimGeocode(q);
    if (result) return result;
  }

  // Last resort: street name only via Yandex
  const streetOnly = extractStreetName(cleanAddress);
  if (streetOnly) {
    try {
      const result = await yandexGeocode(`Минск, ${streetOnly}`);
      if (result) return result;
    } catch {
      // ignore
    }
  }

  throw new Error(`Адрес не найден: ${rawAddress}`);
}

// ─── Address helpers ───────────────────────────────────────

function simplifyAddress(address) {
  let s = address.replace(/^(минск|беларусь)[,\s]*/i, '').trim();
  const match = s.match(/((?:ул\.?|улица|пр-т|пр\.?|проспект|бульвар|б-р|пер\.?|переулок|тр-т|тракт)\s*[А-Яа-яёЁ\s\.\-]+?\s+\d+[а-яА-Я]?)\b/i);
  if (match) return match[1].trim();
  const match2 = s.match(/^([А-Яа-яёЁ][А-Яа-яёЁа-я\s\.\-]+?\s+\d+[а-яА-Я]?)\b/);
  if (match2) return match2[1].trim();
  return s;
}

function extractStreetName(address) {
  let s = address.replace(/^(минск|беларусь)[,\s]*/i, '').trim();
  s = s.replace(/\s+\d+[а-яА-Я]?.*$/, '').trim();
  s = s.replace(/,\s*$/, '').trim();
  return s.length > 2 ? s : null;
}

// ─── Batch geocoding ───────────────────────────────────────

export async function geocodeOrders(orders, onProgress) {
  const results = [];

  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
    try {
      const geo = await geocodeAddress(order.address);
      results.push({
        ...order,
        lat: geo.lat,
        lng: geo.lng,
        formattedAddress: geo.formattedAddress,
        geocoded: true,
        error: null,
      });
    } catch (err) {
      results.push({
        ...order,
        lat: null,
        lng: null,
        formattedAddress: null,
        geocoded: false,
        error: err.message,
      });
    }

    if (onProgress) {
      onProgress(i + 1, orders.length);
    }

    // Small delay between requests
    if (i < orders.length - 1) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  return results;
}
