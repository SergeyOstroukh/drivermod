/**
 * DriveControl — Geocoder module
 * Yandex Maps JS API (ymaps.geocode) primary, Nominatim fallback.
 * Two-step geocoding for regional addresses: settlement first, then street.
 */
(() => {
  "use strict";

  const YMAPS_SRC = 'https://api-maps.yandex.ru/2.1/?lang=ru_RU';
  const MINSK_BOUNDS = [[53.75, 27.25], [54.15, 27.90]];

  function loadYmaps() {
    return new Promise((resolve, reject) => {
      if (window.ymaps && window.ymaps.geocode) {
        window.ymaps.ready(() => resolve(window.ymaps));
        return;
      }
      if (!document.querySelector('script[src*="api-maps.yandex.ru"]')) {
        const s = document.createElement('script');
        s.src = YMAPS_SRC;
        s.async = true;
        document.head.appendChild(s);
      }
      const start = Date.now();
      const interval = setInterval(() => {
        if (window.ymaps && window.ymaps.geocode) {
          clearInterval(interval);
          window.ymaps.ready(() => resolve(window.ymaps));
        } else if (Date.now() - start > 20000) {
          clearInterval(interval);
          reject(new Error('Яндекс Карты не загрузились'));
        }
      }, 300);
    });
  }

  // ─── Yandex geocode with optional bounds ────────────────────
  async function yandexGeocode(searchQuery, bounds, strict) {
    const ymaps = await loadYmaps();
    const result = await ymaps.geocode(searchQuery, {
      results: 1,
      boundedBy: bounds || MINSK_BOUNDS,
      strictBounds: !!strict,
    });
    const geoObject = result.geoObjects.get(0);
    if (!geoObject) return null;
    const coords = geoObject.geometry.getCoordinates();
    const formattedAddress = geoObject.getAddressLine();
    const precision = geoObject.properties.get('metaDataProperty.GeocoderMetaData.precision');
    if (precision === 'other') return null;
    return { lat: coords[0], lng: coords[1], formattedAddress: formattedAddress, precision: precision };
  }

  // ─── Nominatim fallback ─────────────────────────────────────
  async function nominatimGeocode(query) {
    const params = new URLSearchParams({
      q: query, format: 'json', limit: '1',
      countrycodes: 'by', 'accept-language': 'ru',
      viewbox: '27.25,53.75,27.90,54.15', bounded: '0',
    });
    try {
      const response = await fetch('https://nominatim.openstreetmap.org/search?' + params, {
        headers: { 'User-Agent': 'DriveControl/1.0' },
      });
      if (!response.ok) return null;
      const data = await response.json();
      if (data.length === 0) return null;
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), formattedAddress: data[0].display_name };
    } catch (e) { return null; }
  }

  // ─── Settlement extraction ──────────────────────────────────
  // Extracts settlement name from address like "Прилуки, ул. Центральная 5"
  function extractSettlement(address) {
    let s = address;
    // Remove country/region prefixes
    s = s.replace(/^(беларусь|республика\s*беларусь)[,\s]*/gi, '');
    s = s.replace(/^(минск(ий|ого|ому)\s*(район|р-н|обл\.?|область)?)[,\s]*/gi, '');
    s = s.replace(/^(минская\s*(обл\.?|область))[,\s]*/gi, '');
    s = s.trim();

    // Remove settlement type prefix (д., п., г., аг., дер., пос.)
    s = s.replace(/^(?:д\.?\s+|дер\.?\s+|п\.?\s+|пос\.?\s+|г\.?\s+|гор\.?\s+|аг\.?\s+|с\.?\s+)/i, '').trim();

    // Find where street part begins
    const streetRegex = /(?:,\s*)?(?:ул\.?\s|улица\s|пр[\.\-]т?\s|проспект\s|бульвар\s|б[\.\-]р\.?\s|пер\.?\s|переулок\s|тр[\.\-]т\s|тракт\s|шоссе\s|\d+[\-\s]?(?:й|я|е|ой|ая|ое)\s)/i;
    const streetMatch = s.match(streetRegex);

    if (streetMatch && streetMatch.index > 0) {
      const settlement = s.substring(0, streetMatch.index).replace(/[,\s]+$/, '').trim();
      if (settlement.length > 1 && /^[А-ЯЁа-яё]/.test(settlement)) {
        return settlement;
      }
    }

    // Try comma separator
    const commaIdx = s.indexOf(',');
    if (commaIdx > 1) {
      const before = s.substring(0, commaIdx).trim();
      if (/^[А-ЯЁ][а-яёА-ЯЁ\s\-]+$/.test(before) && before.length > 1) {
        return before;
      }
    }

    return null;
  }

  // Get the street/house part of the address (everything after settlement name)
  function getStreetPart(address, settlement) {
    if (!settlement) return address;
    const escaped = settlement.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Remove everything up to and including the settlement name
    let street = address.replace(new RegExp('.*?' + escaped + '[,\\s]*', 'i'), '').trim();
    if (!street || street === address) {
      street = address.replace(new RegExp(escaped + '[,\\s]*', 'i'), '').trim();
    }
    return street || address;
  }

  function normalizeForCompare(s) {
    return s.toLowerCase().replace(/ё/g, 'е').replace(/[^а-яa-z0-9]/g, '');
  }

  function resultMatchesSettlement(formattedAddress, settlement) {
    if (!formattedAddress || !settlement) return false;
    return normalizeForCompare(formattedAddress).includes(normalizeForCompare(settlement));
  }

  // ─── Two-step regional geocoding ────────────────────────────
  async function geocodeRegional(cleanAddress) {
    const settlement = extractSettlement(cleanAddress);
    if (!settlement) return null;

    // Step 1: Find the settlement center and verify it exists
    let settlementResult = null;
    const settlementQueries = [
      'Беларусь, Минский район, ' + settlement,
      'Беларусь, Минская область, ' + settlement,
      'Минский район, ' + settlement,
    ];

    for (const q of settlementQueries) {
      try {
        const r = await yandexGeocode(q);
        if (r && resultMatchesSettlement(r.formattedAddress, settlement)) {
          settlementResult = r;
          break;
        }
      } catch (e) { /* continue */ }
    }

    if (!settlementResult) return null;

    // Step 2: Geocode full address with tight bounds around the settlement
    const delta = 0.03; // ~3km radius
    const tightBounds = [
      [settlementResult.lat - delta, settlementResult.lng - delta],
      [settlementResult.lat + delta, settlementResult.lng + delta],
    ];

    const streetPart = getStreetPart(cleanAddress, settlement);
    const fullQueries = [];

    if (streetPart && streetPart !== cleanAddress && streetPart.length > 2) {
      fullQueries.push(settlement + ', ' + streetPart);
      fullQueries.push('Беларусь, Минский район, ' + settlement + ', ' + streetPart);
    }
    fullQueries.push('Беларусь, Минский район, ' + cleanAddress);

    // Try with strict bounds first (only results within settlement area)
    for (const q of fullQueries) {
      try {
        const r = await yandexGeocode(q, tightBounds, true);
        if (r && resultMatchesSettlement(r.formattedAddress, settlement)) {
          return r;
        }
      } catch (e) { /* continue */ }
    }

    // Try without strict bounds but verify result is in the right settlement
    for (const q of fullQueries) {
      try {
        const r = await yandexGeocode(q, tightBounds, false);
        if (r && resultMatchesSettlement(r.formattedAddress, settlement)) {
          return r;
        }
      } catch (e) { /* continue */ }
    }

    // Exact address not found — return settlement center with settlementOnly flag
    return {
      lat: settlementResult.lat,
      lng: settlementResult.lng,
      formattedAddress: settlementResult.formattedAddress,
      settlementOnly: true,
    };
  }

  // ─── Address helpers ────────────────────────────────────────
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

  // ─── Main geocoding entry point ─────────────────────────────
  async function geocodeAddress(rawAddress) {
    const cleanAddress = window.DistributionParser.cleanAddressForGeocoding(rawAddress);

    const isMinskRegion = /минск(ий|ого|ому)/i.test(cleanAddress) ||
      /прилуки|копище|богатырёво|богатырево|лесной|сеница|боровляны|колодищи|заславль|фаниполь|ратомка|тарасово|озерцо|щомыслица|новый\s*двор|атолино|хатежино|дзержинск|столбцы|смолевичи|жодино|логойск|руденск|михановичи|привольный|сосны|зелёный\s*бор|зеленый\s*бор|луговая\s*слобода|лесковка|большевик|мачулищи|гатово|чуриловичи|колядичи|паперня|самохваловичи|fanipol|borovlyany/i.test(cleanAddress);
    const hasMinsk = /минск/i.test(cleanAddress);

    // For regional addresses: two-step geocoding (settlement first, then street)
    if (isMinskRegion) {
      try {
        const regional = await geocodeRegional(cleanAddress);
        if (regional) return regional;
      } catch (e) { /* fall through to standard geocoding */ }
    }

    // Standard geocoding
    const queries = [];
    if (isMinskRegion) {
      queries.push('Беларусь, Минский район, ' + cleanAddress);
      queries.push(cleanAddress);
    } else if (hasMinsk) {
      queries.push('Беларусь, ' + cleanAddress);
      queries.push(cleanAddress);
    } else {
      queries.push('Минск, ' + cleanAddress);
      queries.push('Беларусь, Минск, ' + cleanAddress);
    }
    const simplified = simplifyAddress(cleanAddress);
    if (simplified !== cleanAddress) queries.push('Минск, ' + simplified);

    for (const q of queries) {
      try { const r = await yandexGeocode(q); if (r) return r; } catch (e) { /* continue */ }
    }
    for (const q of queries) {
      const r = await nominatimGeocode(q); if (r) return r;
    }
    const streetOnly = extractStreetName(cleanAddress);
    if (streetOnly) {
      try { const r = await yandexGeocode('Минск, ' + streetOnly); if (r) return r; } catch (e) { /* ignore */ }
    }
    throw new Error('Адрес не найден: ' + rawAddress);
  }

  // ─── Batch geocoding ────────────────────────────────────────
  async function geocodeOrders(orders, onProgress) {
    const results = [];
    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];
      try {
        const geo = await geocodeAddress(order.address);
        results.push(Object.assign({}, order, {
          lat: geo.lat,
          lng: geo.lng,
          formattedAddress: geo.formattedAddress,
          geocoded: true,
          error: null,
          settlementOnly: geo.settlementOnly || false,
        }));
      } catch (err) {
        results.push(Object.assign({}, order, { lat: null, lng: null, formattedAddress: null, geocoded: false, error: err.message }));
      }
      if (onProgress) onProgress(i + 1, orders.length);
      if (i < orders.length - 1) await new Promise(r => setTimeout(r, 300));
    }
    return results;
  }

  window.DistributionGeocoder = {
    loadYmaps: loadYmaps,
    geocodeAddress: geocodeAddress,
    geocodeOrders: geocodeOrders,
  };
})();
