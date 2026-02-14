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
  let suggestTimeout = null;
  let suggestAddingId = null; // if set, suggest replaces this order instead of adding new

  // Водители из БД
  let dbDrivers = [];
  // Привязка цвет-индекс → driver_id (driverSlots[0] = driver_id для цвета 0)
  let driverSlots = [];

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

  function getDriverName(slotIdx) {
    const driverId = driverSlots[slotIdx];
    if (!driverId) return 'В' + (slotIdx + 1);
    const d = dbDrivers.find(function (dr) { return dr.id === driverId; });
    return d ? d.name.split(' ')[0] : 'В' + (slotIdx + 1);
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
  async function initMap() {
    const container = $('#distributionMap');
    if (!container || mapInstance) return;
    try {
      const ymaps = await window.DistributionGeocoder.loadYmaps();
      mapInstance = new ymaps.Map(container, {
        center: MINSK_CENTER, zoom: DEFAULT_ZOOM,
        controls: ['zoomControl', 'fullscreenControl'],
      }, { suppressMapOpenBlock: true });

      mapInstance.events.add('click', function (e) {
        if (!placingOrderId) return;
        const coords = e.get('coords');
        orders = orders.map(function (o) {
          if (o.id !== placingOrderId) return o;
          return Object.assign({}, o, { lat: coords[0], lng: coords[1], geocoded: true, error: null, settlementOnly: false, formattedAddress: coords[0].toFixed(5) + ', ' + coords[1].toFixed(5) + ' (вручную)' });
        });
        placingOrderId = null;
        renderAll();
        showToast('Точка установлена вручную');
      });

      // Initialize address search dropdown
      initAddressSearch();
    } catch (err) {
      console.error('Map init error:', err);
    }
  }

  function updatePlacemarks() {
    if (!mapInstance || !window.ymaps) return;
    const ymaps = window.ymaps;
    placemarks.forEach(function (pm) { mapInstance.geoObjects.remove(pm); });
    placemarks = [];

    const geocoded = orders.filter(function (o) { return o.geocoded && o.lat && o.lng; });
    if (geocoded.length === 0) return;

    const bounds = [];
    geocoded.forEach(function (order) {
      const globalIdx = orders.indexOf(order);
      const driverIdx = assignments ? assignments[globalIdx] : -1;
      const isVisible = selectedDriver === null || driverIdx === selectedDriver;
      const isSettlementOnly = order.settlementOnly;
      const defaultColor = isSettlementOnly ? '#f59e0b' : '#3b82f6';
      const color = driverIdx >= 0 ? COLORS[driverIdx % COLORS.length] : defaultColor;

      const balloonHtml = buildBalloon(order, globalIdx, driverIdx);
      const hintHtml = '<b>' + (globalIdx + 1) + '. ' + order.address + '</b>' +
        (order.formattedAddress ? '<br><span style="color:#666;font-size:12px;">' + order.formattedAddress + '</span>' : '') +
        (isSettlementOnly ? '<br><span style="color:#f59e0b;font-size:11px;">⚠ Только населённый пункт</span>' : '');
      const pm = new ymaps.Placemark([order.lat, order.lng], {
        balloonContentBody: balloonHtml,
        iconContent: String(globalIdx + 1),
        hintContent: hintHtml,
      }, {
        preset: isSettlementOnly ? 'islands#circleDotIcon' : 'islands#circleIcon',
        iconColor: color,
        iconOpacity: isVisible ? 1 : 0.25,
      });

      // Hover events: highlight order in sidebar
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
    });

    if (bounds.length > 0) {
      mapInstance.setBounds(ymaps.util.bounds.fromPoints(bounds), { checkZoomRange: true, zoomMargin: 40 });
    }
  }

  function buildBalloon(order, globalIdx, driverIdx) {
    let buttons = '';
    for (let d = 0; d < driverCount; d++) {
      const c = COLORS[d % COLORS.length];
      const active = d === driverIdx;
      const name = getDriverName(d);
      buttons += '<button onclick="window.__dc_assign(' + globalIdx + ',' + d + ')" style="display:flex;align-items:center;gap:4px;padding:4px 8px;border-radius:12px;border:2px solid ' + (active ? '#fff' : 'transparent') + ';background:' + c + ';cursor:pointer;margin:2px;box-shadow:' + (active ? '0 0 0 2px ' + c : 'none') + ';color:#fff;font-size:11px;font-weight:600;" title="' + name + '"><span style="width:10px;height:10px;border-radius:50%;background:rgba(255,255,255,0.4);"></span>' + name + '</button>';
    }
    const eid = order.id.replace(/'/g, "\\'");
    return '<div style="font-family:system-ui,sans-serif;min-width:220px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">' +
      '<div style="font-weight:700;font-size:14px;margin-bottom:4px;">' + order.address + '</div>' +
      '<button onclick="window.__dc_delete(\'' + eid + '\')" style="flex-shrink:0;width:26px;height:26px;border-radius:6px;border:1px solid #e5e5e5;background:#fff;color:#ef4444;font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;" title="Удалить">✕</button></div>' +
      (order.formattedAddress ? '<div style="color:#888;font-size:11px;margin-bottom:4px;">' + order.formattedAddress + '</div>' : '') +
      (order.timeSlot ? '<div style="font-size:12px;margin-bottom:4px;">⏰ ' + order.timeSlot + '</div>' : '') +
      (order.phone ? '<div style="font-size:12px;margin-bottom:8px;">📞 ' + order.phone + '</div>' : '') +
      '<div style="border-top:1px solid #eee;padding-top:8px;margin-top:4px;">' +
      '<div style="font-size:11px;color:#888;margin-bottom:6px;">Назначить водителя:</div>' +
      '<div style="display:flex;flex-wrap:wrap;align-items:center;">' + buttons + '</div></div></div>';
  }

  // Global callbacks for balloon HTML
  window.__dc_assign = function (globalIdx, driverIdx) {
    if (!assignments) return;
    assignments = assignments.slice();
    assignments[globalIdx] = driverIdx;
    activeVariant = -1;
    renderAll();
    if (mapInstance) mapInstance.balloon.close();
  };
  window.__dc_delete = function (orderId) {
    const idx = orders.findIndex(function (o) { return o.id === orderId; });
    if (idx === -1) return;
    orders.splice(idx, 1);
    if (assignments) {
      assignments.splice(idx, 1);
    }
    variants = []; activeVariant = -1;
    renderAll();
    if (mapInstance) mapInstance.balloon.close();
    showToast('Точка удалена');
  };

  // ─── Actions ──────────────────────────────────────────────
  async function loadAddresses(append) {
    const textarea = $('#dcAddressInput');
    if (!textarea) return;
    const text = textarea.value;
    const parsed = window.DistributionParser.parseOrders(text);
    if (parsed.length === 0) { showToast('Не найдено адресов', 'error'); return; }

    if (!append) { orders = []; assignments = null; variants = []; activeVariant = -1; }
    const prevAssignments = append ? assignments : null;
    isGeocoding = true;
    renderAll();

    const progressEl = $('#dcProgress');
    try {
      const geocoded = await window.DistributionGeocoder.geocodeOrders(parsed, function (cur, tot) {
        if (progressEl) progressEl.textContent = cur + '/' + tot;
      });
      if (append) {
        orders = orders.concat(geocoded);
        if (prevAssignments) {
          assignments = prevAssignments.slice();
          for (let i = 0; i < geocoded.length; i++) {
            assignments.push(-1);
          }
        }
      }
      else { orders = geocoded; }
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

  function distribute() {
    const geocodedCount = orders.filter(function (o) { return o.geocoded; }).length;
    if (geocodedCount === 0) { showToast('Нет геокодированных адресов', 'error'); return; }
    driverCount = parseInt($('#dcDriverCount').value) || 3;
    // Ensure driverSlots array matches driverCount
    while (driverSlots.length < driverCount) driverSlots.push(null);
    if (driverSlots.length > driverCount) driverSlots = driverSlots.slice(0, driverCount);
    variants = window.DistributionAlgo.generateVariants(orders, driverCount);
    activeVariant = 0;
    assignments = variants[0].assignments.slice();
    selectedDriver = null;
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
    orders = []; assignments = null; variants = []; activeVariant = -1; selectedDriver = null;
    driverSlots = [];
    clearState();
    renderAll();
    showToast('Данные карты сброшены');
  }

  // ─── Finish distribution (publish routes) ──────────────────
  async function finishDistribution() {
    if (!assignments) { showToast('Сначала распределите точки', 'error'); return; }

    // Check that all slots have drivers assigned
    const usedSlots = new Set();
    assignments.forEach(function (a) { if (a >= 0) usedSlots.add(a); });

    let unassignedSlots = [];
    usedSlots.forEach(function (slot) {
      if (!driverSlots[slot]) unassignedSlots.push(slot);
    });

    if (unassignedSlots.length > 0) {
      showToast('Назначьте водителей для всех цветов (' + unassignedSlots.map(function(s){ return 'В' + (s+1); }).join(', ') + ')', 'error');
      return;
    }

    // Build routes per driver
    const routeDate = new Date().toISOString().split('T')[0];
    const routesByDriver = {};

    orders.forEach(function (order, idx) {
      const slot = assignments[idx];
      if (slot < 0 || !order.geocoded) return;
      const driverId = driverSlots[slot];
      if (!driverId) return;

      if (!routesByDriver[driverId]) {
        routesByDriver[driverId] = [];
      }
      routesByDriver[driverId].push({
        address: order.address,
        lat: order.lat,
        lng: order.lng,
        phone: order.phone || null,
        timeSlot: order.timeSlot || null,
        formattedAddress: order.formattedAddress || null,
        orderNum: routesByDriver[driverId].length + 1,
      });
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

  // ─── Address search dropdown (geocode-based, guaranteed to work) ──
  function initAddressSearch() {
    var input = document.getElementById('dcSuggestInput');
    var dropdown = document.getElementById('dcSuggestDropdown');
    if (!input || !dropdown) { console.warn('Search init: input or dropdown not found'); return; }
    if (input.dataset.searchInit) return;
    input.dataset.searchInit = '1';
    console.log('Address search initialized');

    // Input handler with debounce
    input.addEventListener('input', function () {
      clearTimeout(suggestTimeout);
      var query = input.value.trim();
      if (query.length < 3) {
        dropdown.innerHTML = '';
        dropdown.style.display = 'none';
        return;
      }
      dropdown.innerHTML = '<div class="dc-suggest-loading">Ищем «' + query + '»...</div>';
      dropdown.style.display = 'block';

      suggestTimeout = setTimeout(function () {
        doGeoSearch(query, dropdown);
      }, 400);
    });

    // Click on result
    dropdown.addEventListener('click', function (e) {
      var el = e.target.closest('.dc-suggest-item');
      if (!el) return;
      var idx = parseInt(el.dataset.idx);
      if (dropdown._items && dropdown._items[idx]) {
        var sel = dropdown._items[idx];
        input.value = '';
        dropdown.style.display = 'none';
        dropdown._items = null;
        addDirectOrder(sel.displayName, sel.lat, sel.lng);
      }
    });

    // Keyboard navigation
    input.addEventListener('keydown', function (e) {
      var items = dropdown.querySelectorAll('.dc-suggest-item');
      if (e.key === 'Escape') { dropdown.style.display = 'none'; return; }
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && items.length > 0) {
        e.preventDefault();
        var active = dropdown.querySelector('.dc-suggest-item.active');
        var curIdx = -1;
        if (active) { curIdx = Array.from(items).indexOf(active); active.classList.remove('active'); }
        curIdx = e.key === 'ArrowDown' ? curIdx + 1 : curIdx - 1;
        if (curIdx < 0) curIdx = items.length - 1;
        if (curIdx >= items.length) curIdx = 0;
        items[curIdx].classList.add('active');
        items[curIdx].scrollIntoView({ block: 'nearest' });
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        var active = dropdown.querySelector('.dc-suggest-item.active');
        if (active) { active.click(); }
      }
    });

    // Close on outside click
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.dc-suggest-wrap')) {
        dropdown.style.display = 'none';
      }
    });
  }

  async function doGeoSearch(query, dropdown) {
    console.log('Searching for:', query);
    try {
      var items = await window.DistributionGeocoder.searchAddresses(query);
      console.log('Search results:', items ? items.length : 0);
      if (!items || items.length === 0) {
        dropdown.innerHTML = '<div class="dc-suggest-empty">Ничего не найдено. Попробуйте уточнить запрос.</div>';
        return;
      }
      dropdown._items = items;
      dropdown.innerHTML = items.map(function (it, i) {
        var icon = it.precision === 'exact' ? '📍' : (it.precision === 'street' ? '🛣️' : '📌');
        return '<div class="dc-suggest-item" data-idx="' + i + '">' +
          '<span class="dc-suggest-icon">' + icon + '</span>' +
          '<span class="dc-suggest-text">' + escapeHtml(it.displayName) + '</span></div>';
      }).join('');
      dropdown.style.display = 'block';
    } catch (e) {
      console.error('Geocode search error:', e);
      dropdown.innerHTML = '<div class="dc-suggest-empty">Ошибка поиска: ' + escapeHtml(e.message || 'неизвестная') + '</div>';
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function addDirectOrder(address, lat, lng) {
    var newOrder = {
      id: 'order-' + Date.now() + '-' + (orders.length + 1),
      address: address,
      phone: '', timeSlot: null,
      geocoded: true, lat: lat, lng: lng,
      formattedAddress: address,
      error: null, settlementOnly: false,
      driverIndex: -1,
    };
    if (suggestAddingId) {
      orders = orders.map(function (o) {
        if (o.id !== suggestAddingId) return o;
        return Object.assign({}, o, {
          address: address, lat: lat, lng: lng,
          formattedAddress: address, geocoded: true,
          error: null, settlementOnly: false,
        });
      });
      suggestAddingId = null;
    } else {
      orders.push(newOrder);
      if (assignments) assignments.push(-1);
    }
    renderAll();
    showToast('Адрес добавлен');
  }

  async function addAddressFromSuggest(addressValue) {
    showToast('Ищем адрес...');
    try {
      var geo = await window.DistributionGeocoder.geocodeAddress(addressValue);
      if (suggestAddingId) {
        // Replace existing failed order
        orders = orders.map(function (o) {
          if (o.id !== suggestAddingId) return o;
          return Object.assign({}, o, {
            address: addressValue, lat: geo.lat, lng: geo.lng,
            formattedAddress: geo.formattedAddress, geocoded: true,
            error: null, settlementOnly: geo.settlementOnly || false,
          });
        });
        suggestAddingId = null;
      } else {
        // Add new order
        var newOrder = {
          id: 'order-' + Date.now() + '-' + (orders.length + 1),
          address: addressValue,
          phone: '', timeSlot: null,
          geocoded: true, lat: geo.lat, lng: geo.lng,
          formattedAddress: geo.formattedAddress,
          error: null, settlementOnly: geo.settlementOnly || false,
          driverIndex: -1,
        };
        orders.push(newOrder);
        if (assignments) assignments.push(-1);
      }
      renderAll();
      showToast(geo.settlementOnly ? 'Населённый пункт найден — уточните на карте' : 'Адрес добавлен');
    } catch (err) {
      showToast('Не удалось найти: ' + addressValue, 'error');
    }
  }

  // ─── Render ───────────────────────────────────────────────
  function renderAll() {
    renderSidebar();
    updatePlacemarks();
    saveState();
    const mapContainer = $('#distributionMap');
    if (mapContainer) mapContainer.style.cursor = placingOrderId ? 'crosshair' : '';
  }

  function renderSidebar() {
    const sidebar = $('#dcSidebar');
    if (!sidebar) return;

    const geocodedCount = orders.filter(function (o) { return o.geocoded; }).length;
    const failedCount = orders.filter(function (o) { return !o.geocoded && o.error; }).length;
    const settlementOnlyCount = orders.filter(function (o) { return o.geocoded && o.settlementOnly; }).length;

    // Build driver assignment panel (color → driver select)
    let driverSlotsHtml = '';
    if (assignments) {
      driverSlotsHtml = '<div class="dc-section"><div class="dc-section-title">Водители</div><div class="dc-driver-slots">';
      for (let d = 0; d < driverCount; d++) {
        const c = COLORS[d % COLORS.length];
        const currentDriverId = driverSlots[d] || '';
        const count = assignments.filter(function (a) { return a === d; }).length;
        if (count === 0) continue; // Skip empty slots

        driverSlotsHtml += '<div class="dc-driver-slot">';
        driverSlotsHtml += '<span class="dc-dot-lg" style="background:' + c + '"></span>';
        driverSlotsHtml += '<select class="dc-driver-select" data-slot="' + d + '">';
        driverSlotsHtml += '<option value="">-- Выберите водителя --</option>';
        dbDrivers.forEach(function (dr) {
          const sel = dr.id == currentDriverId ? ' selected' : '';
          // Check if this driver is already assigned to another slot
          const usedInOther = driverSlots.some(function (sid, si) { return si !== d && sid === dr.id; });
          driverSlotsHtml += '<option value="' + dr.id + '"' + sel + (usedInOther ? ' disabled' : '') + '>' + dr.name + (usedInOther ? ' (занят)' : '') + '</option>';
        });
        driverSlotsHtml += '</select>';
        driverSlotsHtml += '<span class="dc-slot-count">' + count + ' точек</span>';
        driverSlotsHtml += '</div>';
      }
      driverSlotsHtml += '</div></div>';
    }

    // Build stats
    let statsHtml = '';
    if (assignments && variants.length > 0) {
      const driverRoutes = [];
      for (let d = 0; d < driverCount; d++) driverRoutes.push([]);
      orders.forEach(function (o, i) { if (assignments[i] >= 0) driverRoutes[assignments[i]].push(o); });

      statsHtml = '<div class="dc-stats">';
      for (let d = 0; d < driverCount; d++) {
        const c = COLORS[d % COLORS.length];
        const count = driverRoutes[d].length;
        if (count === 0) continue;
        let km = 0;
        for (let j = 0; j < driverRoutes[d].length - 1; j++) {
          const a = driverRoutes[d][j], b = driverRoutes[d][j + 1];
          if (a.lat && b.lat) {
            const R = 6371, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLng = ((b.lng - a.lng) * Math.PI) / 180;
            const x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
            km += R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
          }
        }
        const name = getDriverName(d);
        statsHtml += '<button class="dc-driver-tab' + (selectedDriver === d ? ' active' : '') + '" data-driver="' + d + '" style="' + (selectedDriver === d ? 'border-bottom-color:' + c : '') + '"><span class="dc-dot" style="background:' + c + '"></span> ' + name + ' <span class="dc-tab-count">' + count + ' · ' + (Math.round(km * 10) / 10) + ' км</span></button>';
      }
      statsHtml += '<button class="dc-driver-tab' + (selectedDriver === null ? ' active' : '') + '" data-driver="all">Все</button>';
      statsHtml += '</div>';
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

    // Finish button
    let finishHtml = '';
    if (assignments) {
      // Check if all used slots have drivers
      const usedSlots = new Set();
      assignments.forEach(function (a) { if (a >= 0) usedSlots.add(a); });
      let allAssigned = true;
      usedSlots.forEach(function (s) { if (!driverSlots[s]) allAssigned = false; });

      finishHtml = '<div class="dc-section dc-finish-section">' +
        '<button class="btn dc-btn-finish' + (allAssigned ? ' ready' : '') + '">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg> ' +
        'Завершить распределение</button></div>';
    }

    // Orders list
    let listHtml = '';
    const displayOrders = orders.map(function (o, i) { return Object.assign({}, o, { globalIndex: i }); });
    const filtered = selectedDriver !== null ? displayOrders.filter(function (o) { return assignments && assignments[o.globalIndex] === selectedDriver; }) : displayOrders;

    if (filtered.length > 0) {
      filtered.forEach(function (order) {
        const dIdx = assignments ? assignments[order.globalIndex] : -1;
        const color = dIdx >= 0 ? COLORS[dIdx % COLORS.length] : '';
        const isFailed = !order.geocoded && order.error;
        const isSettlementOnly = order.geocoded && order.settlementOnly;
        const isEditing = editingOrderId === order.id;
        const isPlacing = placingOrderId === order.id;
        const safeId = order.id.replace(/[^a-zA-Z0-9\-]/g, '');

        let itemClass = 'dc-order-item';
        if (isFailed) itemClass += ' failed';
        if (isSettlementOnly) itemClass += ' settlement-only';
        if (isPlacing) itemClass += ' placing';

        listHtml += '<div class="' + itemClass + '" data-order-id="' + order.id + '" style="' + (dIdx >= 0 ? 'border-left-color:' + color : '') + '">';
        const numBg = dIdx >= 0 ? 'background:' + color + ';color:#fff' : (isFailed ? 'background:#ef4444;color:#fff' : (isSettlementOnly ? 'background:#f59e0b;color:#fff' : ''));
        listHtml += '<div class="dc-order-num" style="' + numBg + '">' + (order.globalIndex + 1) + '</div>';
        listHtml += '<div class="dc-order-info"><div class="dc-order-addr">' + order.address + '</div>';
        if (order.timeSlot || order.phone) {
          listHtml += '<div class="dc-order-meta">';
          if (order.timeSlot) listHtml += '<span>⏰ ' + order.timeSlot + '</span> ';
          if (order.phone) listHtml += '<span>📞 ' + order.phone + '</span>';
          listHtml += '</div>';
        }
        if (order.formattedAddress) listHtml += '<div class="dc-order-faddr">📍 ' + order.formattedAddress + '</div>';
        if (isSettlementOnly) {
          listHtml += '<div class="dc-order-warn">⚠ Найден только населённый пункт — уточните точку на карте</div>';
        }
        if (dIdx >= 0) {
          const driverName = getDriverName(dIdx);
          listHtml += '<div class="dc-order-driver" style="color:' + color + ';">👤 ' + driverName + '</div>';
        }
        listHtml += '</div>';

        // Actions
        if (isFailed) {
          listHtml += '<div class="dc-order-actions">';
          listHtml += '<button class="btn btn-outline btn-sm dc-edit-btn" data-id="' + order.id + '" title="Изменить адрес">✎</button>';
          listHtml += '<button class="btn btn-outline btn-sm dc-place-btn" data-id="' + order.id + '" title="Поставить на карте">📍</button>';
          listHtml += '<button class="btn btn-outline btn-sm dc-del-btn" data-id="' + order.id + '" title="Удалить">✕</button>';
          listHtml += '</div>';
        } else if (isSettlementOnly) {
          listHtml += '<div class="dc-order-actions">';
          listHtml += '<button class="btn btn-outline btn-sm dc-edit-btn" data-id="' + order.id + '" title="Изменить адрес">✎</button>';
          listHtml += '<button class="btn btn-sm dc-place-btn dc-place-btn-warn" data-id="' + order.id + '" title="Уточнить точку на карте">📍 На карту</button>';
          listHtml += '<button class="btn btn-outline btn-sm dc-del-btn" data-id="' + order.id + '" title="Удалить">✕</button>';
          listHtml += '</div>';
        } else {
          listHtml += '<div class="dc-order-actions">';
          listHtml += '<span class="dc-status-ok">✓</span>';
          listHtml += '<button class="btn btn-outline btn-sm dc-place-btn" data-id="' + order.id + '" title="Переместить на карте">📍</button>';
          listHtml += '<button class="btn btn-outline btn-sm dc-del-btn dc-del-visible" data-id="' + order.id + '" title="Удалить">✕</button>';
          listHtml += '</div>';
        }
        listHtml += '</div>';

        // Edit row
        if (isEditing) {
          listHtml += '<div class="dc-edit-row"><input class="dc-edit-input" id="dcEditInput-' + safeId + '" value="' + order.address.replace(/"/g, '&quot;') + '" placeholder="Новый адрес..."><button class="btn btn-primary btn-sm dc-retry-btn" data-id="' + order.id + '">Найти</button><button class="btn btn-outline btn-sm dc-cancel-edit" data-id="' + order.id + '">✕</button></div>';
        }
        if (isPlacing) {
          listHtml += '<div class="dc-edit-row" style="color:var(--accent);font-size:12px;">👆 Кликните на карту для установки точки <button class="btn btn-outline btn-sm dc-cancel-place">Отмена</button></div>';
        }
      });
    } else if (orders.length === 0) {
      listHtml = '<div class="dc-empty">Вставьте адреса и нажмите «На карту»</div>';
    }

    sidebar.innerHTML =
      // Bulk paste
      '<div class="dc-section dc-bulk-section">' +
      '<details class="dc-bulk-details"' + (orders.length === 0 ? ' open' : '') + '>' +
      '<summary class="dc-section-title dc-bulk-toggle">Вставить список адресов</summary>' +
      '<textarea id="dcAddressInput" class="dc-textarea" placeholder="Вставьте адреса, каждый с новой строки\\nФормат: адрес [TAB] телефон [TAB] время" ' + (isGeocoding ? 'disabled' : '') + '></textarea>' +
      '<div class="dc-buttons" style="margin-top:6px;">' +
      (orders.length === 0
        ? '<button class="btn btn-primary dc-btn-load" ' + (isGeocoding ? 'disabled' : '') + '>' + (isGeocoding ? '<span id="dcProgress">...</span>' : 'На карту') + '</button>'
        : '<button class="btn btn-primary dc-btn-append" ' + (isGeocoding ? 'disabled' : '') + '>' + (isGeocoding ? '<span id="dcProgress">...</span>' : '+ Добавить') + '</button><button class="btn btn-outline btn-sm dc-btn-replace" ' + (isGeocoding ? 'disabled' : '') + '>Заменить всё</button>'
      ) +
      '</div></details></div>' +
      // Info + controls
      (orders.length > 0 ? '<div class="dc-info">Загружено: <strong>' + orders.length + '</strong> (найдено: ' + geocodedCount + (settlementOnlyCount > 0 ? ', <span style="color:#f59e0b;">уточнить: ' + settlementOnlyCount + '</span>' : '') + (failedCount > 0 ? ', ошибок: ' + failedCount : '') + ')</div>' : '') +
      '<div class="dc-section"><div class="dc-controls">' +
      '<div class="dc-control-group"><label>Водителей</label><input type="number" id="dcDriverCount" class="dc-count-input" min="1" max="12" value="' + driverCount + '"></div>' +
      '<div class="dc-buttons">' +
      (geocodedCount > 0 ? '<button class="btn btn-primary dc-btn-distribute" style="background:var(--accent);border-color:#0a3d31;color:#04211b;">Распределить</button>' : '') +
      (orders.length > 0 ? '<button class="btn btn-outline btn-sm dc-btn-clear" style="color:var(--danger);border-color:var(--danger);">Сбросить данные</button>' : '') +
      '</div></div></div>' +
      variantsHtml + statsHtml +
      driverSlotsHtml + finishHtml +
      '<div class="dc-orders-list">' + listHtml + '</div>';

    // Bind events
    bindSidebarEvents();
  }

  function bindSidebarEvents() {
    const sidebar = $('#dcSidebar');
    if (!sidebar) return;

    // Load / Append / Replace
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

    // Driver slot selects
    sidebar.querySelectorAll('.dc-driver-select').forEach(function (sel) {
      sel.addEventListener('change', function () {
        const slot = parseInt(sel.dataset.slot);
        const val = sel.value ? parseInt(sel.value) : null;
        driverSlots[slot] = val;
        renderAll();
      });
    });

    // Variants
    sidebar.querySelectorAll('.dc-variant').forEach(function (btn) {
      btn.addEventListener('click', function () { selectVariant(parseInt(btn.dataset.variant)); });
    });

    // Driver tabs
    sidebar.querySelectorAll('.dc-driver-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        selectedDriver = btn.dataset.driver === 'all' ? null : parseInt(btn.dataset.driver);
        renderAll();
      });
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

    // Enter in edit inputs
    sidebar.querySelectorAll('.dc-edit-input').forEach(function (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          const retryBtn = input.parentElement.querySelector('.dc-retry-btn');
          if (retryBtn) retryBtn.click();
        }
      });
    });
  }

  // ─── Init on tab switch ───────────────────────────────────
  async function onSectionActivated() {
    // Load drivers from DB
    await loadDbDrivers();
    // Restore saved data on first activation
    if (orders.length === 0) {
      loadState();
    }
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
