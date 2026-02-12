/**
 * DriveControl — Geocoder module
 * Yandex Maps JS API (ymaps.geocode) primary, Nominatim fallback.
 */
(() => {
  "use strict";

  const YMAPS_SRC = 'https://api-maps.yandex.ru/2.1/?lang=ru_RU';

  function loadYmaps() {
    return new Promise((resolve, reject) => {
      if (window.ymaps && window.ymaps.geocode) {
        window.ymaps.ready(() => resolve(window.ymaps));
        return;
      }
      // Check if script already added
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

  async function yandexGeocode(searchQuery) {
    const ymaps = await loadYmaps();
    const result = await ymaps.geocode(searchQuery, {
      results: 1,
      boundedBy: [[53.75, 27.25], [54.15, 27.90]],
      strictBounds: false,
    });
    const geoObject = result.geoObjects.get(0);
    if (!geoObject) return null;
    const coords = geoObject.geometry.getCoordinates();
    const formattedAddress = geoObject.getAddressLine();
    const precision = geoObject.properties.get('metaDataProperty.GeocoderMetaData.precision');
    if (precision === 'other') return null;
    return { lat: coords[0], lng: coords[1], formattedAddress: formattedAddress };
  }

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

  async function geocodeAddress(rawAddress) {
    const cleanAddress = window.DistributionParser.cleanAddressForGeocoding(rawAddress);

    const isMinskRegion = /минск(ий|ого|ому)/i.test(cleanAddress) ||
      /прилуки|копище|богатырёво|богатырево|лесной|сеница|боровляны|колодищи|заславль|фаниполь/i.test(cleanAddress);
    const hasMinsk = /минск/i.test(cleanAddress);

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

  async function geocodeOrders(orders, onProgress) {
    const results = [];
    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];
      try {
        const geo = await geocodeAddress(order.address);
        results.push(Object.assign({}, order, { lat: geo.lat, lng: geo.lng, formattedAddress: geo.formattedAddress, geocoded: true, error: null }));
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
