/**
 * DriveControl — Geocoder module
 * Yandex Maps JS API (ymaps.geocode) primary, Nominatim fallback.
 * Two-step geocoding for regional addresses: settlement first, then street.
 */
(() => {
  "use strict";

  const YMAPS_SRC = 'https://api-maps.yandex.ru/2.1/?apikey=8c44c726-c732-45f2-94ac-af2cf0bb0181&lang=ru_RU&suggest_apikey=8b2a44b9-d35a-4aed-8e5a-4a1d71d30de8';
  const MINSK_BOUNDS = [[53.75, 27.25], [54.15, 27.90]];
  const MINSK_CITY_BOUNDS = [[53.82, 27.36], [54.02, 27.72]];

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


  // ─── Address normalization ──────────────────────────────────
  // Converts non-standard abbreviations to full words for better geocoding
  function normalizeAddress(address) {
    let s = address;
    // проспект: п-кт, пр-кт, п.кт, пр.кт
    s = s.replace(/п[\-\.]кт\.?(?=\s|,|$)/gi, 'проспект');
    s = s.replace(/пр[\-\.]кт\.?(?=\s|,|$)/gi, 'проспект');
    // проезд: пр-д, пр.д
    s = s.replace(/пр[\-\.]д\.?(?=\s|,|$)/gi, 'проезд');
    // переулок: пер-к, пер.к
    s = s.replace(/пер[\-\.]к\.?(?=\s|,|$)/gi, 'переулок');
    // бульвар: б-р, б.р
    s = s.replace(/б[\-\.]р\.?(?=\s|,|$)/gi, 'бульвар');
    // тракт: тр-т, тр.т
    s = s.replace(/тр[\-\.]т\.?(?=\s|,|$)/gi, 'тракт');
    // шоссе: ш.
    s = s.replace(/ш\.(?=\s)/gi, 'шоссе');
    // набережная: наб.
    s = s.replace(/наб\.(?=\s)/gi, 'набережная');
    // площадь: пл.
    s = s.replace(/пл\.(?=\s)/gi, 'площадь');
    // микрорайон: мкр., мкрн.
    s = s.replace(/мкр(?:н)?\.(?=\s)/gi, 'микрорайон');
    return s;
  }

  // ─── Settlement extraction ──────────────────────────────────
  // Extracts settlement name from address like "Прилуки, ул. Центральная 5"
  // or "аг.Самохваловичи, Калинина 31"
  function extractSettlement(address) {
    let s = address;
    // Remove country/region prefixes
    s = s.replace(/^(беларусь|республика\s*беларусь)[,\s]*/gi, '');
    s = s.replace(/^(минск(ий|ого|ому)\s*(район|р-н|обл\.?|область)?)[,\s]*/gi, '');
    s = s.replace(/^(минская\s*(обл\.?|область))[,\s]*/gi, '');
    s = s.trim();

    // Remove settlement type prefix (д., п., г., аг., дер., пос.)
    // Supports both "аг. Самохваловичи" and "аг.Самохваловичи" (dot without space)
    s = s.replace(/^(?:(?:д|дер|п|пос|г|гор|аг|с)(?:\.\s*|\s+)|(?:деревня|посёлок|поселок|город|село|агрогородок)\s+)/i, '').trim();

    // Find where street part begins (expanded regex with all abbreviation forms)
    const streetRegex = /(?:,\s*)?(?:ул\.?\s|улица\s|пр[\.\-]т?\s|п[\.\-]кт\.?\s|пр[\.\-]кт\.?\s|проспект\s|проезд\s|пр[\.\-]д\.?\s|бульвар\s|б[\.\-]р\.?\s|пер[\.\-]?к?\.?\s|переулок\s|тр[\.\-]т\.?\s|тракт\s|шоссе\s|ш\.\s|набережная\s|наб\.?\s|площадь\s|пл\.?\s|микрорайон\s|мкр(?:н)?\.?\s|\d+[\-\s]?(?:й|я|е|ой|ая|ое)\s)/i;
    const streetMatch = s.match(streetRegex);

    if (streetMatch && streetMatch.index > 0) {
      const settlement = s.substring(0, streetMatch.index).replace(/[,\s]+$/, '').trim();
      if (settlement.length > 1 && /^[А-ЯЁа-яё]/.test(settlement)) {
        return settlement;
      }
    }

    // Try comma separator: "Самохваловичи, Калинина 31"
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

  // ─── Minsk city validation ──────────────────────────────────
  function isResultInMinskCity(result) {
    if (!result || !result.lat || !result.lng) return false;
    return result.lat >= MINSK_CITY_BOUNDS[0][0] && result.lat <= MINSK_CITY_BOUNDS[1][0] &&
           result.lng >= MINSK_CITY_BOUNDS[0][1] && result.lng <= MINSK_CITY_BOUNDS[1][1];
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
    // Also try the raw address — Yandex has built-in typo tolerance
    fullQueries.push(cleanAddress);

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

  // ─── Minsk city geocoding (strict) ─────────────────────────
  async function geocodeInMinskCity(normalized, cleanAddress, rawAddress) {
    let streetPart = normalized.replace(/^[,\s]*(?:г\.?\s*)?минск\s*[,\s]*/i, '').trim();
    if (!streetPart || streetPart.length < 2) streetPart = normalized;

    const queries = [];
    if (streetPart !== normalized && streetPart.length > 2) {
      queries.push('Минск, ' + streetPart);
      queries.push('Беларусь, Минск, ' + streetPart);
    }
    queries.push('Минск, ' + normalized);
    queries.push('Беларусь, Минск, ' + normalized);

    const simplified = simplifyAddress(normalized);
    if (simplified !== normalized && simplified.length > 2) {
      queries.push('Минск, ' + simplified);
    }
    if (cleanAddress !== normalized) {
      queries.push('Минск, ' + cleanAddress);
    }

    const seen = {};
    const uniqueQueries = queries.filter(function (q) {
      if (seen[q]) return false;
      seen[q] = true;
      return true;
    });

    // Step 1: strict bounds — only results within Minsk city
    for (const q of uniqueQueries) {
      try {
        const r = await yandexGeocode(q, MINSK_CITY_BOUNDS, true);
        if (r && isResultInMinskCity(r)) return r;
      } catch (e) { /* continue */ }
    }

    // Step 2: soft bounds but validate coordinates are in Minsk
    for (const q of uniqueQueries) {
      try {
        const r = await yandexGeocode(q, MINSK_CITY_BOUNDS, false);
        if (r && isResultInMinskCity(r)) return r;
      } catch (e) { /* continue */ }
    }

    // Step 3: street-only as last resort
    const streetOnly = extractStreetName(normalized);
    if (streetOnly) {
      try {
        const r = await yandexGeocode('Минск, ' + streetOnly, MINSK_CITY_BOUNDS, true);
        if (r && isResultInMinskCity(r)) return r;
      } catch (e) { /* ignore */ }
    }

    // NOT FOUND in Minsk — do NOT fall through to broader search
    throw new Error('Адрес не найден в Минске: ' + rawAddress);
  }

  // ─── Address helpers ────────────────────────────────────────
  function simplifyAddress(address) {
    let s = address.replace(/^(минск|беларусь)[,\s]*/i, '').trim();
    const match = s.match(/((?:ул\.?|улица|пр-т|пр\.?|проспект|проезд|бульвар|б-р|пер\.?|переулок|тр-т|тракт|шоссе|площадь|набережная)\s*[А-Яа-яёЁ\s\.\-«»]+?\s+\d+[а-яА-Я]?)\b/i);
    if (match) return match[1].trim();
    const match2 = s.match(/^([А-Яа-яёЁ][А-Яа-яёЁа-я\s\.\-«»]+?\s+\d+[а-яА-Я]?)\b/);
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
    const normalized = normalizeAddress(cleanAddress);

    const isMinskRegion = /минск(ий|ого|ому)/i.test(normalized) ||
      /прилуки|копище|богатырёво|богатырево|лесной|сеница|боровляны|колодищи|заславль|фаниполь|ратомка|тарасово|озерцо|щомыслица|новый\s*двор|атолино|хатежино|дзержинск|столбцы|смолевичи|жодино|логойск|руденск|михановичи|привольный|сосны|зелёный\s*бор|зеленый\s*бор|луговая\s*слобода|лесковка|большевик|мачулищи|гатово|чуриловичи|колядичи|паперня|самохваловичи|fanipol|borovlyany/i.test(normalized);
    // "Минск" as city name (not "Минский", "Минская", "Минского")
    const hasMinskCity = /минск(?![а-яё])/i.test(normalized) && !isMinskRegion;
    const settlement = extractSettlement(normalized);

    // 1. Regional addresses (villages, suburbs of Minsk)
    if (isMinskRegion) {
      try {
        const regional = await geocodeRegional(normalized);
        if (regional) return regional;
      } catch (e) { /* fall through */ }
      const queries = [
        'Беларусь, Минский район, ' + normalized,
        normalized,
      ];
      for (const q of queries) {
        try { const r = await yandexGeocode(q); if (r) return r; } catch (e) { /* continue */ }
      }
      throw new Error('Адрес не найден: ' + rawAddress);
    }

    // 2. Minsk city: "Минск" explicitly mentioned OR no settlement → default to Minsk
    if (hasMinskCity || !settlement) {
      return await geocodeInMinskCity(normalized, cleanAddress, rawAddress);
    }

    // 3. Other settlements (non-Minsk, non-region)
    const queries = [normalized, 'Беларусь, ' + normalized];
    for (const q of queries) {
      try { const r = await yandexGeocode(q); if (r) return r; } catch (e) { /* continue */ }
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
