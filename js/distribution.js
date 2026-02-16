/**
 * DriveControl — Distribution UI module
 * Renders the "Распределение маршрутов" tab with Yandex Map.
 * Persists data to localStorage. Publishes routes to Supabase.
 */
(() => {
  "use strict";

  const MINSK_CENTER = [53.9006, 27.559];
  const DEFAULT_ZOOM = 12;
  const COLORS = window.DistributionAlgo.DRIVER_COLORS;
  const STORAGE_KEY = 'dc_distribution_data';

  let orders = [];
  let assignments = null;
  let variants = [];
  let activeVariant = -1;
  let driverCount = 3;
  let selectedDriver = null;
  let isGeocoding = false;
  let mapInstance = null;
  let placemarks = [];
  let placingOrderId = null;
  let editingOrderId = null;

  // Водители из БД
  let dbDrivers = [];
  // Поставщики из БД (кэш)
  let dbSuppliers = [];
  let isLoadingSuppliers = false;
  // Привязка цвет-индекс → driver_id (driverSlots[0] = driver_id для цвета 0)
  let driverSlots = [];
  // Collapsed/expanded state for sidebar lists
  let _supplierListOpen = true;
  let _addressListOpen = true;
  let _driversListOpen = true;

  // ─── Fixed POI locations (ПВЗ / склады) ──────────────────
  var POI_DEFS = [
    { id: 'pvz1', label: 'ПВЗ 1', short: 'П1', address: 'Минск, Притыцкого 89', color: '#2563eb' },
    { id: 'pvz2', label: 'ПВЗ 2', short: 'П2', address: 'Минск, Туровского 12', color: '#7c3aed' },
    { id: 'rbdodoma', label: 'РБ Додома', short: 'РБ', address: 'Минск, Железнодорожная 33к1', color: '#ea580c' },
  ];
  var poiCoords = {};    // { pvz1: { lat, lng, formatted }, ... } — cached after geocode

  // ─── DOM helpers ──────────────────────────────────────────
  const $ = (sel, ctx) => (ctx || document).querySelector(sel);

  function showToast(msg, type) {
    const el = document.createElement('div');
    el.className = 'dc-toast ' + (type === 'error' ? 'dc-toast-error' : 'dc-toast-ok');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => { el.classList.add('dc-toast-show'); }, 10);
    setTimeout(() => { el.remove(); }, 3500);
  }

  // ─── Load drivers from DB ──────────────────────────────────
  async function loadDbDrivers() {
    try {
      if (window.VehiclesDB && window.VehiclesDB.getAllDrivers) {
        dbDrivers = await window.VehiclesDB.getAllDrivers();
      }
    } catch (e) {
      console.warn('Failed to load drivers:', e);
      dbDrivers = [];
    }
  }

  // ─── Load suppliers from DB ───────────────────────────────
  async function loadDbSuppliers() {
    try {
      if (window.SuppliersDB && window.SuppliersDB.getAllWithId) {
        dbSuppliers = await window.SuppliersDB.getAllWithId();
      }
    } catch (e) {
      console.warn('Failed to load suppliers:', e);
      dbSuppliers = [];
    }
  }

  // Strip organizational form and quotes: ООО "Название" → Название
  function stripOrgForm(s) {
    // Remove org form prefixes: ООО, ОДО, ЧУП, УП, ИП, ЗАО, ОАО, ЧТУП, СООО, ИООО, etc.
    var cleaned = s.replace(/^(?:ООО|ОДО|ЧУП|УП|ИП|ЗАО|ОАО|ЧТУП|СООО|ИООО|ЧП|СП)\s*/i, '');
    // Remove all types of quotes
    cleaned = cleaned.replace(/[«»""\"\"''\'\'„"‟❝❞⹂〝〞〟＂]/g, '');
    return cleaned.trim();
  }

  // Extract time slot from supplier line: "Название до 14" → { name: "Название", timeSlot: "до 14" }
  function extractSupplierTimeSlot(line) {
    var timeMatch = line.match(/\s+(до\s+\d{1,2}(?:[:.]\d{2})?|после\s+\d{1,2}(?:[:.]\d{2})?|с\s+\d{1,2}(?:[:.]\d{2})?\s*(?:до|[-–])\s*\d{1,2}(?:[:.]\d{2})?)\s*$/i);
    if (timeMatch) {
      return {
        name: line.substring(0, timeMatch.index).trim(),
        timeSlot: timeMatch[1].trim(),
      };
    }
    return { name: line, timeSlot: null };
  }

  // Normalize for display: lowercase, collapse spaces
  function normalizeName(s) {
    return s.toLowerCase().replace(/ё/g, 'е').replace(/[«»"""''\"\'„"‟❝❞⹂〝〞〟＂]/g, '').replace(/\s+/g, ' ').trim();
  }

  // Compact string for comparison: strip org form, quotes, ALL spaces, punctuation → single slug
  function compactName(s) {
    var c = s.toLowerCase();
    // Remove org forms
    c = c.replace(/^(?:ооо|одо|чуп|уп|ип|зао|оао|чтуп|сооо|иооо|чп|сп)\s*/i, '');
    // Remove all quotes, punctuation, dashes, spaces
    c = c.replace(/[«»"""''\"\'„"‟❝❞⹂〝〞〟＂\s\-–—.,;:!?()[\]{}/\\+&]/g, '');
    // ё → е
    c = c.replace(/ё/g, 'е');
    return c;
  }

  // Find supplier in DB by name (compact comparison: no spaces, no quotes, no org form)
  function findSupplierInDb(name) {
    var n = compactName(name);
    if (!n || n.length < 2) return null;

    // 1. Exact compact match
    var exact = dbSuppliers.find(function (s) { return compactName(s.name) === n; });
    if (exact) return exact;

    // 2. One contains the other
    var partial = dbSuppliers.find(function (s) {
      var sn = compactName(s.name);
      return sn.includes(n) || n.includes(sn);
    });
    if (partial) return partial;

    return null;
  }

  // Search suppliers for autocomplete (returns top N matches)
  function searchSuppliers(query, limit) {
    var q = compactName(query);
    if (!q || q.length < 1) return [];
    var results = [];
    for (var i = 0; i < dbSuppliers.length; i++) {
      var s = dbSuppliers[i];
      var sn = compactName(s.name);
      if (sn.includes(q)) {
        results.push(s);
        if (results.length >= (limit || 8)) break;
      }
    }
    return results;
  }

  // Resolve driver_id for an order: direct assignment takes priority, then slot-based
  function getOrderDriverId(idx) {
    var order = orders[idx];
    if (order && order.assignedDriverId) return order.assignedDriverId;
    if (assignments && assignments[idx] >= 0) return driverSlots[assignments[idx]] || null;
    return null;
  }

  // Get slot index for an order (for color) — read-only, no side effects
  function getOrderSlotIdx(idx) {
    var order = orders[idx];
    if (order && order.assignedDriverId) {
      var existingSlot = driverSlots.indexOf(order.assignedDriverId);
      if (existingSlot >= 0) return existingSlot;
      // Find slot by matching dbDrivers index for consistent color
      var driverIndex = dbDrivers.findIndex(function (d) { return d.id === order.assignedDriverId; });
      return driverIndex >= 0 ? driverIndex : -1;
    }
    return assignments ? assignments[idx] : -1;
  }

  function getDriverName(slotIdx) {
    const driverId = driverSlots[slotIdx];
    if (!driverId) return 'В' + (slotIdx + 1);
    const d = dbDrivers.find(function (dr) { return dr.id === driverId; });
    return d ? d.name.split(' ')[0] : 'В' + (slotIdx + 1);
  }

  function getDriverNameById(driverId) {
    var d = dbDrivers.find(function (dr) { return dr.id === driverId; });
    return d ? d.name.split(' ')[0] : '?';
  }

  function getDriverFullName(slotIdx) {
    const driverId = driverSlots[slotIdx];
    if (!driverId) return 'Водитель ' + (slotIdx + 1);
    const d = dbDrivers.find(function (dr) { return dr.id === driverId; });
    return d ? d.name : 'Водитель ' + (slotIdx + 1);
  }

  // ─── Persistence (localStorage) ───────────────────────────
  function saveState() {
    try {
      const data = {
        orders: orders,
        assignments: assignments,
        driverCount: driverCount,
        activeVariant: activeVariant,
        driverSlots: driverSlots,
        poiCoords: poiCoords,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('localStorage save error:', e);
    }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (data.orders && data.orders.length > 0) {
        orders = data.orders;
        assignments = data.assignments || null;
        driverCount = data.driverCount || 3;
        activeVariant = data.activeVariant != null ? data.activeVariant : -1;
        driverSlots = data.driverSlots || [];
        poiCoords = data.poiCoords || {};
        // Ensure driverSlots has correct length
        while (driverSlots.length < driverCount) driverSlots.push(null);
        // Regenerate variants if we had assignments
        if (assignments && orders.length > 0) {
          variants = window.DistributionAlgo.generateVariants(orders, driverCount);
        }
        return true;
      }
    } catch (e) {
      console.warn('localStorage load error:', e);
    }
    return false;
  }

  function clearState() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  }

  // ─── Map ──────────────────────────────────────────────────
  var _mapInitPromise = null;
  async function initMap() {
    const container = $('#distributionMap');
    if (!container || mapInstance) return;
    if (_mapInitPromise) return _mapInitPromise;
    _mapInitPromise = (async function () {
    try {
      const ymaps = await window.DistributionGeocoder.loadYmaps();
      if (mapInstance) return; // double-check after await
      mapInstance = new ymaps.Map(container, {
        center: MINSK_CENTER, zoom: DEFAULT_ZOOM,
        controls: ['zoomControl', 'fullscreenControl'],
      }, { suppressMapOpenBlock: true });

      mapInstance.events.add('click', function (e) {
        if (placingOrderId) {
          var coords = e.get('coords');
          orders = orders.map(function (o) {
            if (o.id !== placingOrderId) return o;
            return Object.assign({}, o, { lat: coords[0], lng: coords[1], geocoded: true, error: null, settlementOnly: false, formattedAddress: coords[0].toFixed(5) + ', ' + coords[1].toFixed(5) + ' (вручную)' });
          });
          placingOrderId = null;
          _fitBoundsNext = true;
          renderAll();
          showToast('Точка установлена вручную');
        }
      });

      // Close balloon when clicking on empty area of map
      mapInstance.events.add('click', function () {
        try { if (mapInstance.balloon.isOpen()) mapInstance.balloon.close(); } catch (e) {}
      });
    } catch (err) {
      console.error('Map init error:', err);
    }
    })();
    return _mapInitPromise;
  }

  var _fitBoundsNext = true;

  // ─── POI: add/remove as regular orders ──────────────────
  function isPoiActive(poiId) {
    return orders.some(function (o) { return o.poiId === poiId; });
  }

  async function togglePoi(poiId) {
    var existing = orders.findIndex(function (o) { return o.poiId === poiId; });

    if (existing >= 0) {
      // Remove POI from orders
      orders.splice(existing, 1);
      if (assignments) { assignments.splice(existing, 1); }
      variants = []; activeVariant = -1;
      renderAll();
      return;
    }

    // Add POI — geocode if not cached
    var def = POI_DEFS.find(function (p) { return p.id === poiId; });
    if (!def) return;

    if (!poiCoords[poiId] || poiCoords[poiId]._addr !== def.address) {
      try {
        showToast('Ищу адрес: ' + def.address + '...');
        var geo = await window.DistributionGeocoder.geocodeAddress(def.address);
        poiCoords[poiId] = { lat: geo.lat, lng: geo.lng, formatted: geo.formattedAddress || def.address, _addr: def.address };
      } catch (e) {
        showToast('Не найден: ' + def.address, 'error');
        return;
      }
    }

    var c = poiCoords[poiId];
    orders.push({
      id: 'poi_' + poiId + '_' + Date.now(),
      poiId: poiId,
      isPoi: true,
      poiLabel: def.label,
      poiShort: def.short,
      poiColor: def.color,
      address: def.label + ' — ' + def.address,
      lat: c.lat,
      lng: c.lng,
      geocoded: true,
      formattedAddress: c.formatted,
      error: null,
      settlementOnly: false,
    });

    if (assignments) {
      assignments.push(-1); // unassigned by default
    }

    _fitBoundsNext = true;
    renderAll();
    showToast(def.label + ' добавлен на карту');
  }

  function updatePlacemarks() {
    if (!mapInstance || !window.ymaps) return;
    var ymaps = window.ymaps;

    // Do NOT call balloon.close() — removing the placemark auto-closes it.
    // Manual balloon.close() was causing the map to break.

    // Remove all old placemarks
    for (var r = placemarks.length - 1; r >= 0; r--) {
      try { mapInstance.geoObjects.remove(placemarks[r]); } catch (e) {}
    }
    placemarks = [];

    var geocoded = orders.filter(function (o) { return o.geocoded && o.lat && o.lng; });
    if (geocoded.length === 0) return;

    var bounds = [];
    geocoded.forEach(function (order) {
      try {
      var globalIdx = orders.indexOf(order);
      var slotIdx = getOrderSlotIdx(globalIdx);
      var driverIdx = slotIdx; // for balloon color compatibility
      var orderDriverId = getOrderDriverId(globalIdx);
      var isVisible = selectedDriver === null || orderDriverId === selectedDriver || (selectedDriver === '__unassigned__' && !orderDriverId);
      var isSettlementOnly = order.settlementOnly;
      var isUnassigned = slotIdx < 0;
      var defaultColor = isSettlementOnly ? '#f59e0b' : '#e0e0e0';
      var color = !isUnassigned ? COLORS[slotIdx % COLORS.length] : defaultColor;

      var hintHtml = '<b>' + (globalIdx + 1) + '. ' + order.address + '</b>' +
        (order.isSupplier ? '<br><span style="color:#10b981;font-size:11px;">Поставщик</span>' : '') +
        (order.formattedAddress ? '<br><span style="color:#666;font-size:12px;">' + order.formattedAddress + '</span>' : '') +
        (isSettlementOnly ? '<br><span style="color:#f59e0b;font-size:11px;">⚠ Только населённый пункт</span>' : '') +
        (order.isKbt ? '<br><span style="color:#e879f9;font-size:11px;font-weight:700;">📦 КБТ</span>' : '');

      var pm;
      if (order.isPoi) {
        // POI: filled square marker with short label
        var sqColor = !isUnassigned ? color : (order.poiColor || '#e0e0e0');
        var opacity = isVisible ? 1 : 0.25;
        var sqBorder = isUnassigned ? '2px solid #888' : '2px solid rgba(255,255,255,.8)';
        var sqHtml = '<div style="width:24px;height:24px;border-radius:4px;background:' + sqColor + ';display:flex;align-items:center;justify-content:center;box-shadow:0 2px 5px rgba(0,0,0,.35);border:' + sqBorder + ';opacity:' + opacity + ';">' +
          '<span style="color:#111;font-size:10px;font-weight:800;text-shadow:0 0 3px rgba(255,255,255,.9);">' + (order.poiShort || 'П') + '</span></div>';
        var sqLayout = ymaps.templateLayoutFactory.createClass(sqHtml);
        pm = new ymaps.Placemark([order.lat, order.lng], {
          balloonContentBody: buildBalloon(order, globalIdx, driverIdx),
          hintContent: hintHtml,
        }, {
          iconLayout: sqLayout,
          iconShape: { type: 'Rectangle', coordinates: [[0, 0], [24, 24]] },
          iconOffset: [-12, -12],
        });
      } else if (order.isSupplier) {
        // Supplier: diamond-shaped marker
        var supColor = !isUnassigned ? color : '#e0e0e0';
        var supOpacity = isVisible ? 1 : 0.25;
        var supTextColor = isUnassigned ? '#333' : '#fff';
        var supBorder = isUnassigned ? '2px solid #888' : '2px solid rgba(255,255,255,.9)';
        var supHtml = '<div style="width:26px;height:26px;transform:rotate(45deg);border-radius:4px;background:' + supColor + ';display:flex;align-items:center;justify-content:center;box-shadow:0 2px 5px rgba(0,0,0,.35);border:' + supBorder + ';opacity:' + supOpacity + ';">' +
          '<span style="transform:rotate(-45deg);color:' + supTextColor + ';font-size:10px;font-weight:800;">П</span></div>';
        var supLayout = ymaps.templateLayoutFactory.createClass(supHtml);
        pm = new ymaps.Placemark([order.lat, order.lng], {
          balloonContentBody: buildBalloon(order, globalIdx, driverIdx),
          hintContent: hintHtml,
        }, {
          iconLayout: supLayout,
          iconShape: { type: 'Rectangle', coordinates: [[0, 0], [26, 26]] },
          iconOffset: [-13, -13],
        });
      } else if (isUnassigned) {
        // Unassigned regular order: custom circle with visible border
        var uaOpacity = isVisible ? 1 : 0.25;
        var uaBorder = isSettlementOnly ? '2px solid #d97706' : '2px solid #888';
        var uaBg = isSettlementOnly ? '#f59e0b' : '#e0e0e0';
        var uaText = isSettlementOnly ? '#fff' : '#333';
        var uaHtml = '<div style="width:28px;height:28px;border-radius:50%;background:' + uaBg + ';display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.4);border:' + uaBorder + ';opacity:' + uaOpacity + ';">' +
          '<span style="color:' + uaText + ';font-size:11px;font-weight:800;">' + (globalIdx + 1) + '</span></div>';
        var uaLayout = ymaps.templateLayoutFactory.createClass(uaHtml);
        pm = new ymaps.Placemark([order.lat, order.lng], {
          balloonContentBody: buildBalloon(order, globalIdx, driverIdx),
          hintContent: hintHtml,
        }, {
          iconLayout: uaLayout,
          iconShape: { type: 'Circle', coordinates: [14, 14], radius: 14 },
          iconOffset: [-14, -14],
        });
      } else {
        // Assigned regular order: standard circle icon with color
        pm = new ymaps.Placemark([order.lat, order.lng], {
          balloonContentBody: buildBalloon(order, globalIdx, driverIdx),
          iconContent: String(globalIdx + 1),
          hintContent: hintHtml,
        }, {
          preset: isSettlementOnly ? 'islands#circleDotIcon' : 'islands#circleIcon',
          iconColor: color,
          iconOpacity: isVisible ? 1 : 0.25,
        });
      }

      // Hover: highlight sidebar
      (function (orderId) {
        pm.events.add('mouseenter', function () {
          var el = document.querySelector('.dc-order-item[data-order-id="' + orderId + '"]');
          if (el) { el.classList.add('dc-order-highlighted'); el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
        });
        pm.events.add('mouseleave', function () {
          var el = document.querySelector('.dc-order-item[data-order-id="' + orderId + '"]');
          if (el) el.classList.remove('dc-order-highlighted');
        });
      })(order.id);

      mapInstance.geoObjects.add(pm);
      placemarks.push(pm);
      bounds.push([order.lat, order.lng]);

      // KBT ring (circle inside circle)
      if (order.isKbt && isVisible) {
        var ringHtml = '<div style="width:44px;height:44px;border-radius:50%;background:' + color + ';opacity:0.3;pointer-events:none;"></div>';
        var ringLayout = ymaps.templateLayoutFactory.createClass(ringHtml);
        var ring = new ymaps.Placemark([order.lat, order.lng], {}, {
          iconLayout: ringLayout,
          iconOffset: [-22, -22],
          iconShape: { type: 'Circle', coordinates: [0, 0], radius: 0 },
        });
        mapInstance.geoObjects.add(ring);
        placemarks.push(ring);
      }
      } catch (e) { console.error('Placemark error for order', order.id, e); }
    });

    if (_fitBoundsNext && bounds.length > 0) {
      mapInstance.setBounds(ymaps.util.bounds.fromPoints(bounds), { checkZoomRange: true, zoomMargin: 40 });
      _fitBoundsNext = false;
    }

  }

  function buildBalloon(order, globalIdx, driverIdx) {
    var currentDriverId = getOrderDriverId(globalIdx);
    let buttons = '';
    dbDrivers.forEach(function (dr, di) {
      var c = COLORS[di % COLORS.length];
      var active = dr.id === currentDriverId;
      var displayName = dr.name.split(' ')[0];
      buttons += '<button onclick="window.__dc_assignDirect(' + globalIdx + ',\'' + dr.id + '\')" style="display:flex;align-items:center;gap:4px;padding:4px 8px;border-radius:12px;border:2px solid ' + (active ? '#fff' : 'transparent') + ';background:' + c + ';cursor:pointer;margin:2px;box-shadow:' + (active ? '0 0 0 2px ' + c : 'none') + ';color:#fff;font-size:11px;font-weight:600;" title="' + dr.name + '"><span style="width:10px;height:10px;border-radius:50%;background:rgba(255,255,255,0.4);"></span>' + displayName + '</button>';
    });
    // Unassign button
    if (currentDriverId) {
      buttons += '<button onclick="window.__dc_assignDirect(' + globalIdx + ',null)" style="display:flex;align-items:center;gap:4px;padding:4px 8px;border-radius:12px;border:1px solid #ddd;background:#f5f5f5;cursor:pointer;margin:2px;color:#999;font-size:11px;">✕ Снять</button>';
    }
    const eid = order.id.replace(/'/g, "\\'");

    // KBT section
    var kbtHtml = '<div style="border-top:1px solid #eee;padding-top:8px;margin-top:8px;">';
    var kbtActive = order.isKbt;
    kbtHtml += '<button onclick="window.__dc_toggleKbt(' + globalIdx + ')" style="display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border-radius:8px;border:2px solid ' + (kbtActive ? '#a855f7' : '#ddd') + ';background:' + (kbtActive ? '#a855f7' : '#fff') + ';color:' + (kbtActive ? '#fff' : '#666') + ';cursor:pointer;font-size:12px;font-weight:600;">📦 КБТ +1' + (kbtActive ? ' ✓' : '') + '</button>';

    if (kbtActive) {
      kbtHtml += '<div style="margin-top:8px;font-size:11px;color:#888;">Помощник (едет вместе):</div>';
      kbtHtml += '<div style="display:flex;flex-wrap:wrap;margin-top:4px;">';
      dbDrivers.forEach(function (hdr, hi) {
        if (hdr.id === currentDriverId) return; // can't be helper and main driver
        var hc = COLORS[hi % COLORS.length];
        var hActive = order.helperDriverSlot === hi;
        var hName = hdr.name.split(' ')[0];
        kbtHtml += '<button onclick="window.__dc_setHelper(' + globalIdx + ',' + hi + ')" style="display:flex;align-items:center;gap:4px;padding:3px 8px;border-radius:10px;border:2px solid ' + (hActive ? '#a855f7' : 'transparent') + ';background:' + (hActive ? 'rgba(168,85,247,0.15)' : '#f5f5f5') + ';cursor:pointer;margin:2px;color:' + (hActive ? '#a855f7' : '#666') + ';font-size:11px;font-weight:' + (hActive ? '700' : '500') + ';">' +
          '<span style="width:8px;height:8px;border-radius:50%;background:' + hc + ';"></span>' + hName + (hActive ? ' ✓' : '') + '</button>';
      });
      kbtHtml += '</div>';
    }
    kbtHtml += '</div>';

    return '<div style="font-family:system-ui,sans-serif;min-width:240px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">' +
      '<div style="font-weight:700;font-size:14px;margin-bottom:4px;">' + order.address + '</div>' +
      '<button onclick="window.__dc_delete(\'' + eid + '\')" style="flex-shrink:0;width:26px;height:26px;border-radius:6px;border:1px solid #e5e5e5;background:#fff;color:#ef4444;font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;" title="Удалить">✕</button></div>' +
      (order.formattedAddress ? '<div style="color:#888;font-size:11px;margin-bottom:4px;">' + order.formattedAddress + '</div>' : '') +
      (order.timeSlot ? '<div style="font-size:12px;margin-bottom:4px;">⏰ ' + order.timeSlot + '</div>' : '') +
      (order.phone ? '<div style="font-size:12px;margin-bottom:8px;">📞 ' + order.phone + '</div>' : '') +
      '<div style="border-top:1px solid #eee;padding-top:8px;margin-top:4px;">' +
      '<div style="font-size:11px;color:#888;margin-bottom:6px;">Назначить водителя:</div>' +
      '<div style="display:flex;flex-wrap:wrap;align-items:center;">' + buttons + '</div></div>' +
      kbtHtml + '</div>';
  }

  // ─── Global callbacks for balloon HTML buttons ──────────
  // Called SYNCHRONOUSLY — no setTimeout, no balloon.close().
  // Removing the placemark in updatePlacemarks() auto-closes the balloon.
  // JS is single-threaded so the onclick handler runs to completion
  // even if its DOM element is destroyed during renderAll().

  window.__dc_assign = function (globalIdx, driverIdx) {
    if (!assignments) {
      assignments = [];
      for (var i = 0; i < orders.length; i++) assignments.push(-1);
    }
    assignments = assignments.slice();
    assignments[globalIdx] = (driverIdx != null ? driverIdx : -1);
    // Clear direct assignment if using slot-based
    if (orders[globalIdx]) orders[globalIdx].assignedDriverId = null;
    activeVariant = -1;
    renderAll();
  };

  // Direct assignment by driver_id (no distribute needed)
  window.__dc_assignDirect = function (globalIdx, driverId) {
    var order = orders[globalIdx];
    if (!order) return;
    order.assignedDriverId = driverId || null;
    // Also clear algorithm assignment when unassigning
    if (!driverId && assignments && assignments[globalIdx] >= 0) {
      assignments = assignments.slice();
      assignments[globalIdx] = -1;
    }
    activeVariant = -1;
    renderAll();
  };

  window.__dc_delete = function (orderId) {
    var idx = orders.findIndex(function (o) { return o.id === orderId; });
    if (idx === -1) return;
    orders.splice(idx, 1);
    if (assignments) { assignments.splice(idx, 1); }
    variants = []; activeVariant = -1;
    renderAll();
    showToast('Точка удалена');
  };

  window.__dc_toggleKbt = function (globalIdx) {
    var order = orders[globalIdx];
    if (!order) return;
    order.isKbt = !order.isKbt;
    if (!order.isKbt) { order.helperDriverSlot = null; }
    renderAll();
  };

  window.__dc_setHelper = function (globalIdx, helperSlot) {
    var order = orders[globalIdx];
    if (!order) return;
    order.helperDriverSlot = helperSlot;
    renderAll();
  };

  // ─── Actions ──────────────────────────────────────────────
  async function loadAddresses(append) {
    const textarea = $('#dcAddressInput');
    if (!textarea) return;
    const text = textarea.value;
    const parsed = window.DistributionParser.parseOrders(text);
    if (parsed.length === 0) { showToast('Не найдено адресов', 'error'); return; }

    if (!append) {
      // Keep supplier orders, remove only address orders
      var keepOrders = [];
      var keepAssignments = [];
      for (var k = 0; k < orders.length; k++) {
        if (orders[k].isSupplier) {
          keepOrders.push(orders[k]);
          if (assignments) keepAssignments.push(assignments[k]);
        }
      }
      orders = keepOrders;
      assignments = keepAssignments.length > 0 ? keepAssignments : null;
      variants = []; activeVariant = -1;
    }
    const prevAssignments = assignments;
    isGeocoding = true;
    _fitBoundsNext = true;
    renderAll();

    const progressEl = $('#dcProgress');
    try {
      const geocoded = await window.DistributionGeocoder.geocodeOrders(parsed, function (cur, tot) {
        if (progressEl) progressEl.textContent = cur + '/' + tot;
      });
      orders = orders.concat(geocoded);
      if (prevAssignments) {
        assignments = prevAssignments.slice();
        for (let i = 0; i < geocoded.length; i++) {
          assignments.push(-1);
        }
      }
      const ok = geocoded.filter(function (o) { return o.geocoded; }).length;
      const fail = geocoded.length - ok;
      showToast((append ? 'Добавлено ' + geocoded.length + '. ' : '') + 'Найдено: ' + ok + (fail > 0 ? ', ошибок: ' + fail : ''), fail > 0 ? 'error' : undefined);
    } catch (err) {
      showToast('Ошибка: ' + err.message, 'error');
    } finally {
      isGeocoding = false;
      textarea.value = '';
      renderAll();
    }
  }

  // ─── Supplier loading ────────────────────────────────────
  async function loadSuppliers(append) {
    const textarea = $('#dcSupplierInput');
    if (!textarea) return;
    const text = textarea.value.trim();
    if (!text) { showToast('Вставьте названия поставщиков', 'error'); return; }
    try {

    // Parse supplier names (one per line)
    const names = text.split('\n').map(function (l) { return l.trim(); }).filter(function (l) { return l.length > 0; });
    if (names.length === 0) { showToast('Не найдено поставщиков', 'error'); return; }

    // Reload suppliers from DB to have fresh data
    isLoadingSuppliers = true;
    renderAll();
    await loadDbSuppliers();

    var prevAssignments = append ? assignments : null;
    if (!append) {
      // Remove only supplier orders, keep address orders
      var keepOrders = [];
      var keepAssignments = [];
      for (var k = 0; k < orders.length; k++) {
        if (!orders[k].isSupplier) {
          keepOrders.push(orders[k]);
          if (assignments) keepAssignments.push(assignments[k]);
        }
      }
      orders = keepOrders;
      assignments = keepAssignments.length > 0 ? keepAssignments : null;
      variants = []; activeVariant = -1;
    }

    var found = 0, notFound = 0, needGeocode = [];
    var supplierOrders = [];
    var orderCounter = Date.now();

    for (var i = 0; i < names.length; i++) {
      var rawLine = names[i].replace(/^\d+[\.):\-\s]+\s*/, '').trim();
      if (!rawLine) continue;

      // Extract time slot from end of line ("до 14", "после 15", etc.)
      var parsed = extractSupplierTimeSlot(rawLine);
      var name = parsed.name;
      var timeSlot = parsed.timeSlot;

      // Strip org form + quotes for clean display name
      var cleanName = stripOrgForm(name);

      orderCounter++;
      var supplier = findSupplierInDb(name);

      if (supplier && supplier.lat && supplier.lon) {
        // Found in DB with coordinates
        found++;
        supplierOrders.push({
          id: 'supplier-' + orderCounter + '-' + i,
          address: supplier.name,
          phone: '',
          timeSlot: timeSlot,
          geocoded: true,
          lat: supplier.lat,
          lng: supplier.lon,
          formattedAddress: supplier.address || (supplier.lat + ', ' + supplier.lon),
          error: null,
          isSupplier: true,
          supplierDbId: supplier.id,
          supplierName: supplier.name,
          supplierData: supplier,
        });
      } else if (supplier && (!supplier.lat || !supplier.lon)) {
        // Found but no coordinates — needs geocoding
        notFound++;
        supplierOrders.push({
          id: 'supplier-' + orderCounter + '-' + i,
          address: supplier.name,
          phone: '',
          timeSlot: timeSlot,
          geocoded: false,
          lat: null,
          lng: null,
          formattedAddress: null,
          error: 'Нет координат в базе',
          isSupplier: true,
          supplierDbId: supplier.id,
          supplierName: supplier.name,
          supplierData: supplier,
        });
        needGeocode.push(supplierOrders[supplierOrders.length - 1]);
      } else {
        // Not found in DB — use cleaned name
        notFound++;
        supplierOrders.push({
          id: 'supplier-' + orderCounter + '-' + i,
          address: rawLine,
          phone: '',
          timeSlot: timeSlot,
          geocoded: false,
          lat: null,
          lng: null,
          formattedAddress: null,
          error: 'Не найден в базе',
          isSupplier: true,
          supplierDbId: null,
          supplierName: cleanName || name,
          supplierData: null,
        });
      }
    }

    // Geocode suppliers that have address in DB but no coordinates
    for (var g = 0; g < needGeocode.length; g++) {
      var so = needGeocode[g];
      var addr = so.supplierData && so.supplierData.address ? so.supplierData.address : so.address;
      try {
        var geo = await window.DistributionGeocoder.geocodeAddress(addr);
        so.lat = geo.lat;
        so.lng = geo.lng;
        so.formattedAddress = geo.formattedAddress;
        so.geocoded = true;
        so.error = null;
        found++;
        notFound--;
      } catch (e) { /* keep as not found */ }
    }

    // Add supplier orders to main orders array
    orders = orders.concat(supplierOrders);
    if (prevAssignments) {
      assignments = prevAssignments.slice();
      for (var a = 0; a < supplierOrders.length; a++) assignments.push(-1);
    } else if (!append) {
      // Reset distribution since we replaced suppliers
      assignments = null; variants = []; activeVariant = -1;
    }

    _fitBoundsNext = true;
    textarea.value = '';
    showToast('Поставщики: найдено ' + found + (notFound > 0 ? ', не найдено: ' + notFound : ''), notFound > 0 ? 'error' : undefined);
    } catch (err) {
      console.error('loadSuppliers error:', err);
      showToast('Ошибка загрузки поставщиков: ' + err.message, 'error');
    } finally {
      isLoadingSuppliers = false;
      renderAll();
    }
  }

  // ─── Create supplier from distribution ─────────────────────
  function createSupplierFromOrder(orderId) {
    var order = orders.find(function (o) { return o.id === orderId; });
    if (!order || !order.isSupplier) return;

    if (!window.SupplierModal || !window.SupplierModal.open) {
      showToast('Модуль поставщиков не загружен', 'error');
      return;
    }

    // Pre-fill data for the modal
    var prefill = {
      name: order.supplierName || stripOrgForm(order.address),
      address: order.formattedAddress || '',
      lat: order.lat || '',
      lon: order.lng || '',
    };

    // Set callback: after supplier is saved in modal, update the distribution order
    window._onSupplierSaved = async function (savedSupplier) {
      await loadDbSuppliers();
      // Find the created supplier in DB
      var created = dbSuppliers.find(function (s) {
        return compactName(s.name) === compactName(savedSupplier.name);
      });
      if (created) {
        order.supplierDbId = created.id;
        order.supplierData = created;
        order.supplierName = created.name;
        order.address = created.name;
        order.lat = created.lat;
        order.lng = created.lon;
        order.formattedAddress = created.address || (created.lat + ', ' + created.lon);
        order.geocoded = true;
        order.error = null;
      }
      _fitBoundsNext = true;
      renderAll();
      showToast('Поставщик добавлен на карту');
    };

    // Open the supplier modal with pre-filled data
    window.SupplierModal.open(null); // null = new supplier mode

    // Pre-fill fields after modal opens
    setTimeout(function () {
      var nameInput = document.getElementById('supplierName');
      var addrInput = document.getElementById('supplierAddress');
      var latInput = document.getElementById('supplierLat');
      var lonInput = document.getElementById('supplierLon');
      if (nameInput) nameInput.value = prefill.name;
      if (addrInput) addrInput.value = prefill.address;
      if (latInput && prefill.lat) latInput.value = prefill.lat;
      if (lonInput && prefill.lon) lonInput.value = prefill.lon;
    }, 50);
  }

  function distribute() {
    const geocodedCount = orders.filter(function (o) { return o.geocoded; }).length;
    if (geocodedCount === 0) { showToast('Нет геокодированных адресов', 'error'); return; }
    driverCount = parseInt($('#dcDriverCount').value) || 3;

    // Collect drivers from existing direct assignments (suppliers) to preserve in slots
    var preAssigned = {};
    orders.forEach(function (o) {
      if (o.assignedDriverId) preAssigned[o.assignedDriverId] = true;
    });

    // Build driverSlots: first fill with pre-assigned drivers, then nulls
    driverSlots = [];
    Object.keys(preAssigned).forEach(function (did) {
      if (driverSlots.length < driverCount) driverSlots.push(did);
    });
    while (driverSlots.length < driverCount) driverSlots.push(null);

    variants = window.DistributionAlgo.generateVariants(orders, driverCount);
    activeVariant = 0;
    assignments = variants[0].assignments.slice();

    // Clear direct assignments — algorithm takes over, user can re-assign manually after
    orders.forEach(function (o) { o.assignedDriverId = null; });

    selectedDriver = null;
    _fitBoundsNext = true;
    renderAll();
    showToast('Создано ' + variants.length + ' вариантов');
  }

  function selectVariant(idx) {
    activeVariant = idx;
    assignments = variants[idx].assignments.slice();
    selectedDriver = null;
    renderAll();
  }

  function retryGeocode(orderId) {
    const input = $('#dcEditInput-' + orderId.replace(/[^a-zA-Z0-9\-]/g, ''));
    if (!input) return;
    const addr = input.value.trim();
    if (!addr) return;

    input.disabled = true;
    window.DistributionGeocoder.geocodeAddress(addr).then(function (geo) {
      orders = orders.map(function (o) {
        if (o.id !== orderId) return o;
        return Object.assign({}, o, { address: addr, lat: geo.lat, lng: geo.lng, formattedAddress: geo.formattedAddress, geocoded: true, error: null, settlementOnly: geo.settlementOnly || false });
      });
      editingOrderId = null;
      renderAll();
      if (geo.settlementOnly) {
        showToast('Найден только населённый пункт — уточните на карте');
      } else {
        showToast('Адрес найден');
      }
    }).catch(function () {
      showToast('Не найден: ' + addr, 'error');
      input.disabled = false;
    });
  }

  function clearAll() {
    showClearDialog();
  }

  function showClearDialog() {
    var existing = document.getElementById('dcClearModal');
    if (existing) existing.remove();

    var modal = document.createElement('div');
    modal.id = 'dcClearModal';
    modal.className = 'modal is-open';
    modal.style.cssText = 'z-index:10000;';
    modal.innerHTML = '<div class="modal-content" style="max-width:360px;text-align:center;">' +
      '<h3 class="modal-title" style="margin-bottom:16px;">Что сбросить?</h3>' +
      '<div style="display:flex;flex-direction:column;gap:8px;">' +
      '<button class="btn btn-outline dc-clear-opt" data-type="suppliers" style="color:#10b981;border-color:#10b981;">🏢 Поставщики</button>' +
      '<button class="btn btn-outline dc-clear-opt" data-type="addresses" style="color:#3b82f6;border-color:#3b82f6;">🏠 Адреса доставки</button>' +
      '<button class="btn btn-outline dc-clear-opt" data-type="all" style="color:var(--danger);border-color:var(--danger);">Сбросить всё</button>' +
      '<button class="btn btn-outline dc-clear-opt" data-type="cancel" style="margin-top:4px;">Отмена</button>' +
      '</div></div>';

    document.body.appendChild(modal);

    modal.querySelectorAll('.dc-clear-opt').forEach(function (btn) {
      btn.addEventListener('click', function () {
        modal.remove();
        var type = btn.dataset.type;
        if (type === 'cancel') return;
        doClear(type);
      });
    });
  }

  function doClear(type) {
    if (type === 'suppliers') {
      var keep = []; var keepA = [];
      for (var i = 0; i < orders.length; i++) {
        if (!orders[i].isSupplier) {
          keep.push(orders[i]);
          if (assignments) keepA.push(assignments[i]);
        }
      }
      orders = keep;
      assignments = keepA.length > 0 ? keepA : null;
      variants = []; activeVariant = -1;
      showToast('Поставщики сброшены');
    } else if (type === 'addresses') {
      var keep2 = []; var keepA2 = [];
      for (var j = 0; j < orders.length; j++) {
        if (orders[j].isSupplier) {
          keep2.push(orders[j]);
          if (assignments) keepA2.push(assignments[j]);
        }
      }
      orders = keep2;
      assignments = keepA2.length > 0 ? keepA2 : null;
      variants = []; activeVariant = -1;
      showToast('Адреса доставки сброшены');
    } else {
      orders = []; assignments = null; variants = []; activeVariant = -1; selectedDriver = null;
      driverSlots = [];
      clearState();
      showToast('Все данные сброшены');
    }
    _fitBoundsNext = true;
    renderAll();
  }

  // ─── Finish distribution (publish routes) ──────────────────
  async function finishDistribution() {
    // Build routes per driver
    const routeDate = new Date().toISOString().split('T')[0];
    const routesByDriver = {};

    orders.forEach(function (order, idx) {
      if (!order.geocoded) return;
      var driverId = getOrderDriverId(idx);
      if (!driverId) return;

      if (!routesByDriver[driverId]) {
        routesByDriver[driverId] = [];
      }

      var pointData = {
        address: order.address,
        lat: order.lat,
        lng: order.lng,
        phone: order.phone || null,
        timeSlot: order.timeSlot || null,
        formattedAddress: order.formattedAddress || null,
        orderNum: routesByDriver[driverId].length + 1,
      };

      // Supplier flag
      if (order.isSupplier) {
        pointData.isSupplier = true;
      }

      // POI flag
      if (order.isPoi) {
        pointData.isPoi = true;
        pointData.poiLabel = order.poiLabel || null;
      }

      // KBT: add info for main driver
      if (order.isKbt) {
        pointData.isKbt = true;
        if (order.helperDriverSlot != null) {
          var helperId = driverSlots[order.helperDriverSlot];
          var helperDriver = helperId ? dbDrivers.find(function (d) { return d.id === helperId; }) : null;
          pointData.helperDriverName = helperDriver ? helperDriver.name : getDriverName(order.helperDriverSlot);
          pointData.helperDriverId = helperId || null;
        }
      }

      routesByDriver[driverId].push(pointData);

      // KBT: also add this point to the helper driver's route
      if (order.isKbt && order.helperDriverSlot != null) {
        var helperDriverId = driverSlots[order.helperDriverSlot];
        if (helperDriverId && helperDriverId !== driverId) {
          if (!routesByDriver[helperDriverId]) {
            routesByDriver[helperDriverId] = [];
          }
          var mainDriver = dbDrivers.find(function (d) { return d.id === driverId; });
          routesByDriver[helperDriverId].push({
            address: order.address,
            lat: order.lat,
            lng: order.lng,
            phone: order.phone || null,
            timeSlot: order.timeSlot || null,
            formattedAddress: order.formattedAddress || null,
            orderNum: routesByDriver[helperDriverId].length + 1,
            isKbt: true,
            isKbtHelper: true,
            mainDriverName: mainDriver ? mainDriver.name : getDriverName(slot),
            mainDriverId: driverId,
          });
        }
      }
    });

    const routes = Object.keys(routesByDriver).map(function (driverId) {
      return {
        driver_id: parseInt(driverId),
        route_date: routeDate,
        points: routesByDriver[driverId],
      };
    });

    if (routes.length === 0) {
      showToast('Нет точек для сохранения', 'error');
      return;
    }

    try {
      await window.VehiclesDB.saveDriverRoutes(routes);
      showToast('Маршруты опубликованы! Водители увидят их в своём разделе');
    } catch (err) {
      showToast('Ошибка сохранения: ' + err.message, 'error');
    }
  }

  // ─── Send all unsent suppliers to Telegram ─────────────
  async function sendToTelegram() {
    var botToken = window.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      showToast('Telegram бот не настроен. Укажите токен в config.js', 'error');
      return;
    }

    // Group unsent suppliers by driver
    var byDriver = {}; // { driverId: { driver, orderIndices, points } }
    var noDriver = 0, noTelegram = [];
    var routeDate = new Date().toISOString().split('T')[0];

    orders.forEach(function (order, idx) {
      if (!order.isSupplier || !order.geocoded) return;
      if (order.telegramSent) return; // Skip already sent
      var drvId = getOrderDriverId(idx);
      if (!drvId) { noDriver++; return; }
      if (!byDriver[drvId]) {
        var drv = dbDrivers.find(function (d) { return d.id === drvId; });
        byDriver[drvId] = { driver: drv, orderIndices: [], points: [] };
      }
      byDriver[drvId].orderIndices.push(idx);
      byDriver[drvId].points.push({
        address: order.address,
        formattedAddress: order.formattedAddress || null,
        phone: order.phone || null,
        timeSlot: order.timeSlot || null,
        orderNum: byDriver[drvId].points.length + 1,
        isSupplier: true,
        lat: order.lat || null,
        lng: order.lng || null,
      });
    });

    var driverIds = Object.keys(byDriver);
    if (driverIds.length === 0) {
      showToast(noDriver > 0 ? 'Назначьте водителей поставщикам' : 'Нет неотправленных поставщиков', 'error');
      return;
    }

    var messagesSent = 0, messagesFailed = 0;
    for (var i = 0; i < driverIds.length; i++) {
      var entry = byDriver[driverIds[i]];
      var driver = entry.driver;
      if (!driver) { messagesFailed++; continue; }
      if (!driver.telegram_chat_id) { noTelegram.push(driver.name); continue; }
      if (driver.telegram_chat_id < 0) { noTelegram.push(driver.name + ' (групповой ID!)'); continue; }

      var msg = formatTelegramMessage(driver.name, routeDate, entry.points);
      try {
        var resp = await fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: driver.telegram_chat_id, text: msg, parse_mode: 'HTML' }),
        });
        var data = await resp.json();
        if (data.ok) {
          messagesSent++;
          // Mark all these orders as sent
          entry.orderIndices.forEach(function (oi) { orders[oi].telegramSent = true; });
        } else {
          messagesFailed++;
          console.warn('Telegram error for', driver.name, ':', data.description);
        }
      } catch (err) {
        messagesFailed++;
        console.error('Telegram send error:', err);
      }
    }

    var result = 'Telegram: отправлено ' + messagesSent;
    if (messagesFailed > 0) result += ', ошибок: ' + messagesFailed;
    if (noTelegram.length > 0) result += '\nНет Telegram ID: ' + noTelegram.join(', ');
    if (noDriver > 0) result += '\nБез водителя: ' + noDriver;
    showToast(result, messagesFailed > 0 || noTelegram.length > 0 ? 'error' : undefined);
    renderAll();
  }

  // ─── Send single supplier to Telegram ──────────────────
  async function sendOneToTelegram(orderId) {
    var botToken = window.TELEGRAM_BOT_TOKEN;
    if (!botToken) { showToast('Telegram бот не настроен', 'error'); return; }

    var orderIdx = orders.findIndex(function (o) { return o.id === orderId; });
    if (orderIdx < 0) return;
    var order = orders[orderIdx];
    if (!order.isSupplier || !order.geocoded) { showToast('Поставщик не найден на карте', 'error'); return; }

    var driverId = getOrderDriverId(orderIdx);
    if (!driverId) { showToast('Сначала назначьте водителя', 'error'); return; }

    var driver = dbDrivers.find(function (d) { return d.id === driverId; });
    if (!driver) { showToast('Водитель не найден', 'error'); return; }
    if (!driver.telegram_chat_id) { showToast('У водителя ' + driver.name + ' не указан Telegram', 'error'); return; }
    if (driver.telegram_chat_id < 0) { showToast('У водителя ' + driver.name + ' указан ID группы, нужен личный. Перепривяжите Telegram.', 'error'); return; }

    var routeDate = new Date().toISOString().split('T')[0];
    var points = [{
      address: order.address,
      formattedAddress: order.formattedAddress || null,
      phone: order.phone || null,
      timeSlot: order.timeSlot || null,
      orderNum: 1,
      isSupplier: true,
      lat: order.lat || null,
      lng: order.lng || null,
    }];
    var msg = formatTelegramMessage(driver.name, routeDate, points);

    try {
      var resp = await fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: driver.telegram_chat_id, text: msg, parse_mode: 'HTML' }),
      });
      var data = await resp.json();
      if (data.ok) {
        order.telegramSent = true;
        showToast('Отправлено в Telegram: ' + order.address);
        renderAll();
      } else {
        showToast('Ошибка Telegram: ' + (data.description || '?'), 'error');
      }
    } catch (err) {
      showToast('Ошибка отправки: ' + err.message, 'error');
    }
  }

  // ─── Cancel supplier — send cancellation to driver, unassign ──
  async function cancelOneFromTelegram(orderId) {
    var botToken = window.TELEGRAM_BOT_TOKEN;

    var orderIdx = orders.findIndex(function (o) { return o.id === orderId; });
    if (orderIdx < 0) return;
    var order = orders[orderIdx];
    if (!order.isSupplier) return;

    // Get the driver this was sent to
    var driverId = getOrderDriverId(orderIdx);
    var driver = driverId ? dbDrivers.find(function (d) { return d.id === driverId; }) : null;

    // Send cancellation message if driver has telegram
    if (botToken && driver && driver.telegram_chat_id && driver.telegram_chat_id > 0 && order.telegramSent) {
      var cancelMsg = '❌ <b>ОТМЕНА</b>\n\n' +
        '🏢 <b>' + escapeHtml(order.address) + '</b>' +
        (order.timeSlot ? ' ⏰ ' + order.timeSlot : '') +
        '\n\nЭтот поставщик снят с вашего маршрута.';

      try {
        var resp = await fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: driver.telegram_chat_id, text: cancelMsg, parse_mode: 'HTML' }),
        });
        var data = await resp.json();
        if (data.ok) {
          showToast('Отмена отправлена: ' + order.address + ' → ' + driver.name);
        } else {
          showToast('Ошибка отправки отмены: ' + (data.description || '?'), 'error');
        }
      } catch (err) {
        showToast('Ошибка: ' + err.message, 'error');
      }
    }

    // Reset state: unassign driver, clear sent flag
    order.telegramSent = false;
    order.assignedDriverId = null;
    if (assignments && assignments[orderIdx] >= 0) {
      assignments[orderIdx] = -1;
    }
    renderAll();
  }

  function formatTelegramMessage(driverName, routeDate, points) {
    var msg = '';
    points.forEach(function (p, i) {
      msg += (points.length > 1 ? (i + 1) + '. ' : '') + '<b>' + escapeHtml(p.address) + '</b>';
      if (p.timeSlot) msg += ' ⏰ ' + p.timeSlot;
      if (p.lat && p.lng) {
        msg += '\n🗺 <a href="https://yandex.ru/maps/?pt=' + p.lng + ',' + p.lat + '&z=17&l=map">Карта</a>';
      }
      msg += '\n';
    });
    return msg.trim();
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }


  // ─── Render ───────────────────────────────────────────────
  function renderAll() {
    renderSidebar();
    try {
      if (mapInstance && window.ymaps) {
        updatePlacemarks();
      } else {
        initMap().then(function () {
          try { updatePlacemarks(); } catch (e) { console.error('updatePlacemarks after init:', e); }
        });
      }
    } catch (e) { console.error('renderAll map error:', e); }
    saveState();
    var mapContainer = $('#distributionMap');
    if (mapContainer) mapContainer.style.cursor = placingOrderId ? 'crosshair' : '';
  }

  function renderOrderItem(order, idx) {
    const driverId = getOrderDriverId(idx);
    const slotIdx = getOrderSlotIdx(idx);
    const color = slotIdx >= 0 ? COLORS[slotIdx % COLORS.length] : '#ccc';
    const isFailed = !order.geocoded && order.error;
    const isSettlementOnly = order.geocoded && order.settlementOnly;
    const isEditing = editingOrderId === order.id;
    const isPlacing = placingOrderId === order.id;
    const safeId = order.id.replace(/[^a-zA-Z0-9\-]/g, '');

    let itemClass = 'dc-order-item';
    if (isFailed) itemClass += ' failed';
    if (isSettlementOnly) itemClass += ' settlement-only';
    if (isPlacing) itemClass += ' placing';

    var hasSlot = slotIdx >= 0;
    var sentStyle = (order.isSupplier && order.telegramSent) ? 'opacity:0.45;' : '';
    var html = '<div class="' + itemClass + '" data-order-id="' + order.id + '" style="' + sentStyle + (hasSlot ? 'border-left-color:' + color : '') + '">';
    var numBg;
    if (order.isPoi) {
      numBg = 'background:' + (hasSlot ? color : (order.poiColor || '#3b82f6')) + ';color:#111;border-radius:4px;font-weight:800;text-shadow:0 0 2px rgba(255,255,255,.8);';
    } else if (order.isSupplier) {
      numBg = hasSlot ? 'background:' + color + ';color:#fff' : (isFailed ? 'background:#ef4444;color:#fff' : 'background:#10b981;color:#fff');
    } else {
      numBg = hasSlot ? 'background:' + color + ';color:#fff' : (isFailed ? 'background:#ef4444;color:#fff' : (isSettlementOnly ? 'background:#f59e0b;color:#fff' : 'background:#e0e0e0;color:#333;border:1px solid #999'));
    }
    var numLabel = order.isPoi ? (order.poiShort || 'П') : (order.isSupplier ? 'П' : (idx + 1));
    html += '<div class="dc-order-num" style="' + numBg + '">' + numLabel + '</div>';
    html += '<div class="dc-order-info"><div class="dc-order-addr">' + order.address + '</div>';
    if (order.timeSlot || order.phone) {
      html += '<div class="dc-order-meta">';
      if (order.timeSlot) html += '<span>⏰ ' + order.timeSlot + '</span> ';
      if (order.phone) html += '<span>📞 ' + order.phone + '</span>';
      html += '</div>';
    }
    if (order.formattedAddress) html += '<div class="dc-order-faddr">📍 ' + order.formattedAddress + '</div>';
    if (isSettlementOnly) {
      html += '<div class="dc-order-warn">⚠ Найден только населённый пункт — уточните точку на карте</div>';
    }
    if (order.isSupplier && order.supplierDbId) {
      html += '<div style="font-size:10px;color:#10b981;margin-top:1px;">В базе</div>';
    } else if (order.isSupplier && !order.supplierDbId) {
      html += '<div style="font-size:10px;color:#ef4444;margin-top:1px;">Не найден в базе</div>';
    }
    // Inline driver assignment — directly from DB drivers list
    var driverDisplayName = driverId ? getDriverNameById(driverId) : (hasSlot ? getDriverName(slotIdx) : null);
    html += '<div class="dc-order-driver-assign" style="margin-top:3px;">';
    if (hasSlot || driverId) {
      html += '<span class="dc-assign-label" data-idx="' + idx + '" style="color:' + color + ';cursor:pointer;font-size:12px;font-weight:600;" title="Нажмите чтобы сменить водителя">👤 ' + driverDisplayName + ' ▾</span>';
    } else if (order.geocoded) {
      html += '<span class="dc-assign-label" data-idx="' + idx + '" style="color:#999;cursor:pointer;font-size:11px;" title="Назначить водителя">+ Назначить водителя ▾</span>';
    }
    html += '</div>';
    // Telegram send indicator + cancel for suppliers
    if (order.isSupplier && order.geocoded) {
      html += '<div class="dc-tg-row" style="display:flex;align-items:center;gap:4px;margin-top:2px;">';
      if (order.telegramSent) {
        html += '<span style="font-size:11px;color:#229ED9;" title="Отправлено в Telegram">✈️ ✓</span>';
        html += '<button class="btn btn-outline btn-sm dc-tg-send-one" data-id="' + order.id + '" style="font-size:10px;padding:1px 6px;color:#229ED9;border-color:#229ED9;" title="Отправить повторно">↻</button>';
        html += '<button class="btn btn-outline btn-sm dc-tg-cancel-one" data-id="' + order.id + '" style="font-size:10px;padding:1px 6px;color:#ef4444;border-color:#ef4444;" title="Отправить отмену водителю и снять назначение">✕ Отмена</button>';
      } else if (driverId) {
        html += '<button class="btn btn-outline btn-sm dc-tg-send-one" data-id="' + order.id + '" style="font-size:10px;padding:1px 6px;color:#229ED9;border-color:#229ED9;" title="Отправить в Telegram">✈️ →</button>';
      } else {
        html += '<span style="font-size:10px;color:#ccc;" title="Сначала назначьте водителя">✈️ —</span>';
      }
      html += '</div>';
    }
    if (order.isKbt) {
      var helperName = order.helperDriverSlot != null ? getDriverName(order.helperDriverSlot) : '?';
      var helperColor = order.helperDriverSlot != null ? COLORS[order.helperDriverSlot % COLORS.length] : '#a855f7';
      html += '<div class="dc-order-kbt" style="display:flex;align-items:center;gap:4px;margin-top:2px;">';
      html += '<span style="background:#a855f7;color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:6px;">КБТ +1</span>';
      html += '<span style="font-size:11px;color:' + helperColor + ';">помощник: ' + helperName + '</span>';
      html += '</div>';
    }
    html += '</div>';

    // Actions
    if (isFailed) {
      html += '<div class="dc-order-actions">';
      html += '<button class="btn btn-outline btn-sm dc-edit-btn" data-id="' + order.id + '" title="Изменить адрес">✎</button>';
      html += '<button class="btn btn-outline btn-sm dc-place-btn" data-id="' + order.id + '" title="Поставить на карте">📍</button>';
      if (order.isSupplier && !order.supplierDbId) {
        html += '<button class="btn btn-outline btn-sm dc-create-supplier-btn" data-id="' + order.id + '" title="Создать поставщика в базе" style="color:#10b981;border-color:#10b981;font-size:10px;">+ В базу</button>';
      }
      html += '<button class="btn btn-outline btn-sm dc-del-btn" data-id="' + order.id + '" title="Удалить">✕</button>';
      html += '</div>';
    } else if (isSettlementOnly) {
      html += '<div class="dc-order-actions">';
      html += '<button class="btn btn-outline btn-sm dc-edit-btn" data-id="' + order.id + '" title="Изменить адрес">✎</button>';
      html += '<button class="btn btn-sm dc-place-btn dc-place-btn-warn" data-id="' + order.id + '" title="Уточнить точку на карте">📍 На карту</button>';
      html += '<button class="btn btn-outline btn-sm dc-del-btn" data-id="' + order.id + '" title="Удалить">✕</button>';
      html += '</div>';
    } else {
      html += '<div class="dc-order-actions">';
      html += '<span class="dc-status-ok">✓</span>';
      if (order.isSupplier && !order.supplierDbId) {
        html += '<button class="btn btn-outline btn-sm dc-create-supplier-btn" data-id="' + order.id + '" title="Создать поставщика в базе" style="color:#10b981;border-color:#10b981;font-size:10px;">+ В базу</button>';
      }
      html += '<button class="btn btn-outline btn-sm dc-place-btn" data-id="' + order.id + '" title="Переместить на карте">📍</button>';
      html += '<button class="btn btn-outline btn-sm dc-del-btn dc-del-visible" data-id="' + order.id + '" title="Удалить">✕</button>';
      html += '</div>';
    }
    html += '</div>';

    // Edit row
    if (isEditing) {
      html += '<div class="dc-edit-row"><input class="dc-edit-input" id="dcEditInput-' + safeId + '" value="' + order.address.replace(/"/g, '&quot;') + '" placeholder="Новый адрес..."><button class="btn btn-primary btn-sm dc-retry-btn" data-id="' + order.id + '">Найти</button><button class="btn btn-outline btn-sm dc-cancel-edit" data-id="' + order.id + '">✕</button></div>';
    }
    if (isPlacing) {
      html += '<div class="dc-edit-row" style="color:var(--accent);font-size:12px;">👆 Кликните на карту для установки точки <button class="btn btn-outline btn-sm dc-cancel-place">Отмена</button></div>';
    }
    return html;
  }

  function renderSidebar() {
    const sidebar = $('#dcSidebar');
    if (!sidebar) return;

    // Preserve collapsed/expanded state before re-render
    var suppDetails = sidebar.querySelector('.dc-details-suppliers');
    if (suppDetails) _supplierListOpen = suppDetails.open;
    var addrDetails = sidebar.querySelector('.dc-details-addresses');
    if (addrDetails) _addressListOpen = addrDetails.open;
    var drvDetails = sidebar.querySelector('.dc-details-drivers');
    if (drvDetails) _driversListOpen = drvDetails.open;

    const allOrders = orders.map(function (o, i) { return Object.assign({}, o, { globalIndex: i }); });
    const supplierItems = allOrders.filter(function (o) { return o.isSupplier; });
    const addressItems = allOrders.filter(function (o) { return !o.isSupplier; });

    const geocodedCount = orders.filter(function (o) { return o.geocoded; }).length;
    const failedCount = orders.filter(function (o) { return !o.geocoded && o.error; }).length;
    const settlementOnlyCount = orders.filter(function (o) { return o.geocoded && o.settlementOnly; }).length;

    // Build driver list — always show ALL db drivers
    var driverListHtml = '';
    if (dbDrivers.length > 0) {
      // Count points per driver (by driver_id)
      var driverPointCounts = {};
      dbDrivers.forEach(function (dr) { driverPointCounts[dr.id] = 0; });
      orders.forEach(function (o, i) {
        var did = getOrderDriverId(i);
        if (did && driverPointCounts[did] !== undefined) driverPointCounts[did]++;
      });
      var totalAssigned = orders.filter(function (o, i) { return getOrderDriverId(i) != null; }).length;

      driverListHtml = '<div class="dc-section"><details class="dc-list-details dc-details-drivers"' + (_driversListOpen ? ' open' : '') + '>' +
        '<summary class="dc-section-title dc-list-toggle" style="cursor:pointer;user-select:none;">Водители <span style="font-weight:400;color:#888;">(' + totalAssigned + '/' + orders.length + ' точек)</span></summary>' +
        '<div class="dc-drivers-list" style="display:flex;flex-direction:column;gap:2px;padding:4px 0;">';
      // "Show all" button
      driverListHtml += '<button class="dc-driver-filter-btn' + (selectedDriver === null ? ' active' : '') + '" data-driver-filter="all" style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:8px;border:1px solid ' + (selectedDriver === null ? 'var(--accent)' : '#333') + ';background:' + (selectedDriver === null ? 'rgba(16,185,129,0.1)' : 'transparent') + ';cursor:pointer;color:#ccc;font-size:12px;font-weight:' + (selectedDriver === null ? '700' : '400') + ';width:100%;">Все точки</button>';
      dbDrivers.forEach(function (dr, di) {
        var c = COLORS[di % COLORS.length];
        var count = driverPointCounts[dr.id] || 0;
        var isActive = selectedDriver === dr.id;
        driverListHtml += '<button class="dc-driver-filter-btn' + (isActive ? ' active' : '') + '" data-driver-filter="' + dr.id + '" data-driver-idx="' + di + '" style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:8px;border:1px solid ' + (isActive ? c : '#333') + ';background:' + (isActive ? 'rgba(255,255,255,0.05)' : 'transparent') + ';cursor:pointer;width:100%;">' +
          '<span style="width:12px;height:12px;border-radius:50%;background:' + c + ';flex-shrink:0;"></span>' +
          '<span style="flex:1;text-align:left;color:#e0e0e0;font-size:12px;font-weight:' + (isActive ? '700' : '400') + ';">' + dr.name + '</span>' +
          '<span style="color:#888;font-size:11px;">' + count + ' точ.</span>' +
          '</button>';
      });
      driverListHtml += '</div></details></div>';
    }

    // Variants
    let variantsHtml = '';
    if (variants.length > 1) {
      variantsHtml = '<div class="dc-variants">';
      variants.forEach(function (v, i) {
        variantsHtml += '<button class="dc-variant' + (i === activeVariant ? ' active' : '') + '" data-variant="' + i + '"><strong>' + v.label + '</strong><span class="dc-variant-desc">' + v.description + '</span></button>';
      });
      variantsHtml += '</div>';
    }

    // Finish button — show when any order has a driver assigned
    let finishHtml = '';
    var hasAnyDriverAssigned = orders.some(function (o, i) { return getOrderDriverId(i) != null; });
    if (hasAnyDriverAssigned) {
      // Count unsent suppliers for Telegram button label
      var unsentSupplierCount = orders.filter(function (o, i) { return o.isSupplier && o.geocoded && !o.telegramSent && getOrderDriverId(i); }).length;

      finishHtml = '<div class="dc-section dc-finish-section">' +
        '<button class="btn dc-btn-finish ready">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg> ' +
        'Завершить распределение</button>' +
        '<button class="btn dc-btn-telegram" style="background:#229ED9;color:#fff;border:none;margin-top:6px;display:flex;align-items:center;gap:6px;">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>' +
        'Поставщики → Telegram' + (unsentSupplierCount > 0 ? ' (' + unsentSupplierCount + ')' : ' ✓') + '</button>' +
        '</div>';
    }

    // ─── Supplier list (collapsible) ─────────────────────────
    var filteredSuppliers = selectedDriver !== null ? supplierItems.filter(function (o) {
      var did = getOrderDriverId(o.globalIndex);
      return selectedDriver === '__unassigned__' ? !did : did === selectedDriver;
    }) : supplierItems;
    var supplierListHtml = '';
    if (filteredSuppliers.length > 0) {
      supplierListHtml = '<div class="dc-section"><details class="dc-list-details dc-details-suppliers"' + (_supplierListOpen ? ' open' : '') + '>' +
        '<summary class="dc-section-title dc-list-toggle" style="cursor:pointer;user-select:none;">Поставщики <span style="font-weight:400;color:#888;">(' + filteredSuppliers.length + ')</span></summary>' +
        '<div class="dc-orders-list">';
      filteredSuppliers.forEach(function (order) {
        supplierListHtml += renderOrderItem(order, order.globalIndex);
      });
      supplierListHtml += '</div></details></div>';
    }

    // ─── Address list (collapsible) ──────────────────────────
    var filteredAddresses = selectedDriver !== null ? addressItems.filter(function (o) {
      var did = getOrderDriverId(o.globalIndex);
      return selectedDriver === '__unassigned__' ? !did : did === selectedDriver;
    }) : addressItems;
    var addressListHtml = '';
    if (filteredAddresses.length > 0) {
      addressListHtml = '<div class="dc-section"><details class="dc-list-details dc-details-addresses"' + (_addressListOpen ? ' open' : '') + '>' +
        '<summary class="dc-section-title dc-list-toggle" style="cursor:pointer;user-select:none;">Адреса <span style="font-weight:400;color:#888;">(' + filteredAddresses.length + ')</span></summary>' +
        '<div class="dc-orders-list">';
      filteredAddresses.forEach(function (order) {
        addressListHtml += renderOrderItem(order, order.globalIndex);
      });
      addressListHtml += '</div></details></div>';
    }

    var emptyHtml = '';
    if (orders.length === 0) {
      emptyHtml = '<div class="dc-empty">Вставьте поставщиков или адреса и нажмите «На карту»</div>';
    }

    var hasSupplierOrders = supplierItems.length > 0;
    var hasAddressOrders = addressItems.length > 0;

    sidebar.innerHTML =
      // ─── Supplier paste section ──────────────────────────
      '<div class="dc-section dc-bulk-section">' +
      '<details class="dc-bulk-details"' + (!hasSupplierOrders && !hasAddressOrders ? ' open' : '') + '>' +
      '<summary class="dc-section-title dc-bulk-toggle">Вставить список поставщиков</summary>' +
      '<div class="dc-supplier-search" style="position:relative;margin-bottom:6px;">' +
      '<input id="dcSupplierSearch" class="dc-search-input" type="text" placeholder="Поиск поставщика по базе..." autocomplete="off" style="width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:13px;" />' +
      '<div id="dcSupplierSuggest" class="dc-suggest-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;background:#1e1e2e;color:#e0e0e0;border:1px solid #444;border-top:none;border-radius:0 0 6px 6px;max-height:200px;overflow-y:auto;z-index:100;box-shadow:0 4px 12px rgba(0,0,0,.4);"></div>' +
      '</div>' +
      '<textarea id="dcSupplierInput" class="dc-textarea" placeholder="Вставьте названия поставщиков, каждый с новой строки\\nФормат: ООО «Название» до 14" ' + (isLoadingSuppliers ? 'disabled' : '') + '></textarea>' +
      '<div class="dc-buttons" style="margin-top:6px;">' +
      (!hasSupplierOrders
        ? '<button class="btn btn-primary dc-btn-load-suppliers" ' + (isLoadingSuppliers ? 'disabled' : '') + '>' + (isLoadingSuppliers ? '<span id="dcSupplierProgress">...</span>' : 'Найти') + '</button>'
        : '<button class="btn btn-primary dc-btn-append-suppliers" ' + (isLoadingSuppliers ? 'disabled' : '') + '>' + (isLoadingSuppliers ? '<span id="dcSupplierProgress">...</span>' : '+ Добавить') + '</button>'
      ) +
      '</div></details></div>' +
      // ─── Address paste section ───────────────────────────
      '<div class="dc-section dc-bulk-section">' +
      '<details class="dc-bulk-details"' + (!hasAddressOrders && !hasSupplierOrders ? ' open' : '') + '>' +
      '<summary class="dc-section-title dc-bulk-toggle">Вставить список адресов</summary>' +
      '<textarea id="dcAddressInput" class="dc-textarea" placeholder="Вставьте адреса, каждый с новой строки\\nФормат: адрес [TAB] телефон [TAB] время" ' + (isGeocoding ? 'disabled' : '') + '></textarea>' +
      '<div class="dc-buttons" style="margin-top:6px;">' +
      (!hasAddressOrders
        ? '<button class="btn btn-primary dc-btn-load" ' + (isGeocoding ? 'disabled' : '') + '>' + (isGeocoding ? '<span id="dcProgress">...</span>' : 'На карту') + '</button>'
        : '<button class="btn btn-primary dc-btn-append" ' + (isGeocoding ? 'disabled' : '') + '>' + (isGeocoding ? '<span id="dcProgress">...</span>' : '+ Добавить') + '</button><button class="btn btn-outline btn-sm dc-btn-replace" ' + (isGeocoding ? 'disabled' : '') + '>Заменить всё</button>'
      ) +
      '</div></details></div>' +
      // Info + controls
      (orders.length > 0 ? '<div class="dc-info">Всего точек: <strong>' + orders.length + '</strong> (поставщики: ' + supplierItems.length + ', адреса: ' + addressItems.length + ', найдено: ' + geocodedCount + (settlementOnlyCount > 0 ? ', <span style="color:#f59e0b;">уточнить: ' + settlementOnlyCount + '</span>' : '') + (failedCount > 0 ? ', ошибок: ' + failedCount : '') + ')</div>' : '') +
      '<div class="dc-section"><div class="dc-controls">' +
      '<div class="dc-control-group"><label>Водителей</label><input type="number" id="dcDriverCount" class="dc-count-input" min="1" max="12" value="' + driverCount + '"></div>' +
      '<div class="dc-buttons">' +
      (geocodedCount > 0 ? '<button class="btn btn-primary dc-btn-distribute" style="background:var(--accent);border-color:#0a3d31;color:#04211b;">Распределить</button>' : '') +
      (orders.length > 0 ? '<button class="btn btn-outline btn-sm dc-btn-clear" style="color:var(--danger);border-color:var(--danger);">Сбросить данные</button>' : '') +
      '</div></div></div>' +
      // POI toggles
      '<div class="dc-section dc-poi-section">' +
      '<div class="dc-section-title" style="font-size:12px;color:#888;margin-bottom:6px;">Отображение на карте</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:4px;">' +
      POI_DEFS.map(function (def) {
        var active = isPoiActive(def.id);
        return '<button class="dc-poi-toggle" data-poi="' + def.id + '" style="display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border-radius:8px;border:2px solid ' + (active ? def.color : '#ddd') + ';background:' + (active ? def.color : '#fff') + ';color:' + (active ? '#fff' : '#666') + ';cursor:pointer;font-size:11px;font-weight:600;transition:all .15s;"><span style="width:14px;height:14px;border-radius:3px;background:' + def.color + ';display:inline-block;flex-shrink:0;"></span>' + def.label + '</button>';
      }).join('') +
      '</div></div>' +
      variantsHtml +
      driverListHtml + finishHtml +
      supplierListHtml + addressListHtml + emptyHtml;

    // Bind events
    bindSidebarEvents();
  }

  function bindSidebarEvents() {
    const sidebar = $('#dcSidebar');
    if (!sidebar) return;

    // Supplier load / append
    const loadSuppliersBtn = sidebar.querySelector('.dc-btn-load-suppliers');
    if (loadSuppliersBtn) loadSuppliersBtn.addEventListener('click', function () { loadSuppliers(false); });
    const appendSuppliersBtn = sidebar.querySelector('.dc-btn-append-suppliers');
    if (appendSuppliersBtn) appendSuppliersBtn.addEventListener('click', function () { loadSuppliers(true); });

    // Supplier autocomplete search
    const searchInput = sidebar.querySelector('#dcSupplierSearch');
    const suggestBox = sidebar.querySelector('#dcSupplierSuggest');
    if (searchInput && suggestBox) {
      searchInput.addEventListener('input', function () {
        var q = searchInput.value.trim();
        if (q.length < 1) { suggestBox.style.display = 'none'; suggestBox.innerHTML = ''; return; }
        var results = searchSuppliers(q, 10);
        if (results.length === 0) {
          suggestBox.innerHTML = '<div style="padding:8px 12px;color:#888;font-size:12px;">Не найдено</div>';
          suggestBox.style.display = 'block';
          return;
        }
        suggestBox.innerHTML = results.map(function (s) {
          return '<div class="dc-suggest-item" data-name="' + escapeHtml(s.name) + '" style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #333;transition:background .1s;color:#e0e0e0;">' +
            '<div style="font-weight:600;color:#fff;">' + escapeHtml(s.name) + '</div>' +
            (s.address ? '<div style="font-size:11px;color:#aaa;">' + escapeHtml(s.address) + '</div>' : '') +
            '</div>';
        }).join('');
        suggestBox.style.display = 'block';
        // Bind click on suggest items
        suggestBox.querySelectorAll('.dc-suggest-item').forEach(function (item) {
          item.addEventListener('mouseenter', function () { item.style.background = '#2a2a3e'; });
          item.addEventListener('mouseleave', function () { item.style.background = ''; });
          item.addEventListener('click', function () {
            var supplierName = item.dataset.name;
            var textarea = sidebar.querySelector('#dcSupplierInput');
            if (textarea) {
              var existing = textarea.value.trim();
              textarea.value = (existing ? existing + '\n' : '') + supplierName;
            }
            searchInput.value = '';
            suggestBox.style.display = 'none';
            suggestBox.innerHTML = '';
            searchInput.focus();
          });
        });
      });
      // Hide suggest on blur (with delay to allow click)
      searchInput.addEventListener('blur', function () {
        setTimeout(function () { suggestBox.style.display = 'none'; }, 200);
      });
      // Show suggest on focus if there's text
      searchInput.addEventListener('focus', function () {
        if (searchInput.value.trim().length >= 1) {
          searchInput.dispatchEvent(new Event('input'));
        }
      });
    }

    // Load / Append / Replace addresses
    const loadBtn = sidebar.querySelector('.dc-btn-load');
    if (loadBtn) loadBtn.addEventListener('click', function () { loadAddresses(false); });
    const appendBtn = sidebar.querySelector('.dc-btn-append');
    if (appendBtn) appendBtn.addEventListener('click', function () { loadAddresses(true); });
    const replaceBtn = sidebar.querySelector('.dc-btn-replace');
    if (replaceBtn) replaceBtn.addEventListener('click', function () { loadAddresses(false); });
    const distBtn = sidebar.querySelector('.dc-btn-distribute');
    if (distBtn) distBtn.addEventListener('click', distribute);
    const clearBtn = sidebar.querySelector('.dc-btn-clear');
    if (clearBtn) clearBtn.addEventListener('click', clearAll);

    // Finish distribution
    const finishBtn = sidebar.querySelector('.dc-btn-finish');
    if (finishBtn) finishBtn.addEventListener('click', finishDistribution);
    const telegramBtn = sidebar.querySelector('.dc-btn-telegram');
    if (telegramBtn) telegramBtn.addEventListener('click', sendToTelegram);

    // POI toggles
    sidebar.querySelectorAll('.dc-poi-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () { togglePoi(btn.dataset.poi); });
    });

    // Driver filter buttons
    sidebar.querySelectorAll('.dc-driver-filter-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var filterId = btn.dataset.driverFilter;
        if (filterId === 'all') {
          selectedDriver = null;
        } else {
          selectedDriver = filterId;
        }
        renderAll();
      });
    });

    // Variants
    sidebar.querySelectorAll('.dc-variant').forEach(function (btn) {
      btn.addEventListener('click', function () { selectVariant(parseInt(btn.dataset.variant)); });
    });

    // Delete buttons
    sidebar.querySelectorAll('.dc-del-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const idx = orders.findIndex(function (o) { return o.id === btn.dataset.id; });
        if (idx === -1) return;
        orders.splice(idx, 1);
        if (assignments) {
          assignments.splice(idx, 1);
        }
        variants = []; activeVariant = -1;
        renderAll();
      });
    });

    // Edit buttons
    sidebar.querySelectorAll('.dc-edit-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        editingOrderId = btn.dataset.id; placingOrderId = null; renderAll();
      });
    });

    // Place on map buttons
    sidebar.querySelectorAll('.dc-place-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        placingOrderId = btn.dataset.id; editingOrderId = null; renderAll();
        showToast('Кликните на карту');
      });
    });

    // Retry geocode
    sidebar.querySelectorAll('.dc-retry-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { retryGeocode(btn.dataset.id); });
    });

    // Cancel edit / place
    sidebar.querySelectorAll('.dc-cancel-edit').forEach(function (btn) {
      btn.addEventListener('click', function () { editingOrderId = null; renderAll(); });
    });
    sidebar.querySelectorAll('.dc-cancel-place').forEach(function (btn) {
      btn.addEventListener('click', function () { placingOrderId = null; renderAll(); });
    });

    // Create supplier from order
    sidebar.querySelectorAll('.dc-create-supplier-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { createSupplierFromOrder(btn.dataset.id); });
    });

    // Enter in edit inputs
    sidebar.querySelectorAll('.dc-edit-input').forEach(function (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          const retryBtn = input.parentElement.querySelector('.dc-retry-btn');
          if (retryBtn) retryBtn.click();
        }
      });
    });

    // Inline driver assignment on sidebar items — show DB drivers directly
    sidebar.querySelectorAll('.dc-assign-label').forEach(function (label) {
      label.addEventListener('click', function (e) {
        e.stopPropagation();
        var idx = parseInt(label.dataset.idx);
        var order = orders[idx];
        if (!order) return;
        // Remove any existing dropdown
        var existing = sidebar.querySelector('.dc-inline-driver-picker');
        if (existing) existing.remove();
        // Create dropdown with actual DB drivers
        var picker = document.createElement('div');
        picker.className = 'dc-inline-driver-picker';
        picker.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;padding:6px 0;';
        var currentDriverId = getOrderDriverId(idx);
        dbDrivers.forEach(function (dr, di) {
          var c = COLORS[di % COLORS.length];
          var active = dr.id === currentDriverId;
          var displayName = dr.name.split(' ')[0];
          var btn = document.createElement('button');
          btn.style.cssText = 'display:flex;align-items:center;gap:3px;padding:3px 8px;border-radius:10px;border:2px solid ' + (active ? '#333' : 'transparent') + ';background:' + c + ';cursor:pointer;color:#fff;font-size:11px;font-weight:600;';
          btn.innerHTML = '<span style="width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,0.4);"></span>' + displayName;
          btn.title = dr.name;
          (function (driverId) {
            btn.addEventListener('click', function (ev) {
              ev.stopPropagation();
              window.__dc_assignDirect(idx, driverId);
            });
          })(dr.id);
          picker.appendChild(btn);
        });
        // Unassign button
        if (currentDriverId) {
          var unBtn = document.createElement('button');
          unBtn.style.cssText = 'display:flex;align-items:center;gap:3px;padding:3px 8px;border-radius:10px;border:1px solid #ddd;background:#f5f5f5;cursor:pointer;color:#999;font-size:11px;';
          unBtn.textContent = '✕ Снять';
          unBtn.addEventListener('click', function (ev) {
            ev.stopPropagation();
            window.__dc_assignDirect(idx, null);
          });
          picker.appendChild(unBtn);
        }
        label.parentElement.appendChild(picker);
        // Close on outside click
        setTimeout(function () {
          document.addEventListener('click', function closePicker() {
            if (picker.parentElement) picker.remove();
            document.removeEventListener('click', closePicker);
          }, { once: true });
        }, 10);
      });
    });

    // Per-row Telegram send
    sidebar.querySelectorAll('.dc-tg-send-one').forEach(function (btn) {
      btn.addEventListener('click', function () {
        sendOneToTelegram(btn.dataset.id);
      });
    });

    // Per-row Telegram cancel
    sidebar.querySelectorAll('.dc-tg-cancel-one').forEach(function (btn) {
      btn.addEventListener('click', function () {
        cancelOneFromTelegram(btn.dataset.id);
      });
    });
  }

  // ─── Init on tab switch ───────────────────────────────────
  async function onSectionActivated() {
    // Load drivers and suppliers from DB
    await Promise.all([loadDbDrivers(), loadDbSuppliers()]);
    // Restore saved data on first activation
    if (orders.length === 0) {
      loadState();
    }
    _fitBoundsNext = true;
    initMap().then(function () { updatePlacemarks(); });
    renderSidebar();
  }

  // Expose for navigation
  window.DistributionUI = {
    onSectionActivated: onSectionActivated,
  };

  // Auto-init if section is already visible
  document.addEventListener('DOMContentLoaded', function () {
    const section = document.getElementById('distributionSection');
    if (section && section.classList.contains('active')) {
      onSectionActivated();
    }
  });
})();
