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
  const ORIGINAL_COLORS = COLORS.slice();
  const STORAGE_KEY = 'dc_distribution_data';

  let orders = [];
  let assignments = null;
  let variants = [];
  let activeVariant = -1;
  let driverCount = 3;
  let selectedDriver = null;
  let editingDriverId = null; // режим редактирования маршрута водителя
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
  // Hide assigned toggle
  let _hideAssigned = false;
  let _hideConfirmed = false;
  // Custom driver colors
  let driverCustomColors = {};
  const DRIVER_COLORS_KEY = 'dc_driver_colors';
  const COLOR_PALETTE = [
    '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
    '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1',
    '#a855f7', '#84cc16', '#e11d48', '#0ea5e9', '#d946ef',
    '#10b981', '#facc15', '#f43f5e', '#2dd4bf', '#c084fc',
    '#fb923c', '#4ade80', '#38bdf8', '#a3e635', '#fbbf24',
  ];

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

  // ─── Load supplier orders (items from 1C) ─────────────────
  var _supplierOrdersCache = {};

  async function loadSupplierOrders() {
    var client = getSupabaseClient();
    if (!client) return;
    var today = new Date().toISOString().split('T')[0];
    try {
      var resp = await client
        .from('supplier_orders')
        .select('supplier_name, items')
        .eq('order_date', today);
      if (resp.error) { console.warn('supplier_orders load error:', resp.error); return; }
      _supplierOrdersCache = {};
      (resp.data || []).forEach(function (row) {
        var key = compactName(row.supplier_name);
        if (!_supplierOrdersCache[key]) _supplierOrdersCache[key] = [];
        _supplierOrdersCache[key].push(row.items);
      });
    } catch (e) {
      console.warn('Failed to load supplier orders:', e);
    }
  }

  function getSupplierItems(supplierName) {
    var key = compactName(supplierName);
    return _supplierOrdersCache[key] || [];
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

    // 2. Strict partial: only match when lengths are similar (within 30%) to avoid false positives
    var partial = dbSuppliers.find(function (s) {
      var sn = compactName(s.name);
      if (!sn) return false;
      var longer = Math.max(sn.length, n.length);
      var shorter = Math.min(sn.length, n.length);
      if (shorter / longer < 0.7) return false;
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

  // Get color index for an order's driver — always based on dbDrivers position for consistency
  function getOrderSlotIdx(idx) {
    var driverId = getOrderDriverId(idx);
    if (!driverId) return -1;
    var did = String(driverId);
    var driverIndex = dbDrivers.findIndex(function (d) { return String(d.id) === did; });
    return driverIndex >= 0 ? driverIndex : -1;
  }

  function getDriverName(slotIdx) {
    const driverId = driverSlots[slotIdx];
    if (!driverId) return 'В' + (slotIdx + 1);
    const d = dbDrivers.find(function (dr) { return dr.id === driverId; });
    return d ? d.name.split(' ')[0] : 'В' + (slotIdx + 1);
  }

  function getDriverNameById(driverId) {
    var sid = String(driverId);
    var d = dbDrivers.find(function (dr) { return String(dr.id) === sid; });
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

  // ─── Driver custom colors ─────────────────────────────────
  function loadDriverColors() {
    try {
      var raw = localStorage.getItem(DRIVER_COLORS_KEY);
      if (raw) driverCustomColors = JSON.parse(raw);
    } catch (e) { driverCustomColors = {}; }
  }

  function saveDriverColors() {
    try {
      localStorage.setItem(DRIVER_COLORS_KEY, JSON.stringify(driverCustomColors));
    } catch (e) {}
  }

  function applyCustomColors() {
    for (var i = 0; i < ORIGINAL_COLORS.length; i++) {
      COLORS[i] = ORIGINAL_COLORS[i];
    }
    dbDrivers.forEach(function (dr, idx) {
      var customColor = driverCustomColors[String(dr.id)];
      if (customColor && idx < COLORS.length) {
        COLORS[idx] = customColor;
      }
    });
  }

  function showColorPalette(anchorEl, driverId, driverIdx) {
    var existing = document.querySelector('.dc-color-palette');
    if (existing) existing.remove();

    var palette = document.createElement('div');
    palette.className = 'dc-color-palette';

    var currentColor = COLORS[driverIdx % COLORS.length];

    COLOR_PALETTE.forEach(function (color) {
      var swatch = document.createElement('div');
      swatch.className = 'dc-color-swatch';
      swatch.style.background = color;
      if (color === currentColor) swatch.classList.add('active');
      swatch.title = color;
      swatch.addEventListener('click', function (e) {
        e.stopPropagation();
        driverCustomColors[String(driverId)] = color;
        saveDriverColors();
        applyCustomColors();
        palette.remove();
        renderAll();
      });
      palette.appendChild(swatch);
    });

    // Reset button
    var resetBtn = document.createElement('div');
    resetBtn.className = 'dc-color-swatch dc-color-reset';
    resetBtn.textContent = '\u21BA';
    resetBtn.title = 'Сбросить цвет';
    resetBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      delete driverCustomColors[String(driverId)];
      saveDriverColors();
      applyCustomColors();
      palette.remove();
      renderAll();
    });
    palette.appendChild(resetBtn);

    var rect = anchorEl.getBoundingClientRect();
    palette.style.left = rect.left + 'px';
    palette.style.top = (rect.bottom + 4) + 'px';

    document.body.appendChild(palette);

    setTimeout(function () {
      document.addEventListener('click', function closePalette(e) {
        if (!palette.contains(e.target)) {
          palette.remove();
          document.removeEventListener('click', closePalette);
        }
      });
    }, 10);
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

    // Detect overlapping points and compute offsets
    var overlapKey = function (o) { return o.lat.toFixed(5) + ',' + o.lng.toFixed(5); };
    var overlapGroups = {};
    geocoded.forEach(function (o) {
      var k = overlapKey(o);
      if (!overlapGroups[k]) overlapGroups[k] = [];
      overlapGroups[k].push(o.id);
    });
    // Build offset map: orderId → [dlat, dlng]
    var overlapOffsets = {};
    var OFFSET_PX = 0.00015; // ~15m at ground level, visible at zoom 14+
    Object.keys(overlapGroups).forEach(function (k) {
      var group = overlapGroups[k];
      if (group.length < 2) return;
      var n = group.length;
      for (var i = 0; i < n; i++) {
        var angle = (2 * Math.PI * i) / n - Math.PI / 2;
        overlapOffsets[group[i]] = [
          Math.sin(angle) * OFFSET_PX,
          Math.cos(angle) * OFFSET_PX
        ];
      }
    });

    // Pre-compute display numbers for address orders (1-based, addresses only)
    var _addrNum = {};
    var _addrCounter = 1;
    orders.forEach(function (o) {
      if (!o.isSupplier && !o.isPoi) _addrNum[o.id] = _addrCounter++;
    });

    var bounds = [];
    geocoded.forEach(function (order) {
      try {
      var globalIdx = orders.indexOf(order);
      var ofs = overlapOffsets[order.id];
      var plat = ofs ? order.lat + ofs[0] : order.lat;
      var plng = ofs ? order.lng + ofs[1] : order.lng;
      var slotIdx = getOrderSlotIdx(globalIdx);
      var driverIdx = slotIdx; // for balloon color compatibility
      var orderDriverId = getOrderDriverId(globalIdx);
      // Hide assigned/confirmed suppliers when toggles are on
      if (_hideAssigned && order.isSupplier && orderDriverId) return;
      if (_hideConfirmed && order.isSupplier && order.telegramStatus === 'confirmed') return;
      var isVisible;
      if (editingDriverId) {
        isVisible = !orderDriverId || String(orderDriverId) === String(editingDriverId);
      } else {
        isVisible = selectedDriver === null || (orderDriverId != null && String(orderDriverId) === String(selectedDriver)) || (selectedDriver === '__unassigned__' && !orderDriverId);
      }
      var isSettlementOnly = order.settlementOnly;
      var isUnassigned = slotIdx < 0;
      var defaultColor = isSettlementOnly ? '#f59e0b' : '#e0e0e0';
      var color = !isUnassigned ? COLORS[slotIdx % COLORS.length] : defaultColor;

      var overlapCount = overlapGroups[overlapKey(order)] ? overlapGroups[overlapKey(order)].length : 1;
      var displayNum = order.isSupplier ? 'П' : (_addrNum[order.id] || (globalIdx + 1));
      var hintHtml = '<b>' + displayNum + '. ' + order.address + '</b>' +
        (overlapCount > 1 ? '<br><span style="color:#f97316;font-size:11px;">📌 ' + overlapCount + ' точки в одном месте</span>' : '') +
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
        pm = new ymaps.Placemark([plat, plng], {
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
        pm = new ymaps.Placemark([plat, plng], {
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
          '<span style="color:' + uaText + ';font-size:11px;font-weight:800;">' + displayNum + '</span></div>';
        var uaLayout = ymaps.templateLayoutFactory.createClass(uaHtml);
        pm = new ymaps.Placemark([plat, plng], {
          balloonContentBody: buildBalloon(order, globalIdx, driverIdx),
          hintContent: hintHtml,
        }, {
          iconLayout: uaLayout,
          iconShape: { type: 'Circle', coordinates: [14, 14], radius: 14 },
          iconOffset: [-14, -14],
        });
      } else {
        // Assigned regular order: standard circle icon with color
        pm = new ymaps.Placemark([plat, plng], {
          balloonContentBody: buildBalloon(order, globalIdx, driverIdx),
          iconContent: String(displayNum),
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
      bounds.push([plat, plng]);

      // KBT ring (circle inside circle)
      if (order.isKbt && isVisible) {
        var ringHtml = '<div style="width:44px;height:44px;border-radius:50%;background:' + color + ';opacity:0.3;pointer-events:none;"></div>';
        var ringLayout = ymaps.templateLayoutFactory.createClass(ringHtml);
        var ring = new ymaps.Placemark([plat, plng], {}, {
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
    var oldDriverId = getOrderDriverId(globalIdx);
    // Normalize driverId type to match dbDrivers (balloon passes string, sidebar passes original type)
    if (driverId != null && dbDrivers.length > 0) {
      var match = dbDrivers.find(function (d) { return String(d.id) === String(driverId); });
      driverId = match ? match.id : driverId;
    }
    order.assignedDriverId = driverId || null;
    // Also clear algorithm assignment when unassigning
    if (!driverId && assignments && assignments[globalIdx] >= 0) {
      assignments = assignments.slice();
      assignments[globalIdx] = -1;
    }
    activeVariant = -1;
    renderAll();

    // Auto-sync affected drivers to cabinet DB
    if (driverId) scheduleSyncDriver(String(driverId));
    if (oldDriverId && String(oldDriverId) !== String(driverId)) scheduleSyncDriver(String(oldDriverId));
  };

  // Debounced auto-sync: batches rapid assignments into one DB call per driver
  var _syncTimers = {};
  function scheduleSyncDriver(driverId) {
    if (_syncTimers[driverId]) clearTimeout(_syncTimers[driverId]);
    _syncTimers[driverId] = setTimeout(function () {
      delete _syncTimers[driverId];
      syncDriverToDb(driverId);
    }, 1500);
  }

  async function syncDriverToDb(driverId) {
    var routeDate = new Date().toISOString().split('T')[0];
    var points = [];
    orders.forEach(function (order, idx) {
      if (!order.geocoded) return;
      var did = getOrderDriverId(idx);
      if (!did || String(did) !== String(driverId)) return;
      var pt = {
        address: order.address,
        lat: order.lat,
        lng: order.lng,
        phone: order.phone || null,
        timeSlot: order.timeSlot || null,
        formattedAddress: order.formattedAddress || null,
        orderNum: points.length + 1,
      };
      if (order.isSupplier) pt.isSupplier = true;
      if (order.isPoi) { pt.isPoi = true; pt.poiLabel = order.poiLabel || null; }
      if (order.isKbt) {
        pt.isKbt = true;
        if (order.helperDriverSlot != null) {
          var helperDrv = dbDrivers[order.helperDriverSlot];
          pt.helperDriverName = helperDrv ? helperDrv.name : '?';
          pt.helperDriverId = helperDrv ? helperDrv.id : null;
        }
      }
      points.push(pt);
    });

    try {
      if (points.length > 0) {
        await window.VehiclesDB.syncDriverRoute(parseInt(driverId), routeDate, points);
      } else {
        // No points left — clear the active route from DB
        await window.VehiclesDB.clearActiveRoute(parseInt(driverId), routeDate);
      }
    } catch (err) {
      console.error('Auto-sync error for driver ' + driverId + ':', err);
    }
  }

  window.__dc_delete = function (orderId) {
    var idx = orders.findIndex(function (o) { return o.id === orderId; });
    if (idx === -1) return;
    var affectedDriverId = getOrderDriverId(idx);
    orders.splice(idx, 1);
    if (assignments) { assignments.splice(idx, 1); }
    variants = []; activeVariant = -1;
    renderAll();
    showToast('Точка удалена');
    if (affectedDriverId) scheduleSyncDriver(String(affectedDriverId));
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
    await loadSupplierOrders();

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

      var items1c = getSupplierItems(name);
      if (!items1c.length && supplier) items1c = getSupplierItems(supplier.name);

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
          items1c: items1c.length > 0 ? items1c.join('\n') : null,
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
          items1c: items1c.length > 0 ? items1c.join('\n') : null,
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
          items1c: items1c.length > 0 ? items1c.join('\n') : null,
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

  // ─── Search & link supplier from DB (modal) ────────────────
  var _supplierSearchOrderId = null;

  function openSupplierSearch(orderId) {
    closeSupplierSearch();
    var order = orders.find(function (o) { return o.id === orderId; });
    if (!order || !order.isSupplier) return;
    _supplierSearchOrderId = orderId;

    var overlay = document.createElement('div');
    overlay.id = 'dcSupplierSearchModal';
    overlay.className = 'dc-search-modal-overlay';

    var modal = document.createElement('div');
    modal.className = 'dc-search-modal';

    var header = document.createElement('div');
    header.className = 'dc-search-modal-header';
    header.innerHTML = '<h3>Поиск поставщика</h3>' +
      '<button class="dc-search-modal-close" title="Закрыть">&times;</button>';

    var searchName = order.supplierName || stripOrgForm(order.address) || '';
    var body = document.createElement('div');
    body.className = 'dc-search-modal-body';
    body.innerHTML =
      '<div class="dc-search-modal-query">Ищем: <strong>' + escapeHtml(order.address) + '</strong></div>' +
      '<input class="dc-search-modal-input" type="text" placeholder="Введите название поставщика..." value="' + escapeHtml(searchName).replace(/"/g, '&quot;') + '" />' +
      '<div class="dc-search-modal-results"></div>';

    modal.appendChild(header);
    modal.appendChild(body);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    var input = body.querySelector('.dc-search-modal-input');
    var resultsEl = body.querySelector('.dc-search-modal-results');

    function doSearch() {
      var q = input.value.trim();
      if (q.length < 1) {
        resultsEl.innerHTML = '<div class="dc-search-modal-hint">Начните вводить название</div>';
        return;
      }
      var matches = searchSuppliers(q, 15);
      if (matches.length === 0) {
        resultsEl.innerHTML = '<div class="dc-search-modal-hint">Ничего не найдено по запросу &laquo;' + escapeHtml(q) + '&raquo;</div>';
        return;
      }
      resultsEl.innerHTML = '';
      matches.forEach(function (s) {
        var item = document.createElement('div');
        item.className = 'dc-search-modal-item';
        var hasCoords = s.lat && s.lon;
        item.innerHTML =
          '<div class="dc-search-modal-item-name">' + escapeHtml(s.name) + '</div>' +
          (s.address ? '<div class="dc-search-modal-item-addr">' + escapeHtml(s.address) + '</div>' : '') +
          '<div class="dc-search-modal-item-status">' + (hasCoords ? '📍 Есть координаты' : '⚠ Нет координат') + '</div>';
        item.addEventListener('click', function () {
          linkSupplierToOrder(orderId, s);
        });
        resultsEl.appendChild(item);
      });
    }

    input.addEventListener('input', doSearch);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeSupplierSearch();
    });

    header.querySelector('.dc-search-modal-close').addEventListener('click', closeSupplierSearch);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeSupplierSearch();
    });

    setTimeout(function () { input.focus(); input.select(); }, 50);
    doSearch();
  }

  function closeSupplierSearch() {
    var el = document.getElementById('dcSupplierSearchModal');
    if (el) el.remove();
    _supplierSearchOrderId = null;
  }

  function linkSupplierToOrder(orderId, supplier) {
    var order = orders.find(function (o) { return o.id === orderId; });
    if (!order) return;

    order.supplierDbId = supplier.id;
    order.supplierData = supplier;
    order.supplierName = supplier.name;
    order.address = supplier.name;
    if (supplier.lat && supplier.lon) {
      order.lat = supplier.lat;
      order.lng = supplier.lon;
      order.formattedAddress = supplier.address || (supplier.lat + ', ' + supplier.lon);
      order.geocoded = true;
      order.error = null;
    }

    closeSupplierSearch();
    _fitBoundsNext = true;
    saveState();
    renderAll();
    showToast('Поставщик привязан: ' + supplier.name);

    // Sync to DB if driver assigned
    var orderIdx = orders.findIndex(function (o) { return o.id === orderId; });
    if (orderIdx >= 0) {
      var driverId = getOrderDriverId(orderIdx);
      if (driverId) scheduleSyncDriver(String(driverId));
    }
  }

  function showDistributeDialog() {
    var geocodedCount = orders.filter(function (o) { return o.geocoded; }).length;
    if (geocodedCount === 0) { showToast('Нет геокодированных адресов', 'error'); return; }

    if (dbDrivers.length === 0) {
      distribute(null);
      return;
    }

    var existing = document.getElementById('dcDistributeModal');
    if (existing) existing.remove();

    var modal = document.createElement('div');
    modal.id = 'dcDistributeModal';
    modal.className = 'modal is-open';
    modal.style.cssText = 'z-index:10000;';

    var driverCheckboxes = '';
    dbDrivers.forEach(function (dr, di) {
      var c = COLORS[di % COLORS.length];
      driverCheckboxes += '<label style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:8px;border:1px solid #444;cursor:pointer;width:100%;">' +
        '<input type="checkbox" class="dc-dist-driver-cb" data-driver-id="' + dr.id + '" checked style="accent-color:' + c + ';width:16px;height:16px;">' +
        '<span style="width:12px;height:12px;border-radius:50%;background:' + c + ';flex-shrink:0;"></span>' +
        '<span style="flex:1;color:#e0e0e0;font-size:13px;">' + escapeHtml(dr.name) + '</span>' +
        '</label>';
    });

    modal.innerHTML = '<div class="modal-content" style="max-width:400px;">' +
      '<h3 class="modal-title" style="margin-bottom:16px;text-align:center;">Распределить маршрут</h3>' +
      '<div style="font-size:12px;color:#888;margin-bottom:8px;">Выберите водителей для распределения:</div>' +
      '<div style="display:flex;flex-direction:column;gap:6px;max-height:300px;overflow-y:auto;">' +
      driverCheckboxes +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:12px;">' +
      '<button class="btn btn-primary dc-dist-run" style="flex:1;">Распределить</button>' +
      '<button class="btn btn-outline dc-dist-cancel" style="flex:1;">Отмена</button>' +
      '</div></div>';

    document.body.appendChild(modal);

    modal.querySelector('.dc-dist-cancel').addEventListener('click', function () { modal.remove(); });
    modal.querySelector('.dc-dist-run').addEventListener('click', function () {
      var selectedIds = [];
      modal.querySelectorAll('.dc-dist-driver-cb:checked').forEach(function (cb) {
        selectedIds.push(cb.dataset.driverId);
      });
      modal.remove();
      if (selectedIds.length === 0) {
        showToast('Выберите хотя бы одного водителя', 'error');
        return;
      }
      distribute(selectedIds);
    });
  }

  function distribute(selectedDriverIds) {
    const geocodedCount = orders.filter(function (o) { return o.geocoded; }).length;
    if (geocodedCount === 0) { showToast('Нет геокодированных адресов', 'error'); return; }

    if (selectedDriverIds && selectedDriverIds.length > 0) {
      driverCount = selectedDriverIds.length;
      driverSlots = selectedDriverIds.slice();
    } else {
      driverCount = parseInt($('#dcDriverCount').value) || 3;
      var preAssigned = {};
      orders.forEach(function (o) {
        if (o.assignedDriverId) preAssigned[o.assignedDriverId] = true;
      });
      driverSlots = [];
      Object.keys(preAssigned).forEach(function (did) {
        if (driverSlots.length < driverCount) driverSlots.push(did);
      });
      while (driverSlots.length < driverCount) driverSlots.push(null);
    }

    variants = window.DistributionAlgo.generateVariants(orders, driverCount);
    activeVariant = 0;
    assignments = variants[0].assignments.slice();

    // Clear direct assignments ONLY for non-supplier orders — suppliers keep their manual assignment
    orders.forEach(function (o, idx) {
      if (!o.isSupplier) {
        o.assignedDriverId = null;
      } else {
        // Supplier stays with its manual assignment; mark in assignments as -1 so algorithm doesn't override
        assignments[idx] = -1;
      }
    });

    selectedDriver = null;
    _fitBoundsNext = true;
    renderAll();
    showToast('Распределено на ' + driverCount + ' водител' + (driverCount === 1 ? 'я' : 'ей'));

    // Auto-sync all affected drivers to cabinet DB (distributed + supplier drivers)
    var syncedDriverIds = {};
    driverSlots.forEach(function (did) {
      if (did && !syncedDriverIds[did]) {
        syncedDriverIds[did] = true;
        scheduleSyncDriver(String(did));
      }
    });
    // Also sync drivers that have suppliers assigned
    orders.forEach(function (o) {
      if (o.isSupplier && o.assignedDriverId && !syncedDriverIds[o.assignedDriverId]) {
        syncedDriverIds[o.assignedDriverId] = true;
        scheduleSyncDriver(String(o.assignedDriverId));
      }
    });
  }

  function selectVariant(idx) {
    activeVariant = idx;
    assignments = variants[idx].assignments.slice();
    selectedDriver = null;
    renderAll();
  }

  async function retryGeocode(orderId) {
    const input = $('#dcEditInput-' + orderId.replace(/[^a-zA-Z0-9\-]/g, ''));
    if (!input) return;
    const addr = input.value.trim();
    if (!addr) return;

    var order = orders.find(function (o) { return o.id === orderId; });

    // Check if input is GPS coordinates (e.g. "53.938485, 27.563798" or "53.938485 27.563798")
    var coordMatch = addr.match(/^(-?\d+[\.,]\d+)[,;\s]+(-?\d+[\.,]\d+)$/);
    if (coordMatch) {
      var lat = parseFloat(coordMatch[1].replace(',', '.'));
      var lng = parseFloat(coordMatch[2].replace(',', '.'));
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        input.disabled = true;
        try {
          var geo = await window.DistributionGeocoder.reverseGeocode(lat, lng);
          orders = orders.map(function (o) {
            if (o.id !== orderId) return o;
            return Object.assign({}, o, {
              lat: lat,
              lng: lng,
              formattedAddress: geo.formattedAddress,
              geocoded: true,
              error: null,
              settlementOnly: false,
            });
          });
          editingOrderId = null;
          renderAll();
          showToast('Координаты: ' + geo.formattedAddress);
          // Auto-sync if assigned to a driver
          var oi = orders.findIndex(function (o) { return o.id === orderId; });
          if (oi >= 0) {
            var did = getOrderDriverId(oi);
            if (did) scheduleSyncDriver(String(did));
          }
          return;
        } catch (e) {
          showToast('Адрес по координатам не найден', 'error');
          input.disabled = false;
          return;
        }
      }
    }

    // For suppliers: search supplier DB first
    if (order && order.isSupplier) {
      input.disabled = true;
      await loadDbSuppliers(); // refresh DB data
      var supplier = findSupplierInDb(addr);
      if (supplier && supplier.lat && supplier.lon) {
        orders = orders.map(function (o) {
          if (o.id !== orderId) return o;
          return Object.assign({}, o, {
            address: supplier.name,
            lat: supplier.lat,
            lng: supplier.lon,
            formattedAddress: supplier.address || (supplier.lat + ', ' + supplier.lon),
            geocoded: true,
            error: null,
            isSupplier: true,
            supplierDbId: supplier.id,
            supplierName: supplier.name,
            supplierData: supplier,
          });
        });
        editingOrderId = null;
        renderAll();
        showToast('Поставщик найден в базе');
        return;
      } else if (supplier && (!supplier.lat || !supplier.lon)) {
        // Found in DB but no coordinates — try geocoding the DB address
        var geoAddr = supplier.address || addr;
        try {
          var geo = await window.DistributionGeocoder.geocodeAddress(geoAddr);
          orders = orders.map(function (o) {
            if (o.id !== orderId) return o;
            return Object.assign({}, o, {
              address: supplier.name,
              lat: geo.lat,
              lng: geo.lng,
              formattedAddress: geo.formattedAddress,
              geocoded: true,
              error: null,
              isSupplier: true,
              supplierDbId: supplier.id,
              supplierName: supplier.name,
              supplierData: supplier,
            });
          });
          editingOrderId = null;
          renderAll();
          showToast('Поставщик найден, адрес геокодирован');
          return;
        } catch (e) {
          orders = orders.map(function (o) {
            if (o.id !== orderId) return o;
            return Object.assign({}, o, {
              address: supplier.name,
              supplierDbId: supplier.id,
              supplierName: supplier.name,
              supplierData: supplier,
              error: 'Нет координат — поставьте точку на карте',
            });
          });
          editingOrderId = null;
          renderAll();
          showToast('Поставщик в базе, но адрес не найден — поставьте на карте', 'error');
          return;
        }
      }
      // Not found in supplier DB — try geocoding as address
      input.disabled = false;
    }

    // Regular geocode (for addresses and suppliers not found in DB)
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

    // Count orders per driver
    var driverCounts = {}; // { driverId: { suppliers: N, addresses: N } }
    var unassignedCounts = { suppliers: 0, addresses: 0 };
    orders.forEach(function (o, idx) {
      var did = getOrderDriverId(idx);
      if (!did) {
        if (o.isSupplier) unassignedCounts.suppliers++;
        else unassignedCounts.addresses++;
        return;
      }
      var key = String(did);
      if (!driverCounts[key]) driverCounts[key] = { suppliers: 0, addresses: 0 };
      if (o.isSupplier) driverCounts[key].suppliers++;
      else driverCounts[key].addresses++;
    });

    var modal = document.createElement('div');
    modal.id = 'dcClearModal';
    modal.className = 'modal is-open';
    modal.style.cssText = 'z-index:10000;';

    // Step 1: choose driver
    var driverBtns = '';
    dbDrivers.forEach(function (dr, di) {
      var c = COLORS[di % COLORS.length];
      var counts = driverCounts[String(dr.id)];
      var total = counts ? counts.suppliers + counts.addresses : 0;
      if (total === 0) return;
      var label = dr.name.split(' ')[0];
      var detail = '';
      if (counts.suppliers > 0 && counts.addresses > 0) {
        detail = counts.suppliers + ' пост. + ' + counts.addresses + ' адр.';
      } else if (counts.suppliers > 0) {
        detail = counts.suppliers + ' пост.';
      } else {
        detail = counts.addresses + ' адр.';
      }
      driverBtns += '<button class="btn btn-outline dc-clear-driver" data-driver-id="' + dr.id + '" data-driver-name="' + escapeHtml(label) + '" style="display:flex;align-items:center;gap:8px;justify-content:flex-start;width:100%;border-color:#444;">' +
        '<span style="width:12px;height:12px;border-radius:50%;background:' + c + ';flex-shrink:0;"></span>' +
        '<span style="flex:1;text-align:left;">' + escapeHtml(label) + '</span>' +
        '<span style="color:#888;font-size:11px;">' + total + ' (' + detail + ')</span>' +
        '</button>';
    });
    // Unassigned
    var unassignedTotal = unassignedCounts.suppliers + unassignedCounts.addresses;
    if (unassignedTotal > 0) {
      var unDetail = '';
      if (unassignedCounts.suppliers > 0 && unassignedCounts.addresses > 0) {
        unDetail = unassignedCounts.suppliers + ' пост. + ' + unassignedCounts.addresses + ' адр.';
      } else if (unassignedCounts.suppliers > 0) {
        unDetail = unassignedCounts.suppliers + ' пост.';
      } else {
        unDetail = unassignedCounts.addresses + ' адр.';
      }
      driverBtns += '<button class="btn btn-outline dc-clear-driver" data-driver-id="__unassigned__" data-driver-name="Нераспределённые" style="display:flex;align-items:center;gap:8px;justify-content:flex-start;width:100%;border-color:#444;">' +
        '<span style="width:12px;height:12px;border-radius:50%;background:#888;flex-shrink:0;"></span>' +
        '<span style="flex:1;text-align:left;">Нераспределённые</span>' +
        '<span style="color:#888;font-size:11px;">' + unassignedTotal + ' (' + unDetail + ')</span>' +
        '</button>';
    }

    modal.innerHTML = '<div class="modal-content" style="max-width:400px;">' +
      '<h3 class="modal-title" style="margin-bottom:16px;text-align:center;">Сбросить данные</h3>' +
      '<div class="dc-clear-step dc-clear-step1" style="display:flex;flex-direction:column;gap:6px;">' +
      '<div style="font-size:12px;color:#888;margin-bottom:4px;">Для какого водителя?</div>' +
      driverBtns +
      '<div style="border-top:1px solid #333;margin:6px 0;"></div>' +
      '<button class="btn btn-outline dc-clear-driver" data-driver-id="__all__" data-driver-name="Все" style="color:var(--danger);border-color:var(--danger);width:100%;">Все водители (' + orders.length + ' точек)</button>' +
      '<button class="btn btn-outline dc-clear-cancel" style="margin-top:4px;width:100%;">Отмена</button>' +
      '</div>' +
      '<div class="dc-clear-step dc-clear-step2" style="display:none;flex-direction:column;gap:8px;">' +
      '<div class="dc-clear-step2-title" style="font-size:13px;font-weight:600;text-align:center;margin-bottom:4px;"></div>' +
      '<div class="dc-clear-step2-btns" style="display:flex;flex-direction:column;gap:6px;"></div>' +
      '<button class="btn btn-outline dc-clear-back" style="margin-top:4px;width:100%;">\u2190 Назад</button>' +
      '</div>' +
      '</div>';

    document.body.appendChild(modal);

    // Cancel
    modal.querySelector('.dc-clear-cancel').addEventListener('click', function () { modal.remove(); });

    // Step 1 → Step 2
    modal.querySelectorAll('.dc-clear-driver').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var driverId = btn.dataset.driverId;
        var driverName = btn.dataset.driverName;
        showClearStep2(modal, driverId, driverName);
      });
    });

    // Back
    modal.querySelector('.dc-clear-back').addEventListener('click', function () {
      modal.querySelector('.dc-clear-step1').style.display = 'flex';
      modal.querySelector('.dc-clear-step2').style.display = 'none';
    });
  }

  function showClearStep2(modal, driverId, driverName) {
    modal.querySelector('.dc-clear-step1').style.display = 'none';
    var step2 = modal.querySelector('.dc-clear-step2');
    step2.style.display = 'flex';

    var titleEl = modal.querySelector('.dc-clear-step2-title');
    titleEl.textContent = driverId === '__all__' ? 'Сбросить: все водители' : 'Сбросить: ' + driverName;

    // Count what's available for this driver
    var supCount = 0, addrCount = 0;
    orders.forEach(function (o, idx) {
      var match = false;
      if (driverId === '__all__') {
        match = true;
      } else if (driverId === '__unassigned__') {
        match = !getOrderDriverId(idx);
      } else {
        var did = getOrderDriverId(idx);
        match = did != null && String(did) === String(driverId);
      }
      if (match) {
        if (o.isSupplier) supCount++;
        else addrCount++;
      }
    });

    var btnsHtml = '';
    if (supCount > 0) {
      btnsHtml += '<button class="btn btn-outline dc-clear-exec" data-clear-type="suppliers" style="color:#10b981;border-color:#10b981;width:100%;">\uD83C\uDFE2 Поставщики (' + supCount + ')</button>';
    }
    if (addrCount > 0) {
      btnsHtml += '<button class="btn btn-outline dc-clear-exec" data-clear-type="addresses" style="color:#3b82f6;border-color:#3b82f6;width:100%;">\uD83C\uDFE0 Адреса доставки (' + addrCount + ')</button>';
    }
    if (supCount > 0 && addrCount > 0) {
      btnsHtml += '<button class="btn btn-outline dc-clear-exec" data-clear-type="all" style="color:var(--danger);border-color:var(--danger);width:100%;">Всё (' + (supCount + addrCount) + ')</button>';
    }
    if (supCount === 0 && addrCount === 0) {
      btnsHtml += '<div style="text-align:center;color:#888;padding:12px;">Нет точек</div>';
    }

    modal.querySelector('.dc-clear-step2-btns').innerHTML = btnsHtml;

    // Bind exec buttons
    modal.querySelectorAll('.dc-clear-exec').forEach(function (btn) {
      btn.addEventListener('click', function () {
        modal.remove();
        doClear(btn.dataset.clearType, driverId, driverName);
      });
    });
  }

  function doClear(type, driverId, driverName) {
    var isAll = !driverId || driverId === '__all__';

    function shouldRemove(order, idx) {
      // Check if order belongs to selected driver
      if (isAll) return true;
      if (driverId === '__unassigned__') return !getOrderDriverId(idx);
      var did = getOrderDriverId(idx);
      return did != null && String(did) === String(driverId);
    }

    function filterType(order) {
      if (type === 'suppliers') return order.isSupplier;
      if (type === 'addresses') return !order.isSupplier;
      return true; // 'all'
    }

    if (isAll && type === 'all') {
      // Full reset
      orders = []; assignments = null; variants = []; activeVariant = -1; selectedDriver = null;
      driverSlots = [];
      clearState();
      showToast('Все данные сброшены');
    } else {
      var keep = []; var keepA = [];
      var removed = 0;
      for (var i = 0; i < orders.length; i++) {
        if (shouldRemove(orders[i], i) && filterType(orders[i])) {
          removed++;
        } else {
          keep.push(orders[i]);
          if (assignments) keepA.push(assignments[i]);
        }
      }
      orders = keep;
      assignments = keepA.length > 0 ? keepA : null;
      variants = []; activeVariant = -1;

      var label = type === 'suppliers' ? 'поставщиков' : (type === 'addresses' ? 'адресов' : 'точек');
      var who = isAll ? '' : (' у ' + driverName);
      showToast('Сброшено ' + removed + ' ' + label + who);

      // Sync affected driver(s) to DB
      if (!isAll && driverId !== '__unassigned__') {
        scheduleSyncDriver(String(driverId));
      } else if (isAll) {
        // Sync all drivers that still have orders
        var syncedDrivers = {};
        orders.forEach(function (o, i) {
          var did = getOrderDriverId(i);
          if (did && !syncedDrivers[did]) {
            syncedDrivers[did] = true;
            scheduleSyncDriver(String(did));
          }
        });
      }
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
          var helperDrv = dbDrivers[order.helperDriverSlot];
          pointData.helperDriverName = helperDrv ? helperDrv.name : '?';
          pointData.helperDriverId = helperDrv ? helperDrv.id : null;
        }
      }

      routesByDriver[driverId].push(pointData);

      // KBT: also add this point to the helper driver's route
      if (order.isKbt && order.helperDriverSlot != null) {
        var helperDriverId = dbDrivers[order.helperDriverSlot] ? dbDrivers[order.helperDriverSlot].id : null;
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

  // ─── Sync edited route to driver cabinet ─────────────────
  async function finishEditing() {
    var driverId = editingDriverId;
    editingDriverId = null;
    selectedDriver = null;
    if (!driverId) { renderAll(); return; }

    // Collect ALL orders for this driver (addresses + suppliers)
    var routeDate = new Date().toISOString().split('T')[0];
    var driverName = getDriverNameById(driverId);
    var points = [];

    orders.forEach(function (order, idx) {
      if (!order.geocoded) return;
      var did = getOrderDriverId(idx);
      if (!did || String(did) !== String(driverId)) return;

      var pt = {
        address: order.address,
        lat: order.lat,
        lng: order.lng,
        phone: order.phone || null,
        timeSlot: order.timeSlot || null,
        formattedAddress: order.formattedAddress || null,
        orderNum: points.length + 1,
      };
      if (order.isSupplier) pt.isSupplier = true;
      if (order.isPoi) { pt.isPoi = true; pt.poiLabel = order.poiLabel || null; }
      if (order.isKbt) {
        pt.isKbt = true;
        if (order.helperDriverSlot != null) {
          var helperDrv = dbDrivers[order.helperDriverSlot];
          pt.helperDriverName = helperDrv ? helperDrv.name : '?';
          pt.helperDriverId = helperDrv ? helperDrv.id : null;
        }
      }
      points.push(pt);
    });

    renderAll();

    if (points.length === 0) return;

    try {
      await window.VehiclesDB.syncDriverRoute(parseInt(driverId), routeDate, points);
      showToast('Маршрут ' + driverName + ' обновлён');
    } catch (err) {
      showToast('Ошибка синхронизации: ' + err.message, 'error');
    }
  }

  // ─── Finish route per driver (multi-trip) ────────────────
  function showFinishRouteDialog() {
    var existing = document.getElementById('dcFinishRouteModal');
    if (existing) existing.remove();

    // Count address orders (not suppliers, not POI) per driver
    var driverAddrCounts = {};
    orders.forEach(function (o, idx) {
      if (o.isSupplier || o.isPoi || !o.geocoded) return;
      var did = getOrderDriverId(idx);
      if (!did) return;
      var key = String(did);
      if (!driverAddrCounts[key]) driverAddrCounts[key] = 0;
      driverAddrCounts[key]++;
    });

    var modal = document.createElement('div');
    modal.id = 'dcFinishRouteModal';
    modal.className = 'modal is-open';
    modal.style.cssText = 'z-index:10000;';

    var driverBtns = '';
    dbDrivers.forEach(function (dr, di) {
      var count = driverAddrCounts[String(dr.id)] || 0;
      if (count === 0) return;
      var c = COLORS[di % COLORS.length];
      var label = dr.name.split(' ')[0];
      driverBtns += '<button class="btn btn-outline dc-finish-route-driver" data-driver-id="' + dr.id + '" style="display:flex;align-items:center;gap:8px;justify-content:flex-start;width:100%;border-color:#444;">' +
        '<span style="width:12px;height:12px;border-radius:50%;background:' + c + ';flex-shrink:0;"></span>' +
        '<span style="flex:1;text-align:left;">' + escapeHtml(label) + '</span>' +
        '<span style="color:#888;font-size:11px;">' + count + ' адр.</span>' +
        '</button>';
    });

    if (!driverBtns) {
      showToast('Нет адресов для завершения маршрута', 'error');
      return;
    }

    var totalAddrs = 0;
    Object.keys(driverAddrCounts).forEach(function (k) { totalAddrs += driverAddrCounts[k]; });

    modal.innerHTML = '<div class="modal-content" style="max-width:400px;">' +
      '<h3 class="modal-title" style="margin-bottom:16px;text-align:center;">Завершить маршрут</h3>' +
      '<div style="font-size:12px;color:#888;margin-bottom:8px;">Адреса будут сохранены как выезд в кабинете водителя.<br>Поставщики остаются на карте.</div>' +
      '<div style="display:flex;flex-direction:column;gap:6px;">' +
      driverBtns +
      '<div style="border-top:1px solid #333;margin:4px 0;"></div>' +
      '<button class="btn btn-outline dc-finish-route-driver" data-driver-id="__all__" style="color:var(--accent);border-color:var(--accent);width:100%;">Все водители (' + totalAddrs + ' адр.)</button>' +
      '<button class="btn btn-outline dc-finish-route-cancel" style="margin-top:4px;width:100%;">Отмена</button>' +
      '</div></div>';

    document.body.appendChild(modal);

    modal.querySelector('.dc-finish-route-cancel').addEventListener('click', function () { modal.remove(); });

    modal.querySelectorAll('.dc-finish-route-driver').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        modal.remove();
        var driverId = btn.dataset.driverId;
        if (driverId === '__all__') {
          var driverIds = Object.keys(driverAddrCounts);
          for (var i = 0; i < driverIds.length; i++) {
            await finishDriverRoute(driverIds[i]);
          }
        } else {
          await finishDriverRoute(driverId);
        }
      });
    });
  }

  async function finishDriverRoute(driverId) {
    var routeDate = new Date().toISOString().split('T')[0];
    var driverName = getDriverNameById(driverId);

    // Collect ALL orders for this driver: addresses (will be removed) + suppliers (stay on map)
    var points = [];
    var orderIndicesToRemove = []; // only addresses get removed

    orders.forEach(function (order, idx) {
      if (order.isPoi || !order.geocoded) return;
      var did = getOrderDriverId(idx);
      if (!did || String(did) !== String(driverId)) return;

      var pt = {
        address: order.address,
        lat: order.lat,
        lng: order.lng,
        phone: order.phone || null,
        timeSlot: order.timeSlot || null,
        formattedAddress: order.formattedAddress || null,
        orderNum: points.length + 1,
      };

      if (order.isSupplier) {
        pt.isSupplier = true;
      }
      if (order.isKbt) {
        pt.isKbt = true;
        if (order.helperDriverSlot != null) {
          var helperDrv = dbDrivers[order.helperDriverSlot];
          pt.helperDriverName = helperDrv ? helperDrv.name : '?';
          pt.helperDriverId = helperDrv ? helperDrv.id : null;
        }
      }

      points.push(pt);

      // Only remove addresses from the map (suppliers stay for continued management)
      if (!order.isSupplier) {
        orderIndicesToRemove.push(idx);
      }
    });

    if (points.length === 0) {
      showToast('Нет точек для ' + driverName, 'error');
      return;
    }

    var addrCount = points.filter(function (p) { return !p.isSupplier; }).length;
    var supCount = points.length - addrCount;

    try {
      // First sync latest points to the active route, then mark it completed
      var savedRoute = await window.VehiclesDB.syncDriverRoute(parseInt(driverId), routeDate, points);
      if (savedRoute && savedRoute.id) {
        await window.VehiclesDB.completeDriverRoute(savedRoute.id);
      }

      // Remove finished address orders from map (suppliers stay)
      orderIndicesToRemove.sort(function (a, b) { return b - a; });
      orderIndicesToRemove.forEach(function (idx) {
        orders.splice(idx, 1);
        if (assignments) assignments.splice(idx, 1);
      });

      variants = []; activeVariant = -1;
      _fitBoundsNext = true;
      renderAll();
      var parts = [];
      if (addrCount > 0) parts.push(addrCount + ' адр.');
      if (supCount > 0) parts.push(supCount + ' пост.');
      showToast('Маршрут для ' + driverName + ' сохранён (' + parts.join(', ') + ')');
    } catch (err) {
      showToast('Ошибка: ' + err.message, 'error');
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

      // Send each supplier as individual message with confirmation buttons
      for (var si = 0; si < entry.orderIndices.length; si++) {
        var oi = entry.orderIndices[si];
        var supplierOrder = orders[oi];
        var singlePoints = [{
          address: supplierOrder.address,
          formattedAddress: supplierOrder.formattedAddress || null,
          phone: supplierOrder.phone || null,
          timeSlot: supplierOrder.timeSlot || null,
          orderNum: si + 1,
          isSupplier: true,
          lat: supplierOrder.lat || null,
          lng: supplierOrder.lng || null,
          items1c: supplierOrder.items1c || null,
        }];
        var msg = formatTelegramMessage(driver.name, routeDate, singlePoints);
        var inlineKeyboard = {
          inline_keyboard: [[
            { text: '✅ Принял', callback_data: 'accept:' + supplierOrder.id },
            { text: '❌ Отклонил', callback_data: 'reject:' + supplierOrder.id },
          ]]
        };
        try {
          var resp = await fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: driver.telegram_chat_id,
              text: msg,
              parse_mode: 'HTML',
              reply_markup: inlineKeyboard,
            }),
          });
          var data = await resp.json();
          if (data.ok) {
            messagesSent++;
            supplierOrder.telegramSent = true;
            supplierOrder.telegramStatus = 'sent';
            supplierOrder.telegramMessageId = data.result.message_id;
            supplierOrder.telegramChatId = driver.telegram_chat_id;
            saveTelegramConfirmation(supplierOrder.id, driver.telegram_chat_id, data.result.message_id, driver.name, supplierOrder.address);
          } else {
            messagesFailed++;
            console.warn('Telegram error for', driver.name, ':', data.description);
          }
        } catch (err) {
          messagesFailed++;
          console.error('Telegram send error:', err);
        }
      }
    }

    var result = 'Telegram: отправлено ' + messagesSent;
    if (messagesFailed > 0) result += ', ошибок: ' + messagesFailed;
    if (noTelegram.length > 0) result += '\nНет Telegram ID: ' + noTelegram.join(', ');
    if (noDriver > 0) result += '\nБез водителя: ' + noDriver;
    showToast(result, messagesFailed > 0 || noTelegram.length > 0 ? 'error' : undefined);
    if (messagesSent > 0) startTelegramPolling();
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
      items1c: order.items1c || null,
    }];
    var msg = formatTelegramMessage(driver.name, routeDate, points);

    // Inline keyboard: Принял / Отклонил
    var inlineKeyboard = {
      inline_keyboard: [[
        { text: '✅ Принял', callback_data: 'accept:' + order.id },
        { text: '❌ Отклонил', callback_data: 'reject:' + order.id },
      ]]
    };

    try {
      var resp = await fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: driver.telegram_chat_id,
          text: msg,
          parse_mode: 'HTML',
          reply_markup: inlineKeyboard,
        }),
      });
      var data = await resp.json();
      if (data.ok) {
        order.telegramSent = true;
        order.telegramStatus = 'sent';
        order.telegramMessageId = data.result.message_id;
        order.telegramChatId = driver.telegram_chat_id;
        // Save to Supabase for webhook tracking
        saveTelegramConfirmation(order.id, driver.telegram_chat_id, data.result.message_id, driver.name, order.address);
        showToast('Отправлено в Telegram: ' + order.address);
        startTelegramPolling();
        renderAll();
      } else {
        showToast('Ошибка Telegram: ' + (data.description || '?'), 'error');
      }
    } catch (err) {
      showToast('Ошибка отправки: ' + err.message, 'error');
    }
  }

  // ─── Telegram confirmations ──────────────────────────────
  var _tgPollTimer = null;
  var _processedCallbacks = JSON.parse(localStorage.getItem('dc_tg_processed_cbs') || '[]');
  var _webhookDeleted = false;
  var _tgUpdateOffset = parseInt(localStorage.getItem('dc_tg_update_offset') || '0', 10);

  function getSupabaseClient() {
    var config = window.SUPABASE_CONFIG || {};
    if (!config.url || !config.anonKey) return null;
    if (!window._dcSupabase) {
      window._dcSupabase = supabase.createClient(config.url, config.anonKey);
    }
    return window._dcSupabase;
  }

  // Save confirmation record to Supabase when sending (for future webhook flow)
  async function saveTelegramConfirmation(orderId, chatId, messageId, driverName, supplierName) {
    var client = getSupabaseClient();
    if (!client) return;
    try {
      await client.from('telegram_confirmations').insert({
        order_id: orderId,
        chat_id: chatId,
        message_id: messageId,
        driver_name: driverName || '',
        supplier_name: supplierName || '',
        status: 'sent',
      });
    } catch (e) { /* table may not exist yet — ok */ }
  }

  // Ensure webhook is deleted so getUpdates works
  async function ensureNoWebhook(botToken) {
    if (_webhookDeleted) return;
    try {
      var resp = await fetch('https://api.telegram.org/bot' + botToken + '/deleteWebhook?drop_pending_updates=false');
      var data = await resp.json();
      if (data.ok) {
        _webhookDeleted = true;
        console.log('Telegram webhook deleted, getUpdates enabled');
      } else {
        console.warn('deleteWebhook failed:', data.description);
      }
    } catch (e) {
      console.warn('deleteWebhook error:', e);
    }
  }

  // Check confirmations via direct Telegram getUpdates
  async function checkTelegramConfirmations(silent) {
    var botToken = window.TELEGRAM_BOT_TOKEN;
    if (!botToken) { if (!silent) showToast('Telegram бот не настроен', 'error'); return; }

    // Collect pending order IDs (sent = waiting for accept, confirmed = waiting for pickup)
    var pendingIds = [];
    orders.forEach(function (o) {
      if (o.isSupplier && o.telegramSent && (o.telegramStatus === 'sent' || o.telegramStatus === 'confirmed')) {
        pendingIds.push(o.id);
      }
    });
    if (pendingIds.length === 0) {
      if (!silent) showToast('Нет ожидающих ответов');
      return;
    }

    // Delete webhook first (one-time) so getUpdates works
    await ensureNoWebhook(botToken);

    var processed = 0;
    try {
      var getUrl = 'https://api.telegram.org/bot' + botToken + '/getUpdates?timeout=0&limit=100';
      if (_tgUpdateOffset > 0) getUrl += '&offset=' + _tgUpdateOffset;
      var tgResp = await fetch(getUrl);
      var tgData = await tgResp.json();

      if (!tgData.ok) {
        if (!silent) showToast('Telegram ошибка: ' + (tgData.description || 'unknown'), 'error');
        console.error('getUpdates error:', tgData);
        return;
      }

      var results = tgData.result || [];
      var callbackCount = 0;
      var maxUpdateId = _tgUpdateOffset;

      for (var i = 0; i < results.length; i++) {
        var update = results[i];

        // Track max update_id to advance offset
        if (update.update_id >= maxUpdateId) {
          maxUpdateId = update.update_id + 1;
        }

        if (!update.callback_query) continue;
        callbackCount++;

        var cbId = update.callback_query.id;
        if (_processedCallbacks.indexOf(cbId) !== -1) continue;

        var cbParts = (update.callback_query.data || '').split(':');
        if (cbParts.length < 2) { _processedCallbacks.push(cbId); continue; }
        var action = cbParts[0];
        var orderId = cbParts.slice(1).join(':');

        // Find matching order
        var order = orders.find(function (o) { return o.id === orderId; });
        if (order && (action === 'accept' || action === 'reject' || action === 'pickup')) {
          if (action === 'accept') order.telegramStatus = 'confirmed';
          else if (action === 'reject') order.telegramStatus = 'rejected';
          else if (action === 'pickup') order.telegramStatus = 'picked_up';
          processed++;
        }

        // Answer callback
        var answerText = action === 'accept' ? 'Принято ✅' : action === 'pickup' ? '📦 Забрал!' : 'Отклонено ❌';
        try {
          await fetch('https://api.telegram.org/bot' + botToken + '/answerCallbackQuery', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ callback_query_id: cbId, text: answerText }),
          });
        } catch (e) { /* ignore */ }

        // Update inline buttons
        if (update.callback_query.message) {
          var chatId = update.callback_query.message.chat.id;
          var msgId = update.callback_query.message.message_id;
          try {
            if (action === 'accept') {
              // Replace with "Забрал" button
              await fetch('https://api.telegram.org/bot' + botToken + '/editMessageReplyMarkup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [[{ text: '📦 Забрал', callback_data: 'pickup:' + orderId }]] } }),
              });
              await fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text: '✅ Принято\nНажмите «📦 Забрал» когда заберёте товар', reply_to_message_id: msgId }),
              });
            } else {
              // Pickup or reject: remove all buttons
              await fetch('https://api.telegram.org/bot' + botToken + '/editMessageReplyMarkup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } }),
              });
              await fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text: action === 'pickup' ? '📦 Забрал' : '❌ Отклонено', reply_to_message_id: msgId }),
              });
            }
          } catch (e) {
            console.warn('editMessageReplyMarkup error:', e);
          }
        }

        _processedCallbacks.push(cbId);
      }

      // Save offset so we don't re-fetch old updates
      if (maxUpdateId > _tgUpdateOffset) {
        _tgUpdateOffset = maxUpdateId;
        localStorage.setItem('dc_tg_update_offset', String(_tgUpdateOffset));
      }

      // Persist processed IDs
      if (_processedCallbacks.length > 500) _processedCallbacks = _processedCallbacks.slice(-500);
      localStorage.setItem('dc_tg_processed_cbs', JSON.stringify(_processedCallbacks));

      if (processed > 0) {
        showToast('✅ Обновлено ответов: ' + processed);
        renderAll();
      } else {
        if (!silent) {
          var detail = 'Всего апдейтов: ' + results.length + ', callback_query: ' + callbackCount + ', уже обработано: ' + _processedCallbacks.length;
          showToast('Нет новых ответов. ' + detail);
        }
      }
    } catch (err) {
      if (!silent) showToast('Ошибка: ' + err.message, 'error');
      console.error('checkTelegramConfirmations error:', err);
    }
  }

  // Auto-poll every 10 seconds when there are pending suppliers
  function startTelegramPolling() {
    stopTelegramPolling();
    _tgPollTimer = setInterval(function () {
      var hasPending = orders.some(function (o) { return o.isSupplier && o.telegramSent && (o.telegramStatus === 'sent' || o.telegramStatus === 'confirmed'); });
      if (hasPending) {
        checkTelegramConfirmations(true);
      } else {
        stopTelegramPolling();
      }
    }, 10000);
  }

  function stopTelegramPolling() {
    if (_tgPollTimer) { clearInterval(_tgPollTimer); _tgPollTimer = null; }
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
    order.telegramStatus = null;
    order.telegramMessageId = null;
    order.telegramChatId = null;
    order.assignedDriverId = null;
    if (assignments && assignments[orderIdx] >= 0) {
      assignments[orderIdx] = -1;
    }
    // Remove confirmation record from Supabase
    var client = getSupabaseClient();
    if (client) {
      try { await client.from('telegram_confirmations').delete().eq('order_id', orderId); } catch (e) { /* ignore */ }
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
      if (p.items1c) {
        msg += '\n📋 <b>Товар:</b>\n' + escapeHtml(p.items1c);
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
    var html = '<div class="' + itemClass + '" data-order-id="' + order.id + '" style="' + (hasSlot ? 'border-left-color:' + color : '') + '">';
    var numBg;
    if (order.isPoi) {
      numBg = 'background:' + (hasSlot ? color : (order.poiColor || '#3b82f6')) + ';color:#111;border-radius:4px;font-weight:800;text-shadow:0 0 2px rgba(255,255,255,.8);';
    } else if (order.isSupplier) {
      numBg = hasSlot ? 'background:' + color + ';color:#fff' : (isFailed ? 'background:#ef4444;color:#fff' : 'background:#10b981;color:#fff');
    } else {
      numBg = hasSlot ? 'background:' + color + ';color:#fff' : (isFailed ? 'background:#ef4444;color:#fff' : (isSettlementOnly ? 'background:#f59e0b;color:#fff' : 'background:#e0e0e0;color:#333;border:1px solid #999'));
    }
    var numLabel = order.isPoi ? (order.poiShort || 'П') : (order.isSupplier ? 'П' : (order._displayNum || (idx + 1)));
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
      html += '<div class="dc-supplier-not-found" data-id="' + order.id + '" style="font-size:10px;color:#ef4444;margin-top:1px;cursor:pointer;display:inline-flex;align-items:center;gap:3px;" title="Нажмите чтобы найти в базе">🔍 Не найден — нажмите для поиска</div>';
    }
    if (order.items1c) {
      html += '<div style="font-size:10px;color:#a78bfa;margin-top:2px;white-space:pre-line;">📋 ' + escapeHtml(order.items1c) + '</div>';
    }
    // Inline driver assignment — directly from DB drivers list
    var driverDisplayName = driverId ? getDriverNameById(driverId) : (hasSlot ? getDriverName(slotIdx) : null);
    html += '<div class="dc-order-driver-assign" style="margin-top:3px;">';
    if (hasSlot || driverId) {
      html += '<span class="dc-assign-label" data-idx="' + idx + '" style="color:' + color + ';cursor:pointer;font-size:12px;font-weight:600;" title="Нажмите чтобы сменить водителя">👤 ' + driverDisplayName + ' ▾</span>';
    } else if (order.geocoded && editingDriverId) {
      var editDrvName = getDriverNameById(editingDriverId);
      html += '<button class="dc-quick-assign-btn" data-idx="' + idx + '" data-driver-id="' + editingDriverId + '" style="background:#3b82f6;color:#fff;border:none;border-radius:6px;padding:3px 10px;cursor:pointer;font-size:11px;font-weight:600;display:flex;align-items:center;gap:4px;">+ ' + escapeHtml(editDrvName) + '</button>';
    } else if (order.geocoded) {
      html += '<span class="dc-assign-label" data-idx="' + idx + '" style="color:#999;cursor:pointer;font-size:11px;" title="Назначить водителя">+ Назначить водителя ▾</span>';
    }
    html += '</div>';
    // Telegram send indicator + confirmation status for suppliers
    if (order.isSupplier && order.geocoded) {
      html += '<div class="dc-tg-row" style="display:flex;align-items:center;gap:4px;margin-top:2px;">';
      if (order.telegramSent && order.telegramStatus === 'picked_up') {
        html += '<span style="font-size:11px;color:#22c55e;font-weight:600;" title="Водитель забрал товар">📦 Забрал</span>';
        html += '<button class="btn btn-outline btn-sm dc-tg-cancel-one" data-id="' + order.id + '" style="font-size:10px;padding:1px 6px;color:#ef4444;border-color:#ef4444;" title="Отмена">✕</button>';
      } else if (order.telegramSent && order.telegramStatus === 'confirmed') {
        html += '<span style="font-size:11px;color:#22c55e;" title="Водитель принял, ждём забор">✅ Принял</span>';
        html += '<button class="btn btn-outline btn-sm dc-tg-cancel-one" data-id="' + order.id + '" style="font-size:10px;padding:1px 6px;color:#ef4444;border-color:#ef4444;" title="Отмена">✕</button>';
      } else if (order.telegramSent && order.telegramStatus === 'rejected') {
        html += '<span style="font-size:11px;color:#ef4444;" title="Водитель отклонил">❌ Отклонил</span>';
        html += '<button class="btn btn-outline btn-sm dc-tg-send-one" data-id="' + order.id + '" style="font-size:10px;padding:1px 6px;color:#229ED9;border-color:#229ED9;" title="Отправить повторно">↻</button>';
        html += '<button class="btn btn-outline btn-sm dc-tg-cancel-one" data-id="' + order.id + '" style="font-size:10px;padding:1px 6px;color:#ef4444;border-color:#ef4444;" title="Отмена">✕</button>';
      } else if (order.telegramSent) {
        html += '<span style="font-size:11px;color:#f59e0b;" title="Ожидаем ответ водителя">⏳ Ждём</span>';
        html += '<button class="btn btn-outline btn-sm dc-tg-send-one" data-id="' + order.id + '" style="font-size:10px;padding:1px 6px;color:#229ED9;border-color:#229ED9;" title="Отправить повторно">↻</button>';
        html += '<button class="btn btn-outline btn-sm dc-tg-cancel-one" data-id="' + order.id + '" style="font-size:10px;padding:1px 6px;color:#ef4444;border-color:#ef4444;" title="Отмена">✕</button>';
      } else if (driverId) {
        html += '<button class="btn btn-outline btn-sm dc-tg-send-one" data-id="' + order.id + '" style="font-size:10px;padding:1px 6px;color:#229ED9;border-color:#229ED9;" title="Отправить в Telegram">✈️ →</button>';
      } else {
        html += '<span style="font-size:10px;color:#ccc;" title="Сначала назначьте водителя">✈️ —</span>';
      }
      html += '</div>';
    }
    if (order.isKbt) {
      var helperDr = order.helperDriverSlot != null ? dbDrivers[order.helperDriverSlot] : null;
      var helperName = helperDr ? helperDr.name.split(' ')[0] : '?';
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
      html += '<button class="btn btn-outline btn-sm dc-edit-btn" data-id="' + order.id + '" title="Изменить адрес">✎</button>';
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
      html += '<div class="dc-edit-row"><input class="dc-edit-input" id="dcEditInput-' + safeId + '" value="' + order.address.replace(/"/g, '&quot;') + '" placeholder="Адрес или координаты (53.93, 27.56)"><button class="btn btn-primary btn-sm dc-retry-btn" data-id="' + order.id + '">Найти</button><button class="btn btn-outline btn-sm dc-cancel-edit" data-id="' + order.id + '">✕</button></div>';
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
    const supplierItems = allOrders.filter(function (o) { return o.isSupplier; }).reverse();
    const addressItems = allOrders.filter(function (o) { return !o.isSupplier; }).reverse();

    const geocodedCount = orders.filter(function (o) { return o.geocoded; }).length;
    const failedCount = orders.filter(function (o) { return !o.geocoded && o.error; }).length;
    const settlementOnlyCount = orders.filter(function (o) { return o.geocoded && o.settlementOnly; }).length;

    // Build driver list — always show ALL db drivers
    var driverListHtml = '';
    if (dbDrivers.length > 0) {
      // Count points per driver (by driver_id)
      var driverPointCounts = {};
      dbDrivers.forEach(function (dr) { driverPointCounts[String(dr.id)] = 0; });
      orders.forEach(function (o, i) {
        var did = getOrderDriverId(i);
        if (did && driverPointCounts[String(did)] !== undefined) driverPointCounts[String(did)]++;
      });
      var totalAssigned = orders.filter(function (o, i) { return getOrderDriverId(i) != null; }).length;

      // Edit mode banner
      var editBannerHtml = '';
      if (editingDriverId) {
        var editDrv = dbDrivers.find(function (d) { return String(d.id) === String(editingDriverId); });
        var editDi = dbDrivers.indexOf(editDrv);
        var editColor = editDi >= 0 ? COLORS[editDi % COLORS.length] : '#888';
        var editName = editDrv ? editDrv.name.split(' ')[0] : '?';
        editBannerHtml = '<div class="dc-edit-mode-banner" style="background:rgba(59,130,246,0.15);border:1px solid #3b82f6;border-radius:10px;padding:10px 14px;margin-bottom:8px;display:flex;align-items:center;gap:8px;">' +
          '<span style="width:14px;height:14px;border-radius:50%;background:' + editColor + ';flex-shrink:0;"></span>' +
          '<span style="flex:1;font-size:13px;font-weight:600;color:#e0e0e0;">Редактирование: ' + escapeHtml(editName) + '</span>' +
          '<button class="btn btn-sm dc-edit-mode-done" style="background:#3b82f6;color:#fff;border:none;font-size:11px;padding:4px 12px;">Готово</button>' +
          '</div>';
      }

      driverListHtml = '<div class="dc-section">' + editBannerHtml + '<details class="dc-list-details dc-details-drivers"' + (_driversListOpen ? ' open' : '') + '>' +
        '<summary class="dc-section-title dc-list-toggle" style="cursor:pointer;user-select:none;">Водители <span style="font-weight:400;color:#888;">(' + totalAssigned + '/' + orders.length + ' точек)</span></summary>' +
        '<div class="dc-drivers-list" style="display:flex;flex-direction:column;gap:2px;padding:4px 0;">';
      // "Show all" button
      driverListHtml += '<button class="dc-driver-filter-btn' + (selectedDriver === null && !editingDriverId ? ' active' : '') + '" data-driver-filter="all" style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:8px;border:1px solid ' + (selectedDriver === null && !editingDriverId ? 'var(--accent)' : '#333') + ';background:' + (selectedDriver === null && !editingDriverId ? 'rgba(16,185,129,0.1)' : 'transparent') + ';cursor:pointer;color:#ccc;font-size:12px;font-weight:' + (selectedDriver === null && !editingDriverId ? '700' : '400') + ';width:100%;">Все точки</button>';
      dbDrivers.forEach(function (dr, di) {
        var c = COLORS[di % COLORS.length];
        var count = driverPointCounts[String(dr.id)] || 0;
        var isActive = (selectedDriver != null && String(selectedDriver) === String(dr.id)) || (editingDriverId && String(editingDriverId) === String(dr.id));
        var isEditing = editingDriverId && String(editingDriverId) === String(dr.id);
        driverListHtml += '<div style="display:flex;align-items:center;gap:0;">' +
          '<button class="dc-driver-filter-btn' + (isActive ? ' active' : '') + '" data-driver-filter="' + dr.id + '" data-driver-idx="' + di + '" style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:8px 0 0 8px;border:1px solid ' + (isActive ? c : '#333') + ';background:' + (isActive ? 'rgba(255,255,255,0.05)' : 'transparent') + ';cursor:pointer;flex:1;min-width:0;">' +
          '<span class="dc-driver-color-dot" data-driver-id="' + dr.id + '" data-driver-idx="' + di + '" style="width:14px;height:14px;border-radius:50%;background:' + c + ';flex-shrink:0;border:2px solid rgba(255,255,255,0.2);cursor:pointer;" title="Изменить цвет"></span>' +
          '<span style="flex:1;text-align:left;color:#e0e0e0;font-size:12px;font-weight:' + (isActive ? '700' : '400') + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + dr.name + '</span>' +
          '<span style="color:#888;font-size:11px;">' + count + ' точ.</span>' +
          '</button>' +
          '<button class="dc-driver-edit-btn" data-driver-id="' + dr.id + '" title="Редактировать маршрут" style="padding:6px 8px;border-radius:0 8px 8px 0;border:1px solid ' + (isEditing ? '#3b82f6' : '#333') + ';border-left:none;background:' + (isEditing ? 'rgba(59,130,246,0.2)' : 'transparent') + ';cursor:pointer;color:' + (isEditing ? '#3b82f6' : '#888') + ';font-size:13px;display:flex;align-items:center;" >✎</button>' +
          '</div>';
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
      // Count suppliers by Telegram status
      var unsentSupplierCount = orders.filter(function (o, i) { return o.isSupplier && o.geocoded && !o.telegramSent && getOrderDriverId(i); }).length;
      var pendingCount = orders.filter(function (o) { return o.isSupplier && o.telegramSent && o.telegramStatus === 'sent'; }).length;
      var confirmedCount = orders.filter(function (o) { return o.isSupplier && o.telegramSent && o.telegramStatus === 'confirmed'; }).length;
      var rejectedCount = orders.filter(function (o) { return o.isSupplier && o.telegramSent && o.telegramStatus === 'rejected'; }).length;

      var tgStatusLine = '';
      if (pendingCount > 0 || confirmedCount > 0 || rejectedCount > 0) {
        tgStatusLine = '<div style="font-size:11px;color:#888;margin-top:4px;display:flex;gap:10px;">';
        if (confirmedCount > 0) tgStatusLine += '<span style="color:#22c55e;">✅ ' + confirmedCount + '</span>';
        if (pendingCount > 0) tgStatusLine += '<span style="color:#f59e0b;">⏳ ' + pendingCount + '</span>';
        if (rejectedCount > 0) tgStatusLine += '<span style="color:#ef4444;">❌ ' + rejectedCount + '</span>';
        tgStatusLine += '</div>';
      }

      finishHtml = '<div class="dc-section dc-finish-section">' +
        '<button class="btn dc-btn-finish ready">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg> ' +
        'Завершить маршрут</button>' +
        '<button class="btn dc-btn-telegram" style="background:#229ED9;color:#fff;border:none;margin-top:6px;display:flex;align-items:center;gap:6px;">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>' +
        'Поставщики → Telegram' + (unsentSupplierCount > 0 ? ' (' + unsentSupplierCount + ')' : ' ✓') + '</button>' +
        ((pendingCount > 0 || confirmedCount > 0 || rejectedCount > 0) ? '<button class="btn dc-btn-check-tg" style="background:' + (pendingCount > 0 ? '#f59e0b' : '#6b7280') + ';color:#fff;border:none;margin-top:4px;font-size:12px;display:flex;align-items:center;gap:6px;">🔄 Обновить ответы' + (pendingCount > 0 ? ' (' + pendingCount + ' ожидает)' : '') + '</button>' : '') +
        tgStatusLine +
        '</div>';
    }

    // ─── Supplier list (collapsible) ─────────────────────────
    var filteredSuppliers = supplierItems;
    if (editingDriverId) {
      filteredSuppliers = filteredSuppliers.filter(function (o) {
        var did = getOrderDriverId(o.globalIndex);
        return !did || String(did) === String(editingDriverId);
      });
    } else if (selectedDriver !== null) {
      filteredSuppliers = filteredSuppliers.filter(function (o) {
        var did = getOrderDriverId(o.globalIndex);
        return selectedDriver === '__unassigned__' ? !did : (did != null && String(did) === String(selectedDriver));
      });
    }
    if (_hideAssigned) {
      filteredSuppliers = filteredSuppliers.filter(function (o) { return !getOrderDriverId(o.globalIndex); });
    }
    if (_hideConfirmed) {
      filteredSuppliers = filteredSuppliers.filter(function (o) { return o.telegramStatus !== 'confirmed'; });
    }
    var assignedSupplierCount = supplierItems.filter(function (o) { return !!getOrderDriverId(o.globalIndex); }).length;
    var confirmedSupplierCount = supplierItems.filter(function (o) { return o.telegramStatus === 'confirmed'; }).length;
    var supplierListHtml = '';
    if (supplierItems.length > 0) {
      var toggleBtnHtml = '<button class="dc-toggle-assigned" style="font-size:10px;padding:2px 8px;border-radius:6px;border:1px solid ' + (_hideAssigned ? 'var(--accent)' : '#555') + ';background:' + (_hideAssigned ? 'rgba(16,185,129,0.15)' : 'transparent') + ';color:' + (_hideAssigned ? 'var(--accent)' : '#999') + ';cursor:pointer;margin-left:8px;white-space:nowrap;">' + (_hideAssigned ? 'Показать всех (' + supplierItems.length + ')' : 'Скрыть распред. (' + assignedSupplierCount + ')') + '</button>';
      var confirmToggleHtml = confirmedSupplierCount > 0
        ? '<button class="dc-toggle-confirmed" style="font-size:10px;padding:2px 8px;border-radius:6px;border:1px solid ' + (_hideConfirmed ? '#22c55e' : '#555') + ';background:' + (_hideConfirmed ? 'rgba(34,197,94,0.15)' : 'transparent') + ';color:' + (_hideConfirmed ? '#22c55e' : '#999') + ';cursor:pointer;margin-left:4px;white-space:nowrap;">' + (_hideConfirmed ? 'Показать ✅ (' + confirmedSupplierCount + ')' : 'Скрыть ✅ (' + confirmedSupplierCount + ')') + '</button>'
        : '';
      supplierListHtml = '<div class="dc-section"><details class="dc-list-details dc-details-suppliers"' + (_supplierListOpen ? ' open' : '') + '>' +
        '<summary class="dc-section-title dc-list-toggle" style="cursor:pointer;user-select:none;display:flex;align-items:center;flex-wrap:wrap;gap:4px;">Поставщики <span style="font-weight:400;color:#888;">(' + filteredSuppliers.length + ')</span>' + toggleBtnHtml + confirmToggleHtml + '</summary>' +
        '<div class="dc-orders-list">';
      filteredSuppliers.forEach(function (order) {
        supplierListHtml += renderOrderItem(order, order.globalIndex);
      });
      if (filteredSuppliers.length === 0) {
        var reason = _hideAssigned && _hideConfirmed ? 'Все поставщики распределены/подтверждены' : (_hideAssigned ? 'Все поставщики распределены' : (_hideConfirmed ? 'Все подтверждённые скрыты' : 'Нет поставщиков'));
        supplierListHtml += '<div style="padding:12px;color:#888;font-size:12px;text-align:center;">' + reason + '</div>';
      }
      supplierListHtml += '</div></details></div>';
    }

    // ─── Address list (collapsible) ──────────────────────────
    var filteredAddresses;
    if (editingDriverId) {
      filteredAddresses = addressItems.filter(function (o) {
        var did = getOrderDriverId(o.globalIndex);
        return !did || String(did) === String(editingDriverId);
      });
    } else if (selectedDriver !== null) {
      filteredAddresses = addressItems.filter(function (o) {
        var did = getOrderDriverId(o.globalIndex);
        return selectedDriver === '__unassigned__' ? !did : (did != null && String(did) === String(selectedDriver));
      });
    } else {
      filteredAddresses = addressItems;
    }
    var addressListHtml = '';
    if (filteredAddresses.length > 0) {
      addressListHtml = '<div class="dc-section"><details class="dc-list-details dc-details-addresses"' + (_addressListOpen ? ' open' : '') + '>' +
        '<summary class="dc-section-title dc-list-toggle" style="cursor:pointer;user-select:none;">Адреса <span style="font-weight:400;color:#888;">(' + filteredAddresses.length + ')</span></summary>' +
        '<div class="dc-orders-list">';
      filteredAddresses.forEach(function (order, listPos) {
        order._displayNum = listPos + 1;
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
      // ─── Search through loaded points ───────────────────────
      (orders.length > 0 ? '<div class="dc-section dc-search-section" style="position:relative;">' +
        '<div style="display:flex;align-items:center;gap:6px;">' +
        '<input type="text" id="dcPointSearch" class="dc-search-input" placeholder="🔍 Поиск по точкам на карте..." autocomplete="off" style="flex:1;padding:7px 10px;border:1px solid #444;border-radius:8px;font-size:13px;background:#1a1a2e;color:#e0e0e0;" />' +
        '</div>' +
        '<div id="dcPointSearchResults" style="display:none;margin-top:4px;max-height:200px;overflow-y:auto;border:1px solid #444;border-radius:8px;background:#1e1e2e;"></div>' +
        '</div>' : '') +
      supplierListHtml + addressListHtml + emptyHtml;

    // Bind events
    bindSidebarEvents();
  }

  function bindSidebarEvents() {
    const sidebar = $('#dcSidebar');
    if (!sidebar) return;

    // ─── Point search ─────────────────────────────────────────
    var pointSearchInput = sidebar.querySelector('#dcPointSearch');
    var pointSearchResults = sidebar.querySelector('#dcPointSearchResults');
    if (pointSearchInput && pointSearchResults) {
      var searchTimeout = null;
      pointSearchInput.addEventListener('input', function () {
        clearTimeout(searchTimeout);
        var query = pointSearchInput.value.trim().toLowerCase();
        if (query.length < 2) {
          pointSearchResults.style.display = 'none';
          pointSearchResults.innerHTML = '';
          return;
        }
        searchTimeout = setTimeout(function () {
          var normalizeYo = function (s) { return s.replace(/ё/g, 'е').replace(/Ё/g, 'Е'); };
          var normQuery = normalizeYo(query);
          var matches = [];
          orders.forEach(function (o, idx) {
            if (!o.geocoded) return;
            var searchText = normalizeYo(((o.address || '') + ' ' + (o.formattedAddress || '') + ' ' + (o.phone || '')).toLowerCase());
            if (searchText.indexOf(normQuery) !== -1) {
              matches.push({ order: o, idx: idx });
            }
          });
          if (matches.length === 0) {
            pointSearchResults.innerHTML = '<div style="padding:10px;color:#888;font-size:12px;text-align:center;">Ничего не найдено</div>';
            pointSearchResults.style.display = 'block';
            return;
          }
          var html = '';
          matches.slice(0, 20).forEach(function (m) {
            var o = m.order;
            var did = getOrderDriverId(m.idx);
            var drvInfo = '';
            if (did) {
              var drv = dbDrivers.find(function (d) { return d.id == did; });
              var di = dbDrivers.indexOf(drv);
              var c = di >= 0 ? COLORS[di % COLORS.length] : '#888';
              drvInfo = '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + c + ';margin-right:4px;"></span>';
            }
            var icon = o.isSupplier ? '📦' : '📍';
            var addr = escapeHtml(o.address);
            var fAddr = o.formattedAddress ? '<div style="font-size:10px;color:#888;margin-top:1px;">' + escapeHtml(o.formattedAddress) + '</div>' : '';
            html += '<div class="dc-point-search-item" data-order-id="' + o.id + '" data-lat="' + (o.lat || '') + '" data-lng="' + (o.lng || '') + '" style="padding:8px 10px;cursor:pointer;border-bottom:1px solid #333;transition:background .15s;" onmouseover="this.style.background=\'rgba(255,255,255,0.05)\'" onmouseout="this.style.background=\'transparent\'">' +
              '<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:#e0e0e0;">' + drvInfo + icon + ' ' + addr + '</div>' +
              fAddr + '</div>';
          });
          if (matches.length > 20) {
            html += '<div style="padding:6px;color:#888;font-size:11px;text-align:center;">... ещё ' + (matches.length - 20) + '</div>';
          }
          pointSearchResults.innerHTML = html;
          pointSearchResults.style.display = 'block';

          // Click on search result → center map + highlight sidebar item
          pointSearchResults.querySelectorAll('.dc-point-search-item').forEach(function (item) {
            item.addEventListener('click', function () {
              var lat = parseFloat(item.dataset.lat);
              var lng = parseFloat(item.dataset.lng);
              var oid = item.dataset.orderId;
              if (lat && lng && mapInstance) {
                mapInstance.setCenter([lat, lng], 17, { duration: 300 });
                // Open balloon on the placemark at this location
                mapInstance.balloon.open([lat, lng]);
                setTimeout(function () { mapInstance.balloon.close(); }, 3000);
              }
              // Flash sidebar item
              var sidebarItem = document.querySelector('.dc-order-item[data-order-id="' + oid + '"]');
              if (sidebarItem) {
                sidebarItem.classList.add('dc-order-highlighted');
                sidebarItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setTimeout(function () { sidebarItem.classList.remove('dc-order-highlighted'); }, 2000);
              }
              pointSearchResults.style.display = 'none';
              pointSearchInput.value = '';
            });
          });
        }, 200);
      });

      // Close search results when clicking outside
      document.addEventListener('click', function (e) {
        if (!pointSearchInput.contains(e.target) && !pointSearchResults.contains(e.target)) {
          pointSearchResults.style.display = 'none';
        }
      });
    }

    // Toggle hide/show assigned suppliers
    var toggleAssignedBtn = sidebar.querySelector('.dc-toggle-assigned');
    if (toggleAssignedBtn) {
      toggleAssignedBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        _hideAssigned = !_hideAssigned;
        renderAll();
      });
    }
    // Toggle hide/show confirmed suppliers
    var toggleConfirmedBtn = sidebar.querySelector('.dc-toggle-confirmed');
    if (toggleConfirmedBtn) {
      toggleConfirmedBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        _hideConfirmed = !_hideConfirmed;
        renderAll();
      });
    }

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
    if (distBtn) distBtn.addEventListener('click', showDistributeDialog);
    const clearBtn = sidebar.querySelector('.dc-btn-clear');
    if (clearBtn) clearBtn.addEventListener('click', clearAll);

    // Finish distribution
    const finishBtn = sidebar.querySelector('.dc-btn-finish');
    if (finishBtn) finishBtn.addEventListener('click', showFinishRouteDialog);
    const telegramBtn = sidebar.querySelector('.dc-btn-telegram');
    if (telegramBtn) telegramBtn.addEventListener('click', sendToTelegram);
    const checkTgBtn = sidebar.querySelector('.dc-btn-check-tg');
    if (checkTgBtn) checkTgBtn.addEventListener('click', function () {
      // Clear processed cache on manual click to re-scan all callbacks
      _processedCallbacks = [];
      _tgUpdateOffset = 0;
      localStorage.removeItem('dc_tg_processed_cbs');
      localStorage.removeItem('dc_tg_update_offset');
      _webhookDeleted = false;
      checkTelegramConfirmations(false);
    });

    // POI toggles
    sidebar.querySelectorAll('.dc-poi-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () { togglePoi(btn.dataset.poi); });
    });

    // Driver filter buttons
    sidebar.querySelectorAll('.dc-driver-filter-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (editingDriverId) finishEditing();
        var filterId = btn.dataset.driverFilter;
        if (filterId === 'all') {
          selectedDriver = null;
        } else {
          selectedDriver = filterId;
        }
        renderAll();
      });
    });

    // Driver edit route buttons
    sidebar.querySelectorAll('.dc-driver-edit-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var driverId = btn.dataset.driverId;
        if (editingDriverId && String(editingDriverId) === String(driverId)) {
          finishEditing();
        } else {
          if (editingDriverId) finishEditing();
          editingDriverId = driverId;
          selectedDriver = null;
          renderAll();
        }
      });
    });

    // Edit mode "Done" button
    var doneBtn = sidebar.querySelector('.dc-edit-mode-done');
    if (doneBtn) {
      doneBtn.addEventListener('click', function () {
        finishEditing();
      });
    }

    // Quick assign buttons in edit mode
    sidebar.querySelectorAll('.dc-quick-assign-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var idx = parseInt(btn.dataset.idx);
        var driverId = btn.dataset.driverId;
        window.__dc_assignDirect(idx, parseInt(driverId));
      });
    });

    // Driver color dots — open palette
    sidebar.querySelectorAll('.dc-driver-color-dot').forEach(function (dot) {
      dot.addEventListener('click', function (e) {
        e.stopPropagation();
        showColorPalette(dot, dot.dataset.driverId, parseInt(dot.dataset.driverIdx));
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
        var affectedDriverId = getOrderDriverId(idx);
        orders.splice(idx, 1);
        if (assignments) {
          assignments.splice(idx, 1);
        }
        variants = []; activeVariant = -1;
        renderAll();
        if (affectedDriverId) scheduleSyncDriver(String(affectedDriverId));
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

    // Search supplier in DB (for not-found suppliers)
    sidebar.querySelectorAll('.dc-supplier-not-found').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        openSupplierSearch(el.dataset.id);
      });
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
    // Apply custom driver colors
    loadDriverColors();
    applyCustomColors();
    // Restore saved data on first activation
    if (orders.length === 0) {
      loadState();
    }
    _fitBoundsNext = true;
    initMap().then(function () { updatePlacemarks(); });
    renderSidebar();
    // Start auto-polling if there are pending Telegram confirmations
    var hasPending = orders.some(function (o) { return o.isSupplier && o.telegramSent && o.telegramStatus === 'sent'; });
    if (hasPending) startTelegramPolling();
  }

  // Expose for navigation
  function getDistributedSuppliers() {
    var result = [];
    for (var i = 0; i < orders.length; i++) {
      var o = orders[i];
      if (!o.isSupplier) continue;
      var driverId = getOrderDriverId(i);
      var driverName = null;
      if (driverId) {
        var d = dbDrivers.find(function (dr) { return String(dr.id) === String(driverId); });
        driverName = d ? d.name : null;
      }
      result.push({
        address: o.address,
        supplierName: o.supplierName || o.address,
        driverName: driverName,
        driverId: driverId,
        timeSlot: o.timeSlot || '',
        phone: o.phone || '',
        geocoded: o.geocoded,
        inDb: !!o.supplierDbId,
        telegramStatus: o.telegramStatus || null,
        telegramSent: !!o.telegramSent,
      });
    }
    return result;
  }

  function getDistributionDrivers() {
    var driverIds = {};
    var result = [];
    for (var i = 0; i < orders.length; i++) {
      var o = orders[i];
      if (!o.isSupplier) continue;
      var did = getOrderDriverId(i);
      if (did && !driverIds[did]) {
        driverIds[did] = true;
        var d = dbDrivers.find(function (dr) { return String(dr.id) === String(did); });
        if (d) result.push({ id: d.id, name: d.name });
      }
    }
    result.sort(function (a, b) { return a.name.localeCompare(b.name, 'ru'); });
    return result;
  }

  var _origRenderAll = renderAll;
  renderAll = function () {
    _origRenderAll();
    if (window._onDistributionChanged) {
      try { window._onDistributionChanged(); } catch (e) { console.warn(e); }
    }
  };

  window.DistributionUI = {
    onSectionActivated: onSectionActivated,
    getDistributedSuppliers: getDistributedSuppliers,
    getDistributionDrivers: getDistributionDrivers,
    getSupplierItems: getSupplierItems,
  };

  // Auto-init if section is already visible
  document.addEventListener('DOMContentLoaded', function () {
    const section = document.getElementById('distributionSection');
    if (section && section.classList.contains('active')) {
      onSectionActivated();
    }
  });
})();
