/**
 * DriveControl — Distribution UI module
 * Renders the "Распределение маршрутов" tab with Yandex Map.
 * Persists data to localStorage.
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

  // ─── Persistence (localStorage) ───────────────────────────
  function saveState() {
    try {
      const data = {
        orders: orders,
        assignments: assignments,
        driverCount: driverCount,
        activeVariant: activeVariant,
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
          return Object.assign({}, o, { lat: coords[0], lng: coords[1], geocoded: true, error: null, formattedAddress: coords[0].toFixed(5) + ', ' + coords[1].toFixed(5) + ' (вручную)' });
        });
        placingOrderId = null;
        renderAll();
        showToast('Точка установлена вручную');
      });
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
      const color = driverIdx >= 0 ? COLORS[driverIdx % COLORS.length] : '#3b82f6';

      const balloonHtml = buildBalloon(order, globalIdx, driverIdx);
      const pm = new ymaps.Placemark([order.lat, order.lng], {
        balloonContentBody: balloonHtml,
        iconContent: String(globalIdx + 1),
      }, {
        preset: 'islands#circleIcon',
        iconColor: color,
        iconOpacity: isVisible ? 1 : 0.25,
      });
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
      buttons += '<button onclick="window.__dc_assign(' + globalIdx + ',' + d + ')" style="width:28px;height:28px;border-radius:50%;border:3px solid ' + (active ? '#fff' : 'transparent') + ';background:' + c + ';cursor:pointer;margin:0 2px;box-shadow:' + (active ? '0 0 0 2px ' + c : 'none') + ';" title="В' + (d + 1) + '"></button>';
    }
    const eid = order.id.replace(/'/g, "\\'");
    return '<div style="font-family:system-ui,sans-serif;min-width:200px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">' +
      '<div style="font-weight:700;font-size:14px;margin-bottom:4px;">' + order.address + '</div>' +
      '<button onclick="window.__dc_delete(\'' + eid + '\')" style="flex-shrink:0;width:26px;height:26px;border-radius:6px;border:1px solid #e5e5e5;background:#fff;color:#ef4444;font-size:15px;cursor:pointer;display:flex;align-items:center;justify-content:center;" title="Удалить">✕</button></div>' +
      (order.formattedAddress ? '<div style="color:#888;font-size:11px;margin-bottom:4px;">' + order.formattedAddress + '</div>' : '') +
      (order.timeSlot ? '<div style="font-size:12px;margin-bottom:4px;">⏰ ' + order.timeSlot + '</div>' : '') +
      (order.phone ? '<div style="font-size:12px;margin-bottom:8px;">📞 ' + order.phone + '</div>' : '') +
      '<div style="border-top:1px solid #eee;padding-top:8px;margin-top:4px;">' +
      '<div style="font-size:11px;color:#888;margin-bottom:6px;">Назначить водителя:</div>' +
      '<div style="display:flex;align-items:center;">' + buttons + '</div></div></div>';
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
    // Удаляем назначение этой точки, сохраняя остальные
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
    // При добавлении сохраняем существующие назначения
    const prevAssignments = append ? assignments : null;
    const prevOrderCount = orders.length;
    isGeocoding = true;
    renderAll();

    const progressEl = $('#dcProgress');
    try {
      const geocoded = await window.DistributionGeocoder.geocodeOrders(parsed, function (cur, tot) {
        if (progressEl) progressEl.textContent = cur + '/' + tot;
      });
      if (append) {
        orders = orders.concat(geocoded);
        // Расширяем массив назначений: старые сохраняем, новым ставим -1 (не назначен)
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
        return Object.assign({}, o, { address: addr, lat: geo.lat, lng: geo.lng, formattedAddress: geo.formattedAddress, geocoded: true, error: null });
      });
      editingOrderId = null;
      renderAll();
      showToast('Адрес найден');
    }).catch(function () {
      showToast('Не найден: ' + addr, 'error');
      input.disabled = false;
    });
  }

  function clearAll() {
    orders = []; assignments = null; variants = []; activeVariant = -1; selectedDriver = null;
    clearState();
    renderAll();
    showToast('Данные карты сброшены');
  }

  // ─── Render ───────────────────────────────────────────────
  function renderAll() {
    renderSidebar();
    updatePlacemarks();
    saveState(); // persist after every change
    const mapContainer = $('#distributionMap');
    if (mapContainer) mapContainer.style.cursor = placingOrderId ? 'crosshair' : '';
  }

  function renderSidebar() {
    const sidebar = $('#dcSidebar');
    if (!sidebar) return;

    const geocodedCount = orders.filter(function (o) { return o.geocoded; }).length;
    const failedCount = orders.filter(function (o) { return !o.geocoded && o.error; }).length;

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
        let km = 0;
        for (let j = 0; j < driverRoutes[d].length - 1; j++) {
          const a = driverRoutes[d][j], b = driverRoutes[d][j + 1];
          if (a.lat && b.lat) {
            const R = 6371, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLng = ((b.lng - a.lng) * Math.PI) / 180;
            const x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
            km += R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
          }
        }
        statsHtml += '<button class="dc-driver-tab' + (selectedDriver === d ? ' active' : '') + '" data-driver="' + d + '" style="' + (selectedDriver === d ? 'border-bottom-color:' + c : '') + '"><span class="dc-dot" style="background:' + c + '"></span> В' + (d + 1) + ' <span class="dc-tab-count">' + count + ' · ' + (Math.round(km * 10) / 10) + ' км</span></button>';
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

    // Orders list
    let listHtml = '';
    const displayOrders = orders.map(function (o, i) { return Object.assign({}, o, { globalIndex: i }); });
    const filtered = selectedDriver !== null ? displayOrders.filter(function (o) { return assignments && assignments[o.globalIndex] === selectedDriver; }) : displayOrders;

    if (filtered.length > 0) {
      filtered.forEach(function (order) {
        const dIdx = assignments ? assignments[order.globalIndex] : -1;
        const color = dIdx >= 0 ? COLORS[dIdx % COLORS.length] : '';
        const isFailed = !order.geocoded && order.error;
        const isEditing = editingOrderId === order.id;
        const isPlacing = placingOrderId === order.id;
        const safeId = order.id.replace(/[^a-zA-Z0-9\-]/g, '');

        listHtml += '<div class="dc-order-item' + (isFailed ? ' failed' : '') + (isPlacing ? ' placing' : '') + '" style="' + (dIdx >= 0 ? 'border-left-color:' + color : '') + '">';
        listHtml += '<div class="dc-order-num" style="' + (dIdx >= 0 ? 'background:' + color + ';color:#fff' : (isFailed ? 'background:#ef4444;color:#fff' : '')) + '">' + (order.globalIndex + 1) + '</div>';
        listHtml += '<div class="dc-order-info"><div class="dc-order-addr">' + order.address + '</div>';
        if (order.timeSlot || order.phone) {
          listHtml += '<div class="dc-order-meta">';
          if (order.timeSlot) listHtml += '<span>⏰ ' + order.timeSlot + '</span> ';
          if (order.phone) listHtml += '<span>📞 ' + order.phone + '</span>';
          listHtml += '</div>';
        }
        if (order.formattedAddress) listHtml += '<div class="dc-order-faddr">📍 ' + order.formattedAddress + '</div>';
        listHtml += '</div>';

        // Actions
        if (isFailed) {
          listHtml += '<div class="dc-order-actions">';
          listHtml += '<button class="btn btn-outline btn-sm dc-edit-btn" data-id="' + order.id + '" title="Изменить адрес">✎</button>';
          listHtml += '<button class="btn btn-outline btn-sm dc-place-btn" data-id="' + order.id + '" title="Поставить на карте">📍</button>';
          listHtml += '<button class="btn btn-outline btn-sm dc-del-btn" data-id="' + order.id + '" title="Удалить">✕</button>';
          listHtml += '</div>';
        } else {
          listHtml += '<div class="dc-order-actions">';
          listHtml += '<span class="dc-status-ok">✓</span>';
          listHtml += '<button class="btn btn-outline btn-sm dc-del-btn" data-id="' + order.id + '" title="Удалить" style="opacity:0.3">✕</button>';
          listHtml += '</div>';
        }
        listHtml += '</div>';

        // Edit row
        if (isEditing) {
          listHtml += '<div class="dc-edit-row"><input class="dc-edit-input" id="dcEditInput-' + safeId + '" value="' + order.address.replace(/"/g, '&quot;') + '" placeholder="Новый адрес..."><button class="btn btn-primary btn-sm dc-retry-btn" data-id="' + order.id + '">Найти</button><button class="btn btn-outline btn-sm dc-cancel-edit" data-id="' + order.id + '">✕</button></div>';
        }
        if (isPlacing) {
          listHtml += '<div class="dc-edit-row" style="color:var(--accent);font-size:12px;">👆 Кликните на карту <button class="btn btn-outline btn-sm dc-cancel-place">Отмена</button></div>';
        }
      });
    } else if (orders.length === 0) {
      listHtml = '<div class="dc-empty">Вставьте адреса и нажмите «На карту»</div>';
    }

    sidebar.innerHTML =
      '<div class="dc-section"><div class="dc-section-title">Ввод адресов</div>' +
      '<textarea id="dcAddressInput" class="dc-textarea" placeholder="' + (orders.length > 0 ? 'Дополнительные адреса → «+ Добавить»' : 'Вставьте адреса, каждый с новой строки\\nФормат: адрес [TAB] телефон [TAB] время') + '" ' + (isGeocoding ? 'disabled' : '') + '></textarea>' +
      (orders.length > 0 ? '<div class="dc-info">Загружено: <strong>' + orders.length + '</strong> (найдено: ' + geocodedCount + (failedCount > 0 ? ', ошибок: ' + failedCount : '') + ')</div>' : '') +
      '</div>' +
      '<div class="dc-section"><div class="dc-controls">' +
      '<div class="dc-control-group"><label>Водителей</label><input type="number" id="dcDriverCount" class="dc-count-input" min="1" max="12" value="' + driverCount + '"></div>' +
      '<div class="dc-buttons">' +
      (orders.length === 0
        ? '<button class="btn btn-primary dc-btn-load" ' + (isGeocoding ? 'disabled' : '') + '>' + (isGeocoding ? '<span id="dcProgress">...</span>' : 'На карту') + '</button>'
        : '<button class="btn btn-primary dc-btn-append" ' + (isGeocoding ? 'disabled' : '') + '>' + (isGeocoding ? '<span id="dcProgress">...</span>' : '+ Добавить') + '</button><button class="btn btn-outline btn-sm dc-btn-replace" ' + (isGeocoding ? 'disabled' : '') + '>Заменить всё</button>'
      ) +
      (geocodedCount > 0 ? '<button class="btn btn-primary dc-btn-distribute" style="background:var(--accent);border-color:#0a3d31;color:#04211b;">Распределить</button>' : '') +
      (orders.length > 0 ? '<button class="btn btn-outline btn-sm dc-btn-clear" style="color:var(--danger);border-color:var(--danger);">Сбросить данные</button>' : '') +
      '</div></div></div>' +
      variantsHtml + statsHtml +
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
  function onSectionActivated() {
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
