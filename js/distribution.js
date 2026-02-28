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
  const DISTRIBUTION_STATE_TABLE = 'distribution_state';
  const SUPPLIER_ALIASES_KEY = 'dc_supplier_aliases';
  const PARTNER_ALIASES_KEY = 'dc_partner_aliases';

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
  let _hoverMapHighlightPm = null;
  let _hoveredOrderPlacemark = null;
  let placingOrderId = null;
  let editingOrderId = null;
  let _cloudSaveTimer = null;
  let _cloudPullTimer = null;
  let _cloudRealtimeChannel = null;
  let _cloudTableMissing = false;
  let _isApplyingCloudState = false;
  let _allowEmptyCloudWriteUntil = 0;
  let _lastAppliedCloudTs = 0;
  let _lastLocalMutationTs = 0;
  let _selectedOrderIds = {};
  let _mapSelectMode = false;
  let _lastSavedStateSig = '';
  let _autoCompletedDateKey = '';
  let _yesterdayCompletedKey = '';
  let _dayRolloverCheckTimer = null;

  // Водители из БД
  let dbDrivers = [];
  // Поставщики из БД (кэш)
  let dbSuppliers = [];
  // Партнеры из БД (кэш)
  let dbPartners = [];
  // Локальные алиасы: введенное имя (compact) -> supplier.id
  let supplierAliases = {};
  // Локальные алиасы: введенное имя (compact) -> partner.id
  let partnerAliases = {};
  // Черновики полей вставки (чтобы не терялись при авто-обновлениях)
  let supplierInputDraft = '';
  let partnerInputDraft = '';
  let addressInputDraft = '';
  let isLoadingSuppliers = false;
  let isLoadingPartners = false;
  // Привязка цвет-индекс → driver_id (driverSlots[0] = driver_id для цвета 0)
  let driverSlots = [];
  // Collapsed/expanded state for sidebar lists
  let _supplierListOpen = true;
  let _partnerListOpen = true;
  let _addressListOpen = true;
  let _driversListOpen = true;
  // Hide assigned toggle
  let _hideAssigned = false;
  let _hideConfirmed = false;
  // Supplier telegram filter: all | sent | unsent
  let _supplierTelegramFilter = 'all';
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

  // ─── Load partners from DB ────────────────────────────────
  async function loadDbPartners() {
    try {
      if (window.PartnersDB && window.PartnersDB.getAllWithId) {
        dbPartners = await window.PartnersDB.getAllWithId();
        return;
      }
      var client = getSupabaseClient();
      if (!client) { dbPartners = []; return; }
      var resp = await client.from('partners').select('*').order('name', { ascending: true });
      if (resp.error) throw resp.error;
      dbPartners = resp.data || [];
    } catch (e) {
      console.warn('Failed to load partners:', e);
      dbPartners = [];
    }
  }

  // ─── Load supplier orders (items from 1C) ─────────────────
  var _supplierOrdersCache = {};
  var _itemsPollTimer = null;

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

  function dateKeyLocal(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  async function clearSupplierItemsForOrder(order) {
    if (!order || !order.isSupplier) return;
    var client = getSupabaseClient();
    if (!client) return;
    var today = dateKeyLocal(new Date());
    var candidates = [];
    [order.sourceSupplierName, order.supplierName, order.address, order.supplierData && order.supplierData.name].forEach(function (n) {
      if (!n) return;
      var c = compactName(n);
      if (!c) return;
      if (candidates.indexOf(c) === -1) candidates.push(c);
    });
    if (candidates.length === 0) return;

    try {
      var resp = await client
        .from('supplier_orders')
        .select('id, supplier_name')
        .eq('order_date', today);
      if (resp.error) {
        console.warn('supplier_orders select error:', resp.error);
        return;
      }
      var ids = (resp.data || [])
        .filter(function (row) { return candidates.indexOf(compactName(row.supplier_name || '')) !== -1; })
        .map(function (row) { return row.id; });
      if (ids.length === 0) return;
      var delResp = await client
        .from('supplier_orders')
        .delete()
        .in('id', ids);
      if (delResp.error) console.warn('supplier_orders delete error:', delResp.error);
    } catch (e) {
      console.warn('clearSupplierItemsForOrder error:', e);
    }
  }

  // Refresh items from DB + update orders that now have items
  async function refreshSupplierItems() {
    var prevCache = JSON.stringify(_supplierOrdersCache);
    await loadSupplierOrders();
    if (JSON.stringify(_supplierOrdersCache) === prevCache) return;

    var updated = false;
    var autoSendOrderIds = [];
    orders.forEach(function (order) {
      if (!order.isSupplier) return;
      var items = getSupplierItems(order.supplierName || order.address);
      if (!items.length && order.supplierData) items = getSupplierItems(order.supplierData.name);
      var newItems = items.length > 0 ? items.join('\n') : null;
      if (newItems && newItems !== order.items1c) {
        order.items1c = newItems;
        if (order.telegramSent) {
          // Mark as unsent when items changed after telegram send
          order.itemsSent = order.itemsSentText === newItems;
          // Auto-send refreshed items for active supplier statuses
          if (!order.itemsSent && order.telegramChatId && (order.telegramStatus === 'sent' || order.telegramStatus === 'confirmed')) {
            autoSendOrderIds.push(order.id);
          }
        }
        updated = true;
      }
    });
    if (updated) {
      renderAll();
    }
    // Auto-send new 1C items (no toast spam) for suppliers already sent to Telegram
    for (var i = 0; i < autoSendOrderIds.length; i++) {
      try {
        await sendItemsToDriver(autoSendOrderIds[i], { silent: true, auto: true, skipRefresh: true });
      } catch (e) {
        console.warn('auto send items error:', e);
      }
    }
  }

  function startItemsPolling() {
    stopItemsPolling();
    _itemsPollTimer = setInterval(function () {
      if (orders.some(function (o) { return o.isSupplier; })) {
        refreshSupplierItems();
      } else {
        stopItemsPolling();
      }
    }, 30000);
  }

  function stopItemsPolling() {
    if (_itemsPollTimer) { clearInterval(_itemsPollTimer); _itemsPollTimer = null; }
  }

  // Strip organizational form and quotes: ООО "Название" → Название
  function stripOrgForm(s) {
    var cleaned = String(s || '');
    // Remove legal form prefixes (short and full forms), including "Частное предприятие".
    var prev;
    do {
      prev = cleaned;
      cleaned = cleaned.replace(/^\s*(?:общество\s+с\s+ограниченной\s+ответственностью|частное\s+предприятие|частное\s+унитарное\s+предприятие|частное\s+торговое\s+унитарное\s+предприятие|частное\s+производственное\s+унитарное\s+предприятие|индивидуальный\s+предприниматель|закрытое\s+акционерное\s+общество|открытое\s+акционерное\s+общество|публичное\s+акционерное\s+общество|акционерное\s+общество|ООО|ОДО|ЧУП|УП|ИП|ЗАО|ОАО|ПАО|АО|ЧТУП|СООО|ИООО|ЧП|СП|ФГУП|МУП)\s*/i, '');
    } while (cleaned !== prev);
    // If quoted company name exists, prefer it over any trailing service text.
    var quotedMatch = cleaned.match(/[«»""\"\"''\'\'„"‟❝❞⹂〝〞〟＂]\s*([^«»""\"\"''\'\'„"‟❝❞⹂〝〞〟＂]{2,}?)\s*[«»""\"\"''\'\'„"‟❝❞⹂〝〞〟＂]/);
    if (quotedMatch && quotedMatch[1]) cleaned = quotedMatch[1];
    do {
      prev = cleaned;
      cleaned = cleaned.replace(/^\s*[«»""\"\"''\'\'„"‟❝❞⹂〝〞〟＂]+\s*/g, '');
    } while (cleaned !== prev);
    // Remove all types of quotes
    cleaned = cleaned.replace(/[«»""\"\"''\'\'„"‟❝❞⹂〝〞〟＂]/g, '');
    return cleaned.trim();
  }

  // Extract time slot from supplier line: "Название до 14" → { name: "Название", timeSlot: "до 14" }
  function extractSupplierTimeSlot(line) {
    var normalizedLine = String(line || '')
      // Handle glued suffixes like: ООО "Триовист"после 15
      .replace(/([«»""\"\"''\'\'„"‟❝❞⹂〝〞〟＂])(?=(?:до|после|с)\s+\d)/ig, '$1 ');
    var timeMatch = normalizedLine.match(/\s+(до\s+\d{1,2}(?:[:.]\d{2})?|после\s+\d{1,2}(?:[:.]\d{2})?|с\s+\d{1,2}(?:[:.]\d{2})?\s*(?:до|[-–])\s*\d{1,2}(?:[:.]\d{2})?)\s*$/i);
    if (timeMatch) {
      return {
        name: normalizedLine.substring(0, timeMatch.index).trim(),
        timeSlot: timeMatch[1].trim(),
      };
    }
    return { name: normalizedLine.trim(), timeSlot: null };
  }

  // Normalize for display: lowercase, collapse spaces
  function normalizeName(s) {
    return s.toLowerCase().replace(/ё/g, 'е').replace(/[«»"""''\"\'„"‟❝❞⹂〝〞〟＂]/g, '').replace(/\s+/g, ' ').trim();
  }

  // Compact string for comparison: strip org form, quotes, ALL spaces, punctuation → single slug
  function compactName(s) {
    var c = String(s || '').toLowerCase();
    var prev;
    do {
      prev = c;
      // Remove full and short legal forms at start (can be repeated with quotes/spaces).
      c = c.replace(/^\s*(?:общество\s+с\s+ограниченной\s+ответственностью|частное\s+предприятие|частное\s+унитарное\s+предприятие|частное\s+торговое\s+унитарное\s+предприятие|частное\s+производственное\s+унитарное\s+предприятие|индивидуальный\s+предприниматель|закрытое\s+акционерное\s+общество|открытое\s+акционерное\s+общество|публичное\s+акционерное\s+общество|акционерное\s+общество|ооо|одо|чуп|уп|ип|зао|оао|пао|ао|чтуп|сооо|иооо|чп|сп|фгуп|муп)\s*/i, '');
    } while (c !== prev);
    // If quoted company name exists, match by this core name only.
    var coreQuoted = c.match(/[«»"""''\"\'„"‟❝❞⹂〝〞〟＂]\s*([^«»"""''\"\'„"‟❝❞⹂〝〞〟＂]{2,}?)\s*[«»"""''\"\'„"‟❝❞⹂〝〞〟＂]/);
    if (coreQuoted && coreQuoted[1]) c = coreQuoted[1];
    do {
      prev = c;
      c = c.replace(/^\s*[«»"""''\"\'„"‟❝❞⹂〝〞〟＂]+\s*/g, '');
    } while (c !== prev);
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

    // 0. User-linked alias match (persists between sessions)
    var aliasSupplierId = supplierAliases[n];
    if (aliasSupplierId != null) {
      var aliasMatch = dbSuppliers.find(function (s) { return String(s.id) === String(aliasSupplierId); });
      if (aliasMatch) return aliasMatch;
    }

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

  function loadSupplierAliases() {
    try {
      var raw = localStorage.getItem(SUPPLIER_ALIASES_KEY);
      supplierAliases = raw ? JSON.parse(raw) : {};
    } catch (e) {
      supplierAliases = {};
    }
  }

  function saveSupplierAliases() {
    try {
      localStorage.setItem(SUPPLIER_ALIASES_KEY, JSON.stringify(supplierAliases));
    } catch (e) { /* ignore */ }
  }

  function rememberSupplierAlias(inputName, supplier) {
    if (!inputName || !supplier || supplier.id == null) return;
    var key = compactName(inputName);
    if (!key || key.length < 2) return;
    supplierAliases[key] = supplier.id;
    saveSupplierAliases();
  }

  function loadPartnerAliases() {
    try {
      var raw = localStorage.getItem(PARTNER_ALIASES_KEY);
      partnerAliases = raw ? JSON.parse(raw) : {};
    } catch (e) {
      partnerAliases = {};
    }
  }

  function savePartnerAliases() {
    try {
      localStorage.setItem(PARTNER_ALIASES_KEY, JSON.stringify(partnerAliases));
    } catch (e) { /* ignore */ }
  }

  function rememberPartnerAlias(inputName, partner) {
    if (!inputName || !partner || partner.id == null) return;
    var key = compactName(inputName);
    if (!key || key.length < 2) return;
    partnerAliases[key] = partner.id;
    savePartnerAliases();
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

  // Find partner in DB by name (manual linking support)
  function findPartnerInDb(name) {
    var n = compactName(name);
    if (!n || n.length < 2) return null;

    var aliasPartnerId = partnerAliases[n];
    if (aliasPartnerId != null) {
      var aliasMatch = dbPartners.find(function (p) { return String(p.id) === String(aliasPartnerId); });
      if (aliasMatch) return aliasMatch;
    }

    var exact = dbPartners.find(function (p) { return compactName(p.name) === n; });
    if (exact) return exact;

    var partial = dbPartners.find(function (p) {
      var pn = compactName(p.name);
      if (!pn) return false;
      var longer = Math.max(pn.length, n.length);
      var shorter = Math.min(pn.length, n.length);
      if (shorter / longer < 0.7) return false;
      return pn.includes(n) || n.includes(pn);
    });
    if (partial) return partial;
    return null;
  }

  // Search partners for autocomplete (returns top N matches)
  function searchPartners(query, limit) {
    var q = compactName(query);
    if (!q || q.length < 1) return [];
    var results = [];
    for (var i = 0; i < dbPartners.length; i++) {
      var p = dbPartners[i];
      var pn = compactName(p.name);
      if (pn.includes(q)) {
        results.push(p);
        if (results.length >= (limit || 8)) break;
      }
    }
    return results;
  }

  async function findPartnerInDbRemote(name) {
    var query = (name || '').trim();
    if (!query) return null;
    var client = getSupabaseClient();
    if (!client) return null;
    try {
      var resp = await client
        .from('partners')
        .select('*')
        .ilike('name', '%' + query + '%')
        .limit(25);
      if (resp.error) return null;
      var rows = resp.data || [];
      if (!rows.length) return null;
      var key = compactName(query);
      var exact = rows.find(function (p) { return compactName(p.name || '') === key; });
      if (exact) return exact;
      var partial = rows.find(function (p) {
        var pn = compactName(p.name || '');
        return pn && (pn.indexOf(key) !== -1 || key.indexOf(pn) !== -1);
      });
      return partial || rows[0] || null;
    } catch (e) {
      return null;
    }
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

  function markLocalMutation() {
    _lastLocalMutationTs = Date.now();
  }

  function pruneSelectedOrders() {
    var alive = {};
    orders.forEach(function (o) { alive[o.id] = true; });
    Object.keys(_selectedOrderIds).forEach(function (id) {
      if (!alive[id]) delete _selectedOrderIds[id];
    });
  }

  function toggleSelectedOrder(orderId, forceValue) {
    if (!orderId) return;
    if (typeof forceValue === 'boolean') {
      _selectedOrderIds[orderId] = forceValue;
    } else {
      _selectedOrderIds[orderId] = !_selectedOrderIds[orderId];
    }
  }

  function getDriverFullName(slotIdx) {
    const driverId = driverSlots[slotIdx];
    if (!driverId) return 'Водитель ' + (slotIdx + 1);
    const d = dbDrivers.find(function (dr) { return dr.id === driverId; });
    return d ? d.name : 'Водитель ' + (slotIdx + 1);
  }

  // ─── Persistence (localStorage + Supabase cloud state) ────
  function getStateDateKey() {
    return new Date().toISOString().split('T')[0];
  }

  function buildStateSnapshot() {
    return {
      orders: orders,
      assignments: assignments,
      driverCount: driverCount,
      activeVariant: activeVariant,
      driverSlots: driverSlots,
      poiCoords: poiCoords,
      updatedAt: Date.now(),
      schemaVersion: 1,
    };
  }

  function buildStateSignature() {
    return JSON.stringify({
      orders: orders,
      assignments: assignments,
      driverCount: driverCount,
      activeVariant: activeVariant,
      driverSlots: driverSlots,
      poiCoords: poiCoords,
      schemaVersion: 1,
    });
  }

  function applyStateSnapshot(data) {
    if (!data || !Array.isArray(data.orders)) return false;
    orders = data.orders;
    assignments = data.assignments || null;
    driverCount = data.driverCount || 3;
    activeVariant = data.activeVariant != null ? data.activeVariant : -1;
    driverSlots = data.driverSlots || [];
    poiCoords = data.poiCoords || {};
    while (driverSlots.length < driverCount) driverSlots.push(null);
    if (assignments && orders.length > 0) {
      variants = window.DistributionAlgo.generateVariants(orders, driverCount);
    } else {
      variants = [];
      activeVariant = -1;
    }
    _lastSavedStateSig = buildStateSignature();
    return true;
  }

  function readLocalState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.orders)) return null;
      return data;
    } catch (e) {
      console.warn('localStorage load error:', e);
      return null;
    }
  }

  async function loadCloudState() {
    var client = getSupabaseClient();
    if (!client || _cloudTableMissing) return null;
    try {
      var routeDate = getStateDateKey();
      var resp = await client
        .from(DISTRIBUTION_STATE_TABLE)
        .select('state_json, updated_at')
        .eq('state_date', routeDate)
        .limit(1)
        .maybeSingle();
      if (resp.error) {
        if (resp.error.code === '42P01') _cloudTableMissing = true;
        return null;
      }
      if (!resp.data || !resp.data.state_json) return null;
      var ts = Date.parse(resp.data.updated_at || '') || 0;
      return { state: resp.data.state_json, updatedAt: ts };
    } catch (e) {
      console.warn('Cloud state load error:', e);
      return null;
    }
  }

  async function saveCloudState(snapshot) {
    var client = getSupabaseClient();
    if (!client || _cloudTableMissing) return;
    // Safety: do not overwrite shared cloud state with an accidental empty payload.
    if ((!snapshot.orders || snapshot.orders.length === 0) && Date.now() > _allowEmptyCloudWriteUntil) {
      return;
    }
    try {
      var routeDate = getStateDateKey();
      var resp = await client
        .from(DISTRIBUTION_STATE_TABLE)
        .upsert({
          state_date: routeDate,
          state_json: snapshot,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'state_date' });
      if (resp.error && resp.error.code === '42P01') {
        _cloudTableMissing = true;
      }
    } catch (e) {
      console.warn('Cloud state save error:', e);
    }
  }

  function scheduleCloudStateSave(snapshot) {
    clearTimeout(_cloudSaveTimer);
    _cloudSaveTimer = setTimeout(function () {
      saveCloudState(snapshot);
    }, 1200);
  }

  function flushCloudStateSave() {
    clearTimeout(_cloudSaveTimer);
    var snap = buildStateSnapshot();
    if (snap.orders && snap.orders.length > 0) {
      saveCloudState(snap);
    }
  }

  async function clearCloudState() {
    var client = getSupabaseClient();
    if (!client || _cloudTableMissing) return;
    try {
      var routeDate = getStateDateKey();
      var resp = await client
        .from(DISTRIBUTION_STATE_TABLE)
        .delete()
        .eq('state_date', routeDate);
      if (resp.error && resp.error.code === '42P01') {
        _cloudTableMissing = true;
      }
    } catch (e) {
      console.warn('Cloud state clear error:', e);
    }
  }

  function saveState() {
    try {
      var sig = buildStateSignature();
      if (sig === _lastSavedStateSig) return;
      _lastSavedStateSig = sig;
      var data = buildStateSnapshot();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      if (!_isApplyingCloudState) {
        scheduleCloudStateSave(data);
      }
    } catch (e) {
      console.warn('localStorage save error:', e);
    }
  }

  function loadState() {
    var local = readLocalState();
    return local ? applyStateSnapshot(local) : false;
  }

  async function loadBestAvailableState() {
    var local = readLocalState();
    var cloud = await loadCloudState();
    // Cloud is the source of truth across computers.
    if (cloud && cloud.state) {
      if (applyStateSnapshot(cloud.state)) {
        _lastAppliedCloudTs = cloud.updatedAt || 0;
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cloud.state)); } catch (e) { /* ignore */ }
        return true;
      }
    }
    if (local) return applyStateSnapshot(local);
    return false;
  }

  async function pullCloudStateIfNewer(silent) {
    if (_cloudTableMissing || _isApplyingCloudState) return;
    if (Date.now() - _lastLocalMutationTs < 3500) return;
    if (editingOrderId || placingOrderId || isGeocoding) return;
    var ae = document.activeElement;
    if (ae && (ae.id === 'dcSupplierInput' || ae.id === 'dcAddressInput' || ae.id === 'dcPartnerInput')) return;

    var cloud = await loadCloudState();
    var cloudTs = cloud && cloud.updatedAt ? Number(cloud.updatedAt) : 0;

    // Safety: never auto-replace non-empty local work with empty cloud payload.
    var local = readLocalState();
    if (local && Array.isArray(local.orders) && local.orders.length > 0 &&
        cloud && cloud.state && Array.isArray(cloud.state.orders) && cloud.state.orders.length === 0) {
      return;
    }

    if (!cloud || !cloud.state || cloudTs <= _lastAppliedCloudTs) return;
    if (!applyStateSnapshot(cloud.state)) return;
    _lastAppliedCloudTs = cloudTs;

    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cloud.state)); } catch (e) { /* ignore */ }

    _isApplyingCloudState = true;
    try {
      renderAll();
      if (!silent) showToast('Данные распределения обновлены из облака');
    } finally {
      _isApplyingCloudState = false;
    }
  }

  function startCloudStatePolling() {
    stopCloudStatePolling();
    pullCloudStateIfNewer(true);
    _cloudPullTimer = setInterval(function () {
      if (document.hidden) return;
      var section = document.getElementById('distributionSection');
      if (!section || section.offsetParent === null) return;
      pullCloudStateIfNewer(true);
    }, 5000);
  }

  function stopCloudStatePolling() {
    if (_cloudPullTimer) {
      clearInterval(_cloudPullTimer);
      _cloudPullTimer = null;
    }
  }

  function startCloudRealtimeSync() {
    stopCloudRealtimeSync();
    var client = getSupabaseClient();
    if (!client || _cloudTableMissing) return;
    var routeDate = getStateDateKey();
    try {
      _cloudRealtimeChannel = client
        .channel('dc_distribution_state_' + routeDate)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: DISTRIBUTION_STATE_TABLE,
          filter: 'state_date=eq.' + routeDate
        }, function () {
          if (document.hidden) return;
          pullCloudStateIfNewer(true);
        })
        .subscribe();
    } catch (e) {
      console.warn('Cloud realtime subscribe error:', e);
    }
  }

  function stopCloudRealtimeSync() {
    var client = getSupabaseClient();
    if (_cloudRealtimeChannel && client && client.removeChannel) {
      try { client.removeChannel(_cloudRealtimeChannel); } catch (e) { /* ignore */ }
    }
    _cloudRealtimeChannel = null;
  }

  function clearState() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    clearTimeout(_cloudSaveTimer);
    _allowEmptyCloudWriteUntil = Date.now() + 5000;
    clearCloudState();
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      flushCloudStateSave();
      stopCloudStatePolling();
      stopCloudRealtimeSync();
    } else {
      startCloudStatePolling();
      startCloudRealtimeSync();
    }
  });
  window.addEventListener('beforeunload', function () {
    flushCloudStateSave();
  });

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

  function clearMapOrderHighlight() {
    if (_hoveredOrderPlacemark && _hoveredOrderPlacemark.options) {
      try {
        _hoveredOrderPlacemark.options.set('zIndex', null);
      } catch (e) { /* ignore */ }
    }
    _hoveredOrderPlacemark = null;

    if (_hoverMapHighlightPm && mapInstance) {
      try { mapInstance.geoObjects.remove(_hoverMapHighlightPm); } catch (e) { /* ignore */ }
    }
    _hoverMapHighlightPm = null;
  }

  function highlightMapOrder(orderId) {
    if (!mapInstance || !orderId) return;

    clearMapOrderHighlight();

    var pm = null;
    for (var i = 0; i < placemarks.length; i++) {
      if (placemarks[i] && placemarks[i].__orderId === orderId) {
        pm = placemarks[i];
        break;
      }
    }
    if (!pm || !pm.geometry || !pm.geometry.getCoordinates) return;

    _hoveredOrderPlacemark = pm;
    try { pm.options.set('zIndex', 5000); } catch (e) { /* ignore */ }

    var coords = pm.geometry.getCoordinates();
    var ringLayout = ymaps.templateLayoutFactory.createClass(
      '<div style="width:40px;height:40px;border-radius:50%;border:3px solid #22d3ee;box-shadow:0 0 0 4px rgba(34,211,238,0.22);background:rgba(34,211,238,0.08);pointer-events:none;"></div>'
    );
    _hoverMapHighlightPm = new ymaps.Placemark(coords, {}, {
      iconLayout: ringLayout,
      iconOffset: [-20, -20],
      iconShape: { type: 'Circle', coordinates: [20, 20], radius: 20 },
      zIndex: 4999,
    });
    mapInstance.geoObjects.add(_hoverMapHighlightPm);
  }

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
    clearMapOrderHighlight();

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
      if (!o.isSupplier && !o.isPartner && !o.isPoi) _addrNum[o.id] = _addrCounter++;
    });

    var bounds = [];
    var renderedByOverlap = {};
    var overlapAnchors = {};
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
      if (_hideConfirmed && order.isSupplier && (order.telegramStatus === 'confirmed' || order.telegramStatus === 'picked_up')) return;
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
      var displayNum = order.isSupplier ? 'П' : (order.isPartner ? 'ПР' : (_addrNum[order.id] || (globalIdx + 1)));
      var hintHtml = '<b>' + displayNum + '. ' + order.address + '</b>' +
        (overlapCount > 1 ? '<br><span style="color:#f97316;font-size:11px;">📌 ' + overlapCount + ' точки в одном месте</span>' : '') +
        (order.isSupplier ? '<br><span style="color:#10b981;font-size:11px;">Поставщик</span>' : '') +
        (order.isPartner ? '<br><span style="color:#f97316;font-size:11px;">Партнёр</span>' : '') +
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
      } else if (order.isPartner) {
        // Partner: rounded square marker
        var partnerColor = !isUnassigned ? color : '#e0e0e0';
        var partnerOpacity = isVisible ? 1 : 0.25;
        var partnerTextColor = !isUnassigned ? '#fff' : '#333';
        var partnerBorder = !isUnassigned ? '2px solid rgba(255,255,255,.9)' : '2px solid #888';
        var partnerHtml = '<div style="width:26px;height:26px;border-radius:7px;background:' + partnerColor + ';display:flex;align-items:center;justify-content:center;box-shadow:0 2px 5px rgba(0,0,0,.35);border:' + partnerBorder + ';opacity:' + partnerOpacity + ';">' +
          '<span style="color:' + partnerTextColor + ';font-size:9px;font-weight:800;">ПР</span></div>';
        var partnerLayout = ymaps.templateLayoutFactory.createClass(partnerHtml);
        pm = new ymaps.Placemark([plat, plng], {
          balloonContentBody: buildBalloon(order, globalIdx, driverIdx),
          hintContent: hintHtml,
        }, {
          iconLayout: partnerLayout,
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
        pm.events.add('click', function (e) {
          if (!_mapSelectMode) return;
          try { e.preventDefault(); } catch (err) { /* ignore */ }
          toggleSelectedOrder(orderId);
          renderAll();
          showToast('Выбор на карте: ' + (Object.keys(_selectedOrderIds).filter(function (id) { return _selectedOrderIds[id]; }).length));
        });
      })(order.id);

      pm.__orderId = order.id;
      mapInstance.geoObjects.add(pm);
      placemarks.push(pm);
      bounds.push([plat, plng]);
      var orderOverlapKey = overlapKey(order);
      renderedByOverlap[orderOverlapKey] = (renderedByOverlap[orderOverlapKey] || 0) + 1;
      if (!overlapAnchors[orderOverlapKey]) {
        overlapAnchors[orderOverlapKey] = [order.lat, order.lng];
      }

      // Selection ring for map-selection mode
      if (_selectedOrderIds[order.id]) {
        var selRingHtml = '<div style="width:34px;height:34px;border-radius:50%;border:3px solid #22c55e;box-shadow:0 0 0 2px rgba(34,197,94,.35);background:rgba(34,197,94,.08);pointer-events:none;"></div>';
        var selLayout = ymaps.templateLayoutFactory.createClass(selRingHtml);
        var selRing = new ymaps.Placemark([plat, plng], {}, {
          iconLayout: selLayout,
          iconOffset: [-17, -17],
          iconShape: { type: 'Circle', coordinates: [17, 17], radius: 17 },
          zIndex: 4500,
        });
        mapInstance.geoObjects.add(selRing);
        placemarks.push(selRing);
      }

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

    // Overlap count badge (one compact number per place with 2+ visible points)
    Object.keys(renderedByOverlap).forEach(function (k) {
      var count = renderedByOverlap[k];
      if (count < 2) return;
      var anchor = overlapAnchors[k];
      if (!anchor) return;
      var badgeHtml = '<div style="min-width:15px;height:15px;padding:0 4px;border-radius:999px;background:rgba(17,24,39,.92);border:1px solid rgba(255,255,255,.65);color:#fff;font-size:10px;font-weight:700;line-height:13px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.4);pointer-events:none;">' + count + '</div>';
      var badgeLayout = ymaps.templateLayoutFactory.createClass(badgeHtml);
      var badgePm = new ymaps.Placemark(anchor, {}, {
        iconLayout: badgeLayout,
        iconOffset: [-8, -31],
        iconShape: { type: 'Circle', coordinates: [0, 0], radius: 0 },
        zIndex: 4600,
      });
      mapInstance.geoObjects.add(badgePm);
      placemarks.push(badgePm);
    });

    // Don't change map zoom/center automatically when points change.
    // Just reset the flag so future renders behave normally.
    if (_fitBoundsNext && bounds.length > 0) {
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
    markLocalMutation();
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
    markLocalMutation();
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

  function bulkAssignSelectedToDriver(driverId) {
    var selectedIds = Object.keys(_selectedOrderIds).filter(function (id) { return _selectedOrderIds[id]; });
    if (selectedIds.length === 0) {
      showToast('Сначала выберите точки');
      return;
    }
    markLocalMutation();
    var affected = {};
    var assignedCount = 0;
    selectedIds.forEach(function (oid) {
      var idx = orders.findIndex(function (o) { return o.id === oid; });
      if (idx < 0) return;
      var order = orders[idx];
      var oldDriverId = getOrderDriverId(idx);
      var normalizedDriverId = driverId;
      if (driverId != null && dbDrivers.length > 0) {
        var match = dbDrivers.find(function (d) { return String(d.id) === String(driverId); });
        normalizedDriverId = match ? match.id : driverId;
      }
      order.assignedDriverId = normalizedDriverId || null;
      if (!normalizedDriverId && assignments && assignments[idx] >= 0) {
        assignments = assignments.slice();
        assignments[idx] = -1;
      }
      if (normalizedDriverId) affected[String(normalizedDriverId)] = true;
      if (oldDriverId && String(oldDriverId) !== String(normalizedDriverId)) affected[String(oldDriverId)] = true;
      assignedCount++;
    });
    activeVariant = -1;
    _selectedOrderIds = {};
    renderAll();
    Object.keys(affected).forEach(function (did) { scheduleSyncDriver(did); });
    showToast('Назначено точек: ' + assignedCount);
  }

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
      if (order.isSupplier) {
        pt.isSupplier = true;
        pt.telegramSent = !!order.telegramSent;
        pt.telegramStatus = order.telegramStatus || null;
        pt.items1c = order.items1c || null;
        pt.itemsSent = !!order.itemsSent;
        pt.itemsSentText = order.itemsSentText || null;
      }
      if (order.isPartner) {
        pt.isPartner = true;
        pt.partnerName = order.partnerName || order.address || null;
      }
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
    addressInputDraft = text;
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
      markLocalMutation();
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
      addressInputDraft = '';
      renderAll();
    }
  }

  // ─── Supplier loading ────────────────────────────────────
  async function loadSuppliers(append) {
    const textarea = $('#dcSupplierInput');
    if (!textarea) return;
    const text = textarea.value.trim();
    supplierInputDraft = textarea.value;
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
    startItemsPolling();

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
      var displayName = name || rawLine;

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
          sourceSupplierName: name,
          address: displayName,
          phone: '',
          timeSlot: timeSlot,
          geocoded: true,
          lat: supplier.lat,
          lng: supplier.lon,
          formattedAddress: supplier.address || (supplier.lat + ', ' + supplier.lon),
          error: null,
          isSupplier: true,
          supplierDbId: supplier.id,
          supplierName: displayName,
          supplierData: supplier,
          items1c: items1c.length > 0 ? items1c.join('\n') : null,
        });
      } else if (supplier && (!supplier.lat || !supplier.lon)) {
        // Found but no coordinates — needs geocoding
        notFound++;
        supplierOrders.push({
          id: 'supplier-' + orderCounter + '-' + i,
          sourceSupplierName: name,
          address: displayName,
          phone: '',
          timeSlot: timeSlot,
          geocoded: false,
          lat: null,
          lng: null,
          formattedAddress: null,
          error: 'Нет координат в базе',
          isSupplier: true,
          supplierDbId: supplier.id,
          supplierName: displayName,
          supplierData: supplier,
          items1c: items1c.length > 0 ? items1c.join('\n') : null,
        });
        needGeocode.push(supplierOrders[supplierOrders.length - 1]);
      } else {
        // Not found in DB — use cleaned name
        notFound++;
        supplierOrders.push({
          id: 'supplier-' + orderCounter + '-' + i,
          sourceSupplierName: name,
          address: displayName,
          phone: '',
          timeSlot: timeSlot,
          geocoded: false,
          lat: null,
          lng: null,
          formattedAddress: null,
          error: 'Не найден в базе',
          isSupplier: true,
          supplierDbId: null,
          supplierName: displayName,
          supplierData: null,
          items1c: items1c.length > 0 ? items1c.join('\n') : null,
        });
      }
    }

    // Add supplier orders immediately so UI shows rows right away.
    // Suppliers without coordinates will appear on map progressively as geocoding resolves.
    orders = orders.concat(supplierOrders);
    markLocalMutation();
    if (prevAssignments) {
      assignments = prevAssignments.slice();
      for (var a = 0; a < supplierOrders.length; a++) assignments.push(-1);
    } else if (!append) {
      // Reset distribution since we replaced suppliers
      assignments = null; variants = []; activeVariant = -1;
    }
    _fitBoundsNext = true;
    renderAll();

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
        renderAll();
      } catch (e) { /* keep as not found */ }
    }

    _fitBoundsNext = true;
    textarea.value = '';
    supplierInputDraft = '';
    showToast('Поставщики: найдено ' + found + (notFound > 0 ? ', не найдено: ' + notFound : ''), notFound > 0 ? 'error' : undefined);
    } catch (err) {
      console.error('loadSuppliers error:', err);
      showToast('Ошибка загрузки поставщиков: ' + err.message, 'error');
    } finally {
      isLoadingSuppliers = false;
      renderAll();
    }
  }

  // ─── Partner loading (manual DB selection flow) ───────────
  async function loadPartners(append) {
    const textarea = $('#dcPartnerInput');
    if (!textarea) return;
    const text = textarea.value.trim();
    partnerInputDraft = textarea.value;
    if (!text) { showToast('Вставьте названия партнёров', 'error'); return; }
    try {
      const names = text.split('\n').map(function (l) { return l.trim(); }).filter(function (l) { return l.length > 0; });
      if (names.length === 0) { showToast('Не найдено партнёров', 'error'); return; }

      isLoadingPartners = true;
      renderAll();
      await loadDbPartners();

      var prevAssignments = append ? assignments : null;
      if (!append) {
        // Replace only partner rows, keep suppliers and addresses
        var keepOrders = [];
        var keepAssignments = [];
        for (var k = 0; k < orders.length; k++) {
          if (!orders[k].isPartner) {
            keepOrders.push(orders[k]);
            if (assignments) keepAssignments.push(assignments[k]);
          }
        }
        orders = keepOrders;
        assignments = keepAssignments.length > 0 ? keepAssignments : null;
        variants = []; activeVariant = -1;
      }

      var partnerOrders = [];
      var orderCounter = Date.now();
      for (var i = 0; i < names.length; i++) {
        var rawLine = names[i].replace(/^\d+[\.):\-\s]+\s*/, '').trim();
        if (!rawLine) continue;
        orderCounter++;
        var partner = findPartnerInDb(rawLine);
        if (!partner) {
          partner = await findPartnerInDbRemote(rawLine);
          if (partner) {
            dbPartners.push(partner);
          }
        }
        if (partner) {
          rememberPartnerAlias(rawLine, partner);
          var plat = parseFloat(partner.lat);
          var plon = parseFloat(partner.lon);
          if (Number.isFinite(plat) && Number.isFinite(plon)) {
            partnerOrders.push({
              id: 'partner-' + orderCounter + '-' + i,
              sourcePartnerName: rawLine,
              partnerName: rawLine,
              address: rawLine,
              phone: '',
              timeSlot: null,
              geocoded: true,
              lat: plat,
              lng: plon,
              formattedAddress: partner.address || (partner.lat + ', ' + partner.lon),
              error: null,
              isPartner: true,
              partnerDbId: partner.id,
              partnerData: partner,
            });
          } else {
            var geocoded = false;
            var lat = null;
            var lng = null;
            var formatted = null;
            var errText = 'Нет координат — выберите точку на карте';
            if (partner.address) {
              try {
                var geo = await window.DistributionGeocoder.geocodeAddress(partner.address);
                lat = geo.lat;
                lng = geo.lng;
                formatted = geo.formattedAddress;
                geocoded = true;
                errText = null;
              } catch (e) { /* keep unresolved */ }
            }
            partnerOrders.push({
              id: 'partner-' + orderCounter + '-' + i,
              sourcePartnerName: rawLine,
              partnerName: rawLine,
              address: rawLine,
              phone: '',
              timeSlot: null,
              geocoded: geocoded,
              lat: lat,
              lng: lng,
              formattedAddress: formatted,
              error: errText,
              isPartner: true,
              partnerDbId: partner.id,
              partnerData: partner,
            });
          }
        } else {
          partnerOrders.push({
            id: 'partner-' + orderCounter + '-' + i,
            sourcePartnerName: rawLine,
            partnerName: rawLine,
            address: rawLine,
            phone: '',
            timeSlot: null,
            geocoded: false,
            lat: null,
            lng: null,
            formattedAddress: null,
            error: 'Не найден в базе — выберите из поиска',
            isPartner: true,
            partnerDbId: null,
            partnerData: null,
          });
        }
      }

      orders = orders.concat(partnerOrders);
      markLocalMutation();
      if (prevAssignments) {
        assignments = prevAssignments.slice();
        for (var a = 0; a < partnerOrders.length; a++) assignments.push(-1);
      } else if (!append) {
        assignments = null; variants = []; activeVariant = -1;
      }

      _fitBoundsNext = true;
      textarea.value = '';
      partnerInputDraft = '';
      var autoLinkedCount = partnerOrders.filter(function (p) { return !!p.partnerDbId; }).length;
      var unresolvedCount = partnerOrders.length - autoLinkedCount;
      showToast('Партнёры добавлены: ' + partnerOrders.length + '. Авто-привязано: ' + autoLinkedCount + (unresolvedCount > 0 ? ', требуется выбор: ' + unresolvedCount : ''));
    } catch (err) {
      console.error('loadPartners error:', err);
      showToast('Ошибка загрузки партнёров: ' + err.message, 'error');
    } finally {
      isLoadingPartners = false;
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

    // Persist manual mapping so next load can auto-match this input
    rememberSupplierAlias(order.sourceSupplierName || order.supplierName || order.address, supplier);

    var keepUserName = order.sourceSupplierName || order.supplierName || order.address || supplier.name;

    order.supplierDbId = supplier.id;
    order.supplierData = supplier;
    // Keep supplier display name as originally pasted from 1C/manual input
    order.supplierName = keepUserName;
    order.address = keepUserName;
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

  // ─── Search & link partner from DB (modal) ────────────────
  var _partnerSearchOrderId = null;

  function openPartnerSearch(orderId) {
    closePartnerSearch();
    var order = orders.find(function (o) { return o.id === orderId; });
    if (!order || !order.isPartner) return;
    _partnerSearchOrderId = orderId;

    var overlay = document.createElement('div');
    overlay.id = 'dcPartnerSearchModal';
    overlay.className = 'dc-search-modal-overlay';

    var modal = document.createElement('div');
    modal.className = 'dc-search-modal';

    var header = document.createElement('div');
    header.className = 'dc-search-modal-header';
    header.innerHTML = '<h3>Поиск партнёра</h3>' +
      '<button class="dc-search-modal-close" title="Закрыть">&times;</button>';

    var searchName = order.partnerName || order.address || '';
    var body = document.createElement('div');
    body.className = 'dc-search-modal-body';
    body.innerHTML =
      '<div class="dc-search-modal-query">Ищем: <strong>' + escapeHtml(order.address) + '</strong></div>' +
      '<input class="dc-search-modal-input" type="text" placeholder="Введите название партнёра..." value="' + escapeHtml(searchName).replace(/"/g, '&quot;') + '" />' +
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
      var matches = searchPartners(q, 15);
      if (matches.length === 0) {
        resultsEl.innerHTML = '<div class="dc-search-modal-hint">Ничего не найдено по запросу &laquo;' + escapeHtml(q) + '&raquo;</div>';
        return;
      }
      resultsEl.innerHTML = '';
      matches.forEach(function (p) {
        var item = document.createElement('div');
        item.className = 'dc-search-modal-item';
        var hasCoords = p.lat && p.lon;
        item.innerHTML =
          '<div class="dc-search-modal-item-name">' + escapeHtml(p.name) + '</div>' +
          (p.address ? '<div class="dc-search-modal-item-addr">' + escapeHtml(p.address) + '</div>' : '') +
          '<div class="dc-search-modal-item-status">' + (hasCoords ? '📍 Есть координаты' : '⚠ Нет координат') + '</div>';
        item.addEventListener('click', function () {
          linkPartnerToOrder(orderId, p);
        });
        resultsEl.appendChild(item);
      });
    }

    input.addEventListener('input', doSearch);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closePartnerSearch();
    });

    header.querySelector('.dc-search-modal-close').addEventListener('click', closePartnerSearch);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closePartnerSearch();
    });

    setTimeout(function () { input.focus(); input.select(); }, 50);
    doSearch();
  }

  function closePartnerSearch() {
    var el = document.getElementById('dcPartnerSearchModal');
    if (el) el.remove();
    _partnerSearchOrderId = null;
  }

  async function linkPartnerToOrder(orderId, partner) {
    var order = orders.find(function (o) { return o.id === orderId; });
    if (!order) return;

    rememberPartnerAlias(order.sourcePartnerName || order.partnerName || order.address, partner);
    var keepUserName = order.sourcePartnerName || order.partnerName || order.address || partner.name;

    order.partnerDbId = partner.id;
    order.partnerData = partner;
    order.partnerName = keepUserName;
    order.address = keepUserName;

    if (partner.lat && partner.lon) {
      order.lat = partner.lat;
      order.lng = partner.lon;
      order.formattedAddress = partner.address || (partner.lat + ', ' + partner.lon);
      order.geocoded = true;
      order.error = null;
    } else if (partner.address) {
      try {
        var geo = await window.DistributionGeocoder.geocodeAddress(partner.address);
        order.lat = geo.lat;
        order.lng = geo.lng;
        order.formattedAddress = geo.formattedAddress;
        order.geocoded = true;
        order.error = null;
      } catch (e) {
        order.geocoded = false;
        order.error = 'Нет координат — поставьте точку на карте';
      }
    } else {
      order.geocoded = false;
      order.error = 'Нет координат — поставьте точку на карте';
    }

    closePartnerSearch();
    _fitBoundsNext = true;
    saveState();
    renderAll();
    showToast('Партнёр привязан: ' + partner.name);

    var orderIdx = orders.findIndex(function (o) { return o.id === orderId; });
    if (orderIdx >= 0) {
      var driverId = getOrderDriverId(orderIdx);
      if (driverId) scheduleSyncDriver(String(driverId));
    }
  }

  // ─── Create partner from distribution ─────────────────────
  function openCreatePartnerModal() {
    if (!window.PartnersModal || !window.PartnersModal.open) {
      showToast('Модуль партнёров не загружен', 'error');
      return;
    }
    window._onPartnerSaved = async function () {
      await loadDbPartners();
      showToast('Партнёр создан');
    };
    window.PartnersModal.open(null);
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

    // For partners: search partner DB first
    if (order && order.isPartner) {
      input.disabled = true;
      await loadDbPartners();
      var partner = findPartnerInDb(addr);
      if (partner && partner.lat && partner.lon) {
        rememberPartnerAlias(addr, partner);
        var partnerDisplayName = (order.sourcePartnerName || order.partnerName || addr || order.address || partner.name);
        orders = orders.map(function (o) {
          if (o.id !== orderId) return o;
          return Object.assign({}, o, {
            address: partnerDisplayName,
            partnerName: partnerDisplayName,
            partnerDbId: partner.id,
            partnerData: partner,
            lat: partner.lat,
            lng: partner.lon,
            formattedAddress: partner.address || (partner.lat + ', ' + partner.lon),
            geocoded: true,
            error: null,
            isPartner: true,
          });
        });
        editingOrderId = null;
        renderAll();
        showToast('Партнёр найден в базе');
        return;
      }
      input.disabled = false;
    }

    // For suppliers: search supplier DB first
    if (order && order.isSupplier) {
      input.disabled = true;
      await loadDbSuppliers(); // refresh DB data
      var supplier = findSupplierInDb(addr);
      if (supplier && supplier.lat && supplier.lon) {
        rememberSupplierAlias(addr, supplier);
        var displayName = (order.sourceSupplierName || order.supplierName || addr || order.address || supplier.name);
        orders = orders.map(function (o) {
          if (o.id !== orderId) return o;
          return Object.assign({}, o, {
            address: displayName,
            lat: supplier.lat,
            lng: supplier.lon,
            formattedAddress: supplier.address || (supplier.lat + ', ' + supplier.lon),
            geocoded: true,
            error: null,
            isSupplier: true,
            supplierDbId: supplier.id,
            supplierName: displayName,
            supplierData: supplier,
          });
        });
        editingOrderId = null;
        renderAll();
        showToast('Поставщик найден в базе');
        return;
      } else if (supplier && (!supplier.lat || !supplier.lon)) {
        rememberSupplierAlias(addr, supplier);
        var displayNameNoCoords = (order.sourceSupplierName || order.supplierName || addr || order.address || supplier.name);
        // Found in DB but no coordinates — try geocoding the DB address
        var geoAddr = supplier.address || addr;
        try {
          var geo = await window.DistributionGeocoder.geocodeAddress(geoAddr);
          orders = orders.map(function (o) {
            if (o.id !== orderId) return o;
            return Object.assign({}, o, {
              address: displayNameNoCoords,
              lat: geo.lat,
              lng: geo.lng,
              formattedAddress: geo.formattedAddress,
              geocoded: true,
              error: null,
              isSupplier: true,
              supplierDbId: supplier.id,
              supplierName: displayNameNoCoords,
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
              address: displayNameNoCoords,
              supplierDbId: supplier.id,
              supplierName: displayNameNoCoords,
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

      // If everything was removed via partial clear, clear shared state explicitly.
      if (orders.length === 0) {
        clearState();
      }

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
        pointData.telegramSent = !!order.telegramSent;
        pointData.telegramStatus = order.telegramStatus || null;
        pointData.items1c = order.items1c || null;
        pointData.itemsSent = !!order.itemsSent;
        pointData.itemsSentText = order.itemsSentText || null;
      }
      if (order.isPartner) {
        pointData.isPartner = true;
        pointData.partnerName = order.partnerName || order.address || null;
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
      if (order.isSupplier) {
        pt.isSupplier = true;
        pt.telegramSent = !!order.telegramSent;
        pt.telegramStatus = order.telegramStatus || null;
        pt.items1c = order.items1c || null;
        pt.itemsSent = !!order.itemsSent;
        pt.itemsSentText = order.itemsSentText || null;
      }
      if (order.isPartner) {
        pt.isPartner = true;
        pt.partnerName = order.partnerName || order.address || null;
      }
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
        pt.telegramSent = !!order.telegramSent;
        pt.telegramStatus = order.telegramStatus || null;
        pt.items1c = order.items1c || null;
        pt.itemsSent = !!order.itemsSent;
        pt.itemsSentText = order.itemsSentText || null;
      }
      if (order.isPartner) {
        pt.isPartner = true;
        pt.partnerName = order.partnerName || order.address || null;
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

  // ─── Finish suppliers only (save as completed trip) ──────
  function showFinishSuppliersDialog() {
    var existing = document.getElementById('dcFinishSuppliersModal');
    if (existing) existing.remove();

    // Count supplier orders per driver (only assigned and geocoded)
    var driverSupplierCounts = {};
    orders.forEach(function (o, idx) {
      if (!o.isSupplier || !o.geocoded || o.isPoi) return;
      var did = getOrderDriverId(idx);
      if (!did) return;
      var key = String(did);
      if (!driverSupplierCounts[key]) driverSupplierCounts[key] = 0;
      driverSupplierCounts[key]++;
    });

    var modal = document.createElement('div');
    modal.id = 'dcFinishSuppliersModal';
    modal.className = 'modal is-open';
    modal.style.cssText = 'z-index:10000;';

    var driverBtns = '';
    dbDrivers.forEach(function (dr, di) {
      var count = driverSupplierCounts[String(dr.id)] || 0;
      if (count === 0) return;
      var c = COLORS[di % COLORS.length];
      var label = dr.name.split(' ')[0];
      driverBtns += '<button class="btn btn-outline dc-finish-sup-driver" data-driver-id="' + dr.id + '" style="display:flex;align-items:center;gap:8px;justify-content:flex-start;width:100%;border-color:#444;">' +
        '<span style="width:12px;height:12px;border-radius:50%;background:' + c + ';flex-shrink:0;"></span>' +
        '<span style="flex:1;text-align:left;">' + escapeHtml(label) + '</span>' +
        '<span style="color:#888;font-size:11px;">' + count + ' пост.</span>' +
        '</button>';
    });

    if (!driverBtns) {
      showToast('Нет поставщиков для завершения', 'error');
      return;
    }

    var totalSuppliers = 0;
    Object.keys(driverSupplierCounts).forEach(function (k) { totalSuppliers += driverSupplierCounts[k]; });

    modal.innerHTML = '<div class="modal-content" style="max-width:420px;">' +
      '<h3 class="modal-title" style="margin-bottom:16px;text-align:center;">Завершить поставщиков</h3>' +
      '<div style="font-size:12px;color:#888;margin-bottom:8px;">Поставщики будут сохранены как завершённый выезд и убраны с карты. Данные останутся в таблице по дате.</div>' +
      '<div style="display:flex;flex-direction:column;gap:6px;">' +
      driverBtns +
      '<div style="border-top:1px solid #333;margin:4px 0;"></div>' +
      '<button class="btn btn-outline dc-finish-sup-driver" data-driver-id="__all__" style="color:#10b981;border-color:#10b981;width:100%;">Все водители (' + totalSuppliers + ' пост.)</button>' +
      '<button class="btn btn-outline dc-finish-sup-cancel" style="margin-top:4px;width:100%;">Отмена</button>' +
      '</div></div>';

    document.body.appendChild(modal);

    modal.querySelector('.dc-finish-sup-cancel').addEventListener('click', function () { modal.remove(); });
    modal.querySelectorAll('.dc-finish-sup-driver').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        modal.remove();
        var driverId = btn.dataset.driverId;
        if (driverId === '__all__') {
          var driverIds = Object.keys(driverSupplierCounts);
          for (var i = 0; i < driverIds.length; i++) {
            await finishSupplierRoute(driverIds[i]);
          }
        } else {
          await finishSupplierRoute(driverId);
        }
      });
    });
  }

  async function finishSupplierRoute(driverId) {
    var routeDate = new Date().toISOString().split('T')[0];
    var driverName = getDriverNameById(driverId);

    var supplierPoints = [];
    var supplierIndicesToRemove = [];
    orders.forEach(function (order, idx) {
      if (!order.isSupplier || !order.geocoded || order.isPoi) return;
      var did = getOrderDriverId(idx);
      if (!did || String(did) !== String(driverId)) return;

      var pt = {
        address: order.address,
        lat: order.lat,
        lng: order.lng,
        phone: order.phone || null,
        timeSlot: order.timeSlot || null,
        formattedAddress: order.formattedAddress || null,
        orderNum: supplierPoints.length + 1,
        isSupplier: true,
        telegramSent: !!order.telegramSent,
        telegramStatus: order.telegramStatus || null,
        items1c: order.items1c || null,
        itemsSent: !!order.itemsSent,
        itemsSentText: order.itemsSentText || null,
      };
      supplierPoints.push(pt);
      supplierIndicesToRemove.push(idx);
    });

    if (supplierPoints.length === 0) {
      showToast('Нет поставщиков для ' + driverName, 'error');
      return;
    }

    try {
      var savedRoute = await window.VehiclesDB.syncDriverRoute(parseInt(driverId, 10), routeDate, supplierPoints);
      if (savedRoute && savedRoute.id) {
        await window.VehiclesDB.completeDriverRoute(savedRoute.id);
      }

      supplierIndicesToRemove.sort(function (a, b) { return b - a; });
      supplierIndicesToRemove.forEach(function (idx) {
        orders.splice(idx, 1);
        if (assignments) assignments.splice(idx, 1);
      });

      variants = [];
      activeVariant = -1;
      _fitBoundsNext = true;
      renderAll();

      // Rebuild remaining active route (e.g. only addresses left).
      await syncDriverToDb(String(driverId));

      showToast('Поставщики для ' + driverName + ' завершены (' + supplierPoints.length + ')');
    } catch (err) {
      showToast('Ошибка: ' + err.message, 'error');
    }
  }

  // ─── Auto-complete at 23:00 (prevent day carry-over) ───
  async function finishAllForDriver(driverId) {
    var routeDate = getStateDateKey();
    var points = [];
    var orderIndicesToRemove = [];

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
        pt.telegramSent = !!order.telegramSent;
        pt.telegramStatus = order.telegramStatus || null;
        pt.items1c = order.items1c || null;
        pt.itemsSent = !!order.itemsSent;
        pt.itemsSentText = order.itemsSentText || null;
      }
      if (order.isPartner) {
        pt.isPartner = true;
        pt.partnerName = order.partnerName || order.address || null;
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
      orderIndicesToRemove.push(idx);
    });

    if (points.length === 0) return;
    var savedRoute = await window.VehiclesDB.syncDriverRoute(parseInt(driverId, 10), routeDate, points);
    if (savedRoute && savedRoute.id) {
      await window.VehiclesDB.completeDriverRoute(savedRoute.id);
    }
    orderIndicesToRemove.sort(function (a, b) { return b - a; });
    orderIndicesToRemove.forEach(function (idx) {
      orders.splice(idx, 1);
      if (assignments) assignments.splice(idx, 1);
    });
    variants = [];
    activeVariant = -1;
  }

  async function autoCompleteDayAt2300() {
    var routeDate = getStateDateKey();
    if (_autoCompletedDateKey === routeDate) return;
    if (orders.length === 0) {
      _autoCompletedDateKey = routeDate;
      return;
    }

    var driverIds = {};
    orders.forEach(function (o, idx) {
      if (!o.geocoded || o.isPoi) return;
      var did = getOrderDriverId(idx);
      if (!did) return;
      driverIds[String(did)] = true;
    });
    var dids = Object.keys(driverIds);
    if (dids.length === 0) {
      _autoCompletedDateKey = routeDate;
      return;
    }

    try {
      for (var i = 0; i < dids.length; i++) {
        await finishAllForDriver(dids[i]);
      }
      _autoCompletedDateKey = routeDate;
      _allowEmptyCloudWriteUntil = Date.now() + 10000;
      renderAll();
      flushCloudStateSave();
      showToast('Маршруты автоматически завершены в 23:00. Данные сохранены за ' + routeDate);
    } catch (err) {
      console.warn('autoCompleteDayAt2300 error:', err);
    }
  }

  async function completeYesterdayActiveRoutes() {
    var now = new Date();
    if (now.getHours() !== 0 || now.getMinutes() > 5) return;
    var yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    var yesterdayStr = yesterday.getFullYear() + '-' + String(yesterday.getMonth() + 1).padStart(2, '0') + '-' + String(yesterday.getDate()).padStart(2, '0');
    if (_yesterdayCompletedKey === yesterdayStr) return;
    if (!window.VehiclesDB || !window.VehiclesDB.getActiveRoutes || !window.VehiclesDB.completeDriverRoute) return;
    try {
      var routes = await window.VehiclesDB.getActiveRoutes(yesterdayStr);
      for (var i = 0; i < (routes || []).length; i++) {
        if (routes[i] && routes[i].id) {
          await window.VehiclesDB.completeDriverRoute(routes[i].id);
        }
      }
      _yesterdayCompletedKey = yesterdayStr;
      if (routes && routes.length > 0) {
        showToast('Активные маршруты за ' + yesterdayStr + ' отмечены как завершённые');
      }
    } catch (e) {
      console.warn('completeYesterdayActiveRoutes error:', e);
    }
  }

  function runDayRolloverCheck() {
    var now = new Date();
    var todayKey = now.toISOString().split('T')[0];
    var hour = now.getHours();
    var min = now.getMinutes();

    if (hour === 0 && min < 5) {
      completeYesterdayActiveRoutes();
    }
    if (hour === 23 && _autoCompletedDateKey !== todayKey) {
      autoCompleteDayAt2300();
    }
  }

  function startDayRolloverCheck() {
    stopDayRolloverCheck();
    runDayRolloverCheck();
    _dayRolloverCheckTimer = setInterval(runDayRolloverCheck, 60000);
  }

  function stopDayRolloverCheck() {
    if (_dayRolloverCheckTimer) {
      clearInterval(_dayRolloverCheckTimer);
      _dayRolloverCheckTimer = null;
    }
  }

  // ─── Send all unsent suppliers to Telegram ─────────────
  async function sendToTelegram() {
    var botToken = window.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      showToast('Telegram бот не настроен. Укажите токен в config.js', 'error');
      return;
    }

    // Always refresh items from 1C before sending
    await refreshSupplierItems();

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
            supplierOrder.itemsSent = !!supplierOrder.items1c;
            supplierOrder.itemsSentText = supplierOrder.items1c || null;
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
        order.itemsSent = !!order.items1c;
        order.itemsSentText = order.items1c || null;
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

  // ─── Send items update to driver (when items arrived after initial send) ──
  async function sendItemsToDriver(orderId, opts) {
    opts = opts || {};
    var botToken = window.TELEGRAM_BOT_TOKEN;
    if (!botToken) { if (!opts.silent) showToast('Telegram бот не настроен', 'error'); return; }

    var order = orders.find(function (o) { return o.id === orderId; });
    if (!order || !order.telegramChatId) { if (!opts.silent) showToast('Поставщик не был отправлен в Telegram', 'error'); return; }

    if (!opts.skipRefresh) await refreshSupplierItems();
    var items = order.items1c;
    if (!items) {
      var found = getSupplierItems(order.supplierName || order.address);
      if (!found.length && order.supplierData) found = getSupplierItems(order.supplierData.name);
      items = found.length > 0 ? found.join('\n') : null;
    }
    if (!items) { if (!opts.silent) showToast('Товар от 1С ещё не поступил', 'error'); return; }

    var msg = '📋 <b>Товар для ' + escapeHtml(order.address) + ':</b>\n' + escapeHtml(items);

    try {
      var resp = await fetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: order.telegramChatId,
          text: msg,
          parse_mode: 'HTML',
          reply_to_message_id: order.telegramMessageId || undefined,
        }),
      });
      var data = await resp.json();
      if (data.ok) {
        order.items1c = items;
        order.itemsSent = true;
        order.itemsSentText = items;
        if (!opts.silent) showToast(opts.auto ? 'Товар автоматически отправлен: ' + order.address : 'Товар отправлен водителю: ' + order.address);
        renderAll();
      } else {
        if (!opts.silent) showToast('Ошибка: ' + (data.description || '?'), 'error');
      }
    } catch (err) {
      if (!opts.silent) showToast('Ошибка отправки: ' + err.message, 'error');
    }
  }

  // ─── Telegram confirmations ──────────────────────────────
  var _tgPollTimer = null;

  function getSupabaseClient() {
    var config = window.SUPABASE_CONFIG || {};
    if (!config.url || !config.anonKey) return null;
    if (!window._dcSupabase) {
      window._dcSupabase = supabase.createClient(config.url, config.anonKey);
    }
    return window._dcSupabase;
  }

  // Save/update confirmation record when sending.
  // Webhook updates this same row later to confirmed/rejected/picked_up.
  async function saveTelegramConfirmation(orderId, chatId, messageId, driverName, supplierName) {
    var client = getSupabaseClient();
    if (!client) return;
    try {
      var existing = await client
        .from('telegram_confirmations')
        .select('id')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false })
        .limit(1);
      if (existing && existing.data && existing.data.length > 0) {
        await client
          .from('telegram_confirmations')
          .update({
            chat_id: chatId,
            message_id: messageId,
            driver_name: driverName || '',
            supplier_name: supplierName || '',
            status: 'sent',
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.data[0].id);
      } else {
        await client.from('telegram_confirmations').insert({
          order_id: orderId,
          chat_id: chatId,
          message_id: messageId,
          driver_name: driverName || '',
          supplier_name: supplierName || '',
          status: 'sent',
        });
      }
    } catch (e) { /* table may not exist yet — ok */ }
  }

  // Check confirmations via DB rows written by webhook.
  async function checkTelegramConfirmations(silent) {
    var client = getSupabaseClient();
    if (!client) {
      if (!silent) showToast('Supabase не настроен для webhook-синхронизации', 'error');
      return;
    }

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

    var statusWeight = { sent: 0, rejected: 1, confirmed: 2, picked_up: 3 };
    var applied = 0;
    var known = 0;
    try {
      var resp = await client
        .from('telegram_confirmations')
        .select('order_id,status,updated_at')
        .in('order_id', pendingIds)
        .order('updated_at', { ascending: false });
      if (resp.error) throw resp.error;

      var latestByOrder = {};
      (resp.data || []).forEach(function (row) {
        if (!row || !row.order_id || !row.status) return;
        if (!latestByOrder[row.order_id]) latestByOrder[row.order_id] = row;
      });

      Object.keys(latestByOrder).forEach(function (orderId) {
        var row = latestByOrder[orderId];
        var nextStatus = row.status;
        if (!statusWeight.hasOwnProperty(nextStatus)) return;
        known++;
        var order = orders.find(function (o) { return o.id === orderId; });
        if (!order) return;
        var currentStatus = order.telegramStatus || 'sent';
        var curW = statusWeight[currentStatus] != null ? statusWeight[currentStatus] : 0;
        var nextW = statusWeight[nextStatus];
        if (nextW < curW) return;
        if (currentStatus !== nextStatus) {
          order.telegramStatus = nextStatus;
          applied++;
        }
      });

      if (applied > 0) {
        showToast('✅ Обновлено ответов: ' + applied);
        renderAll();
      } else {
        if (!silent) {
          showToast('Нет новых ответов. Найдено записей: ' + known);
        }
      }
    } catch (err) {
      if (!silent) showToast('Ошибка webhook-синхронизации: ' + err.message, 'error');
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
    order.itemsSent = false;
    order.itemsSentText = null;
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
    var isSelected = !!_selectedOrderIds[order.id];
    var html = '<div class="' + itemClass + '" data-order-id="' + order.id + '" style="' + (hasSlot ? 'border-left-color:' + color + ';' : '') + (isSelected ? 'box-shadow:inset 0 0 0 2px #22c55e;' : '') + '">';
    var numBg;
    if (order.isPoi) {
      numBg = 'background:' + (hasSlot ? color : (order.poiColor || '#3b82f6')) + ';color:#111;border-radius:4px;font-weight:800;text-shadow:0 0 2px rgba(255,255,255,.8);';
    } else if (order.isSupplier) {
      numBg = hasSlot ? 'background:' + color + ';color:#fff' : (isFailed ? 'background:#ef4444;color:#fff' : 'background:#10b981;color:#fff');
    } else if (order.isPartner) {
      numBg = hasSlot ? 'background:' + color + ';color:#fff;border-radius:6px;' : (isFailed ? 'background:#ef4444;color:#fff;border-radius:6px;' : 'background:#e0e0e0;color:#333;border:1px solid #999;border-radius:6px;');
    } else {
      numBg = hasSlot ? 'background:' + color + ';color:#fff' : (isFailed ? 'background:#ef4444;color:#fff' : (isSettlementOnly ? 'background:#f59e0b;color:#fff' : 'background:#e0e0e0;color:#333;border:1px solid #999'));
    }
    var numLabel = order.isPoi ? (order.poiShort || 'П') : (order.isSupplier ? 'П' : (order.isPartner ? 'ПР' : (order._displayNum || (idx + 1))));
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
    } else if (order.isPartner && order.partnerDbId) {
      html += '<div style="font-size:10px;color:#f97316;margin-top:1px;">Партнёр выбран</div>';
    } else if (order.isPartner && !order.partnerDbId) {
      html += '<div class="dc-partner-not-found" data-id="' + order.id + '" style="font-size:10px;color:#f97316;margin-top:1px;cursor:pointer;display:inline-flex;align-items:center;gap:3px;" title="Нажмите чтобы найти партнёра">🔎 Не выбран — нажмите для поиска</div>';
    }
    if (order.isSupplier && order.telegramSent) {
      if (!order.items1c) {
        html += '<div style="font-size:10px;color:var(--muted);margin-top:2px;">⏳ Товар от 1С ещё не поступил</div>';
      } else if (order.itemsSentText && order.itemsSentText === order.items1c) {
        html += '<div style="font-size:10px;color:#22c55e;margin-top:2px;">📋 Список товара отправлен</div>';
      } else {
        html += '<div style="font-size:10px;color:#a78bfa;margin-top:2px;">📋 Товар из 1С загружен</div>';
        html += '<button class="btn btn-outline btn-sm dc-send-items-btn" data-id="' + order.id + '" style="font-size:9px;color:#a78bfa;border-color:#a78bfa;margin-top:2px;padding:1px 6px;" title="Дослать товар водителю в Telegram">📋 Дослать товар</button>';
      }
    } else if (order.isSupplier && !order.items1c) {
      html += '<div style="font-size:10px;color:var(--muted);margin-top:2px;">⏳ Товар от 1С ещё не поступил</div>';
    } else if (order.isSupplier) {
      html += '<div style="font-size:10px;color:#a78bfa;margin-top:2px;">📋 Товар из 1С загружен</div>';
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
      if (order.isPartner && !order.partnerDbId) {
        html += '<button class="btn btn-outline btn-sm dc-partner-search-btn" data-id="' + order.id + '" title="Выбрать партнёра в базе" style="color:#f97316;border-color:#f97316;font-size:10px;">🔎 Найти</button>';
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
      if (order.isPartner && !order.partnerDbId) {
        html += '<button class="btn btn-outline btn-sm dc-partner-search-btn" data-id="' + order.id + '" title="Выбрать партнёра в базе" style="color:#f97316;border-color:#f97316;font-size:10px;">🔎 Найти</button>';
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

    // Keep unsent textarea content across any sidebar re-render (e.g. Telegram status updates)
    var supplierInputEl = sidebar.querySelector('#dcSupplierInput');
    if (supplierInputEl) supplierInputDraft = supplierInputEl.value;
    var partnerInputEl = sidebar.querySelector('#dcPartnerInput');
    if (partnerInputEl) partnerInputDraft = partnerInputEl.value;
    var addressInputEl = sidebar.querySelector('#dcAddressInput');
    if (addressInputEl) addressInputDraft = addressInputEl.value;

    // Preserve collapsed/expanded state before re-render
    var suppDetails = sidebar.querySelector('.dc-details-suppliers');
    if (suppDetails) _supplierListOpen = suppDetails.open;
    var partnerDetails = sidebar.querySelector('.dc-details-partners');
    if (partnerDetails) _partnerListOpen = partnerDetails.open;
    var addrDetails = sidebar.querySelector('.dc-details-addresses');
    if (addrDetails) _addressListOpen = addrDetails.open;
    var drvDetails = sidebar.querySelector('.dc-details-drivers');
    if (drvDetails) _driversListOpen = drvDetails.open;

    const allOrders = orders.map(function (o, i) { return Object.assign({}, o, { globalIndex: i }); });
    const supplierItems = allOrders.filter(function (o) { return o.isSupplier; }).reverse();
    const partnerItems = allOrders.filter(function (o) { return o.isPartner; }).reverse();
    const addressItems = allOrders.filter(function (o) { return !o.isSupplier && !o.isPartner; }).reverse();

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
        '<button class="btn dc-btn-finish-suppliers" style="background:#10b981;color:#fff;border:none;margin-top:4px;display:flex;align-items:center;gap:6px;">' +
        '🏁 Завершить поставщиков</button>' +
        '<button class="btn dc-btn-telegram" style="background:#229ED9;color:#fff;border:none;margin-top:6px;display:flex;align-items:center;gap:6px;">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>' +
        'Поставщики → Telegram' + (unsentSupplierCount > 0 ? ' (' + unsentSupplierCount + ')' : ' ✓') + '</button>' +
        ((pendingCount > 0 || confirmedCount > 0 || rejectedCount > 0) ? '<button class="btn dc-btn-check-tg" style="background:' + (pendingCount > 0 ? '#f59e0b' : '#6b7280') + ';color:#fff;border:none;margin-top:4px;font-size:12px;display:flex;align-items:center;gap:6px;">🔄 Обновить ответы' + (pendingCount > 0 ? ' (' + pendingCount + ' ожидает)' : '') + '</button>' : '') +
        tgStatusLine +
        '</div>';
    }

    pruneSelectedOrders();
    var selectedCount = Object.keys(_selectedOrderIds).filter(function (id) { return _selectedOrderIds[id]; }).length;
    var bulkAssignHtml = '';
    if (orders.length > 0) {
      var bulkButtons = dbDrivers.map(function (dr, di) {
        var c = COLORS[di % COLORS.length];
        var shortName = escapeHtml((dr.name || '').split(' ')[0] || ('Водитель ' + (di + 1)));
        return '<button class="dc-bulk-assign-btn" data-driver-id="' + dr.id + '" style="display:flex;align-items:center;gap:4px;padding:4px 8px;border-radius:10px;border:1px solid #2a2a2a;background:' + c + ';color:#fff;cursor:pointer;font-size:11px;font-weight:600;"><span style="width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.5);"></span>' + shortName + '</button>';
      }).join('');
      bulkAssignHtml = '<div class="dc-section" style="border:1px solid #2f3c2f;border-radius:10px;padding:8px;background:rgba(34,197,94,0.08);">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">' +
        '<div style="font-size:12px;color:#a7f3d0;">Выбрано точек: <b style="color:#22c55e;">' + selectedCount + '</b></div>' +
        '<div style="display:flex;gap:4px;">' +
        '<button class="btn btn-outline btn-sm dc-map-select-toggle" style="font-size:10px;padding:2px 8px;border-color:' + (_mapSelectMode ? '#22c55e' : '#555') + ';color:' + (_mapSelectMode ? '#22c55e' : '#999') + ';">' + (_mapSelectMode ? 'Выбор на карте: ВКЛ' : 'Выбор на карте') + '</button>' +
        '<button class="btn btn-outline btn-sm dc-clear-selection" style="font-size:10px;padding:2px 8px;">Снять выбор</button>' +
        '</div>' +
        '</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:4px;">' + bulkButtons + '</div>' +
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
      filteredSuppliers = filteredSuppliers.filter(function (o) { return o.telegramStatus !== 'confirmed' && o.telegramStatus !== 'picked_up'; });
    }
    if (_supplierTelegramFilter === 'sent') {
      filteredSuppliers = filteredSuppliers.filter(function (o) { return !!o.telegramSent; });
    } else if (_supplierTelegramFilter === 'unsent') {
      filteredSuppliers = filteredSuppliers.filter(function (o) { return !o.telegramSent; });
    }
    var assignedSupplierCount = supplierItems.filter(function (o) { return !!getOrderDriverId(o.globalIndex); }).length;
    var confirmedSupplierCount = supplierItems.filter(function (o) { return o.telegramStatus === 'confirmed' || o.telegramStatus === 'picked_up'; }).length;
    var sentSupplierCount = supplierItems.filter(function (o) { return !!o.telegramSent; }).length;
    var unsentSupplierCount = supplierItems.length - sentSupplierCount;
    var supplierListHtml = '';
    if (supplierItems.length > 0) {
      var toggleBtnHtml = '<button class="dc-toggle-assigned" style="font-size:10px;padding:2px 8px;border-radius:6px;border:1px solid ' + (_hideAssigned ? 'var(--accent)' : '#555') + ';background:' + (_hideAssigned ? 'rgba(16,185,129,0.15)' : 'transparent') + ';color:' + (_hideAssigned ? 'var(--accent)' : '#999') + ';cursor:pointer;margin-left:8px;white-space:nowrap;">' + (_hideAssigned ? 'Показать всех (' + supplierItems.length + ')' : 'Скрыть распред. (' + assignedSupplierCount + ')') + '</button>';
      var confirmToggleHtml = confirmedSupplierCount > 0
        ? '<button class="dc-toggle-confirmed" style="font-size:10px;padding:2px 8px;border-radius:6px;border:1px solid ' + (_hideConfirmed ? '#22c55e' : '#555') + ';background:' + (_hideConfirmed ? 'rgba(34,197,94,0.15)' : 'transparent') + ';color:' + (_hideConfirmed ? '#22c55e' : '#999') + ';cursor:pointer;margin-left:4px;white-space:nowrap;">' + (_hideConfirmed ? 'Показать ✅ (' + confirmedSupplierCount + ')' : 'Скрыть ✅ (' + confirmedSupplierCount + ')') + '</button>'
        : '';
      var tgFilterAllHtml = '<button class="dc-filter-tg-all" style="font-size:10px;padding:2px 8px;border-radius:6px;border:1px solid ' + (_supplierTelegramFilter === 'all' ? '#3b82f6' : '#555') + ';background:' + (_supplierTelegramFilter === 'all' ? 'rgba(59,130,246,0.15)' : 'transparent') + ';color:' + (_supplierTelegramFilter === 'all' ? '#93c5fd' : '#999') + ';cursor:pointer;margin-left:4px;white-space:nowrap;">TG все (' + supplierItems.length + ')</button>';
      var tgFilterSentHtml = '<button class="dc-filter-tg-sent" style="font-size:10px;padding:2px 8px;border-radius:6px;border:1px solid ' + (_supplierTelegramFilter === 'sent' ? '#229ED9' : '#555') + ';background:' + (_supplierTelegramFilter === 'sent' ? 'rgba(34,158,217,0.15)' : 'transparent') + ';color:' + (_supplierTelegramFilter === 'sent' ? '#7dd3fc' : '#999') + ';cursor:pointer;margin-left:4px;white-space:nowrap;">Отправлены (' + sentSupplierCount + ')</button>';
      var tgFilterUnsentHtml = '<button class="dc-filter-tg-unsent" style="font-size:10px;padding:2px 8px;border-radius:6px;border:1px solid ' + (_supplierTelegramFilter === 'unsent' ? '#f59e0b' : '#555') + ';background:' + (_supplierTelegramFilter === 'unsent' ? 'rgba(245,158,11,0.15)' : 'transparent') + ';color:' + (_supplierTelegramFilter === 'unsent' ? '#fcd34d' : '#999') + ';cursor:pointer;margin-left:4px;white-space:nowrap;">Не отправлены (' + unsentSupplierCount + ')</button>';
      supplierListHtml = '<div class="dc-section"><details class="dc-list-details dc-details-suppliers"' + (_supplierListOpen ? ' open' : '') + '>' +
        '<summary class="dc-section-title dc-list-toggle" style="cursor:pointer;user-select:none;display:flex;align-items:center;flex-wrap:wrap;gap:4px;">Поставщики <span style="font-weight:400;color:#888;">(' + filteredSuppliers.length + ')</span>' + toggleBtnHtml + confirmToggleHtml + tgFilterAllHtml + tgFilterSentHtml + tgFilterUnsentHtml + '</summary>' +
        '<div class="dc-orders-list">';
      filteredSuppliers.forEach(function (order) {
        supplierListHtml += renderOrderItem(order, order.globalIndex);
      });
      if (filteredSuppliers.length === 0) {
        var reason = _hideAssigned && _hideConfirmed ? 'Все поставщики распределены/приняты' : (_hideAssigned ? 'Все поставщики распределены' : (_hideConfirmed ? 'Все принятые/забранные скрыты' : (_supplierTelegramFilter === 'sent' ? 'Нет отправленных в Telegram' : (_supplierTelegramFilter === 'unsent' ? 'Нет неотправленных в Telegram' : 'Нет поставщиков'))));
        supplierListHtml += '<div style="padding:12px;color:#888;font-size:12px;text-align:center;">' + reason + '</div>';
      }
      supplierListHtml += '</div></details></div>';
    }

    // ─── Partner list (collapsible) ──────────────────────────
    var filteredPartners;
    if (editingDriverId) {
      filteredPartners = partnerItems.filter(function (o) {
        var did = getOrderDriverId(o.globalIndex);
        return !did || String(did) === String(editingDriverId);
      });
    } else if (selectedDriver !== null) {
      filteredPartners = partnerItems.filter(function (o) {
        var did = getOrderDriverId(o.globalIndex);
        return selectedDriver === '__unassigned__' ? !did : (did != null && String(did) === String(selectedDriver));
      });
    } else {
      filteredPartners = partnerItems;
    }
    var partnerListHtml = '';
    if (partnerItems.length > 0) {
      partnerListHtml = '<div class="dc-section"><details class="dc-list-details dc-details-partners"' + (_partnerListOpen ? ' open' : '') + '>' +
        '<summary class="dc-section-title dc-list-toggle" style="cursor:pointer;user-select:none;">Партнёры <span style="font-weight:400;color:#888;">(' + filteredPartners.length + ')</span></summary>' +
        '<div class="dc-orders-list">';
      filteredPartners.forEach(function (order) {
        partnerListHtml += renderOrderItem(order, order.globalIndex);
      });
      if (filteredPartners.length === 0) {
        partnerListHtml += '<div style="padding:12px;color:#888;font-size:12px;text-align:center;">Нет партнёров по фильтру</div>';
      }
      partnerListHtml += '</div></details></div>';
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
      emptyHtml = '<div class="dc-empty">Вставьте поставщиков, партнёров или адреса и нажмите «На карту»</div>';
    }

    var hasSupplierOrders = supplierItems.length > 0;
    var hasPartnerOrders = partnerItems.length > 0;
    var hasAddressOrders = addressItems.length > 0;

    sidebar.innerHTML =
      // ─── Supplier paste section ──────────────────────────
      '<div class="dc-section dc-bulk-section">' +
      '<details class="dc-bulk-details"' + (!hasSupplierOrders && !hasPartnerOrders && !hasAddressOrders ? ' open' : '') + '>' +
      '<summary class="dc-section-title dc-bulk-toggle">Вставить список поставщиков</summary>' +
      '<div class="dc-supplier-search" style="position:relative;margin-bottom:6px;">' +
      '<input id="dcSupplierSearch" class="dc-search-input" type="text" placeholder="Поиск поставщика по базе..." autocomplete="off" style="width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:13px;" />' +
      '<div id="dcSupplierSuggest" class="dc-suggest-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;background:#1e1e2e;color:#e0e0e0;border:1px solid #444;border-top:none;border-radius:0 0 6px 6px;max-height:200px;overflow-y:auto;z-index:100;box-shadow:0 4px 12px rgba(0,0,0,.4);"></div>' +
      '</div>' +
      '<textarea id="dcSupplierInput" class="dc-textarea" placeholder="Вставьте названия поставщиков, каждый с новой строки\\nФормат: ООО «Название» до 14" ' + (isLoadingSuppliers ? 'disabled' : '') + '>' + escapeHtml(supplierInputDraft) + '</textarea>' +
      '<div class="dc-buttons" style="margin-top:6px;">' +
      (!hasSupplierOrders
        ? '<button class="btn btn-primary dc-btn-load-suppliers" ' + (isLoadingSuppliers ? 'disabled' : '') + '>' + (isLoadingSuppliers ? '<span id="dcSupplierProgress">...</span>' : 'Найти') + '</button>'
        : '<button class="btn btn-primary dc-btn-append-suppliers" ' + (isLoadingSuppliers ? 'disabled' : '') + '>' + (isLoadingSuppliers ? '<span id="dcSupplierProgress">...</span>' : '+ Добавить') + '</button>'
      ) +
      '</div></details></div>' +
      // ─── Partner paste section ───────────────────────────
      '<div class="dc-section dc-bulk-section">' +
      '<details class="dc-bulk-details"' + (!hasPartnerOrders && !hasSupplierOrders && !hasAddressOrders ? ' open' : '') + '>' +
      '<summary class="dc-section-title dc-bulk-toggle">Вставить список партнёров</summary>' +
      '<div class="dc-partner-search" style="position:relative;margin-bottom:6px;">' +
      '<input id="dcPartnerSearch" class="dc-search-input" type="text" placeholder="Поиск партнёра по базе..." autocomplete="off" style="width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:13px;" />' +
      '<div id="dcPartnerSuggest" class="dc-suggest-dropdown" style="display:none;position:absolute;top:100%;left:0;right:0;background:#1e1e2e;color:#e0e0e0;border:1px solid #444;border-top:none;border-radius:0 0 6px 6px;max-height:200px;overflow-y:auto;z-index:100;box-shadow:0 4px 12px rgba(0,0,0,.4);"></div>' +
      '</div>' +
      '<textarea id="dcPartnerInput" class="dc-textarea" placeholder="Вставьте названия партнёров, каждый с новой строки" ' + (isLoadingPartners ? 'disabled' : '') + '>' + escapeHtml(partnerInputDraft) + '</textarea>' +
      '<div class="dc-buttons" style="margin-top:6px;">' +
      '<button class="btn btn-outline dc-btn-create-partner" style="border-color:#f97316;color:#f97316;">+ Новый партнёр</button>' +
      (!hasPartnerOrders
        ? '<button class="btn btn-primary dc-btn-load-partners" ' + (isLoadingPartners ? 'disabled' : '') + '>' + (isLoadingPartners ? '<span>...</span>' : 'Добавить список') + '</button>'
        : '<button class="btn btn-primary dc-btn-append-partners" ' + (isLoadingPartners ? 'disabled' : '') + '>' + (isLoadingPartners ? '<span>...</span>' : '+ Добавить') + '</button>'
      ) +
      '</div></details></div>' +
      // ─── Address paste section ───────────────────────────
      '<div class="dc-section dc-bulk-section">' +
      '<details class="dc-bulk-details"' + (!hasAddressOrders && !hasSupplierOrders && !hasPartnerOrders ? ' open' : '') + '>' +
      '<summary class="dc-section-title dc-bulk-toggle">Вставить список адресов</summary>' +
      '<textarea id="dcAddressInput" class="dc-textarea" placeholder="Вставьте адреса, каждый с новой строки\\nФормат: адрес [TAB] телефон [TAB] время" ' + (isGeocoding ? 'disabled' : '') + '>' + escapeHtml(addressInputDraft) + '</textarea>' +
      '<div class="dc-buttons" style="margin-top:6px;">' +
      (!hasAddressOrders
        ? '<button class="btn btn-primary dc-btn-load" ' + (isGeocoding ? 'disabled' : '') + '>' + (isGeocoding ? '<span id="dcProgress">...</span>' : 'На карту') + '</button>'
        : '<button class="btn btn-primary dc-btn-append" ' + (isGeocoding ? 'disabled' : '') + '>' + (isGeocoding ? '<span id="dcProgress">...</span>' : '+ Добавить') + '</button><button class="btn btn-outline btn-sm dc-btn-replace" ' + (isGeocoding ? 'disabled' : '') + '>Заменить всё</button>'
      ) +
      '</div></details></div>' +
      // Info + controls
      (orders.length > 0 ? '<div class="dc-info">Всего точек: <strong>' + orders.length + '</strong> (поставщики: ' + supplierItems.length + ', партнёры: ' + partnerItems.length + ', адреса: ' + addressItems.length + ', найдено: ' + geocodedCount + (settlementOnlyCount > 0 ? ', <span style="color:#f59e0b;">уточнить: ' + settlementOnlyCount + '</span>' : '') + (failedCount > 0 ? ', ошибок: ' + failedCount : '') + ')</div>' : '') +
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
      driverListHtml + finishHtml + bulkAssignHtml +
      // ─── Search through loaded points ───────────────────────
      (orders.length > 0 ? '<div class="dc-section dc-search-section" style="position:relative;">' +
        '<div style="display:flex;align-items:center;gap:6px;">' +
        '<input type="text" id="dcPointSearch" class="dc-search-input" placeholder="🔍 Поиск по точкам на карте..." autocomplete="off" style="flex:1;padding:7px 10px;border:1px solid #444;border-radius:8px;font-size:13px;background:#1a1a2e;color:#e0e0e0;" />' +
        '</div>' +
        '<div id="dcPointSearchResults" style="display:none;margin-top:4px;max-height:200px;overflow-y:auto;border:1px solid #444;border-radius:8px;background:#1e1e2e;"></div>' +
        '</div>' : '') +
      supplierListHtml + partnerListHtml + addressListHtml + emptyHtml;

    // Bind events
    bindSidebarEvents();
  }

  function bindSidebarEvents() {
    const sidebar = $('#dcSidebar');
    if (!sidebar) return;

    // Keep draft text in memory while user types
    var supplierInput = sidebar.querySelector('#dcSupplierInput');
    if (supplierInput) {
      supplierInput.addEventListener('input', function () {
        supplierInputDraft = supplierInput.value;
      });
    }
    var partnerInput = sidebar.querySelector('#dcPartnerInput');
    if (partnerInput) {
      partnerInput.addEventListener('input', function () {
        partnerInputDraft = partnerInput.value;
      });
    }
    var addressInput = sidebar.querySelector('#dcAddressInput');
    if (addressInput) {
      addressInput.addEventListener('input', function () {
        addressInputDraft = addressInput.value;
      });
    }

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
            var icon = o.isSupplier ? '📦' : (o.isPartner ? '🤝' : '📍');
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
    var filterTgAllBtn = sidebar.querySelector('.dc-filter-tg-all');
    if (filterTgAllBtn) {
      filterTgAllBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        _supplierTelegramFilter = 'all';
        renderAll();
      });
    }
    var filterTgSentBtn = sidebar.querySelector('.dc-filter-tg-sent');
    if (filterTgSentBtn) {
      filterTgSentBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        _supplierTelegramFilter = 'sent';
        renderAll();
      });
    }
    var filterTgUnsentBtn = sidebar.querySelector('.dc-filter-tg-unsent');
    if (filterTgUnsentBtn) {
      filterTgUnsentBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        _supplierTelegramFilter = 'unsent';
        renderAll();
      });
    }

    // Supplier load / append
    const loadSuppliersBtn = sidebar.querySelector('.dc-btn-load-suppliers');
    if (loadSuppliersBtn) loadSuppliersBtn.addEventListener('click', function () { loadSuppliers(false); });
    const appendSuppliersBtn = sidebar.querySelector('.dc-btn-append-suppliers');
    if (appendSuppliersBtn) appendSuppliersBtn.addEventListener('click', function () { loadSuppliers(true); });
    const loadPartnersBtn = sidebar.querySelector('.dc-btn-load-partners');
    if (loadPartnersBtn) loadPartnersBtn.addEventListener('click', function () { loadPartners(false); });
    const appendPartnersBtn = sidebar.querySelector('.dc-btn-append-partners');
    if (appendPartnersBtn) appendPartnersBtn.addEventListener('click', function () { loadPartners(true); });
    const createPartnerBtn = sidebar.querySelector('.dc-btn-create-partner');
    if (createPartnerBtn) createPartnerBtn.addEventListener('click', function (e) {
      e.preventDefault();
      openCreatePartnerModal();
    });

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

    // Partner autocomplete search
    const partnerSearchInput = sidebar.querySelector('#dcPartnerSearch');
    const partnerSuggestBox = sidebar.querySelector('#dcPartnerSuggest');
    if (partnerSearchInput && partnerSuggestBox) {
      partnerSearchInput.addEventListener('input', function () {
        var q = partnerSearchInput.value.trim();
        if (q.length < 1) { partnerSuggestBox.style.display = 'none'; partnerSuggestBox.innerHTML = ''; return; }
        var results = searchPartners(q, 10);
        if (results.length === 0) {
          partnerSuggestBox.innerHTML = '<div style="padding:8px 12px;color:#888;font-size:12px;">Не найдено</div>';
          partnerSuggestBox.style.display = 'block';
          return;
        }
        partnerSuggestBox.innerHTML = results.map(function (p) {
          return '<div class="dc-partner-suggest-item" data-name="' + escapeHtml(p.name) + '" style="padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid #333;transition:background .1s;color:#e0e0e0;">' +
            '<div style="font-weight:600;color:#fff;">' + escapeHtml(p.name) + '</div>' +
            (p.address ? '<div style="font-size:11px;color:#aaa;">' + escapeHtml(p.address) + '</div>' : '') +
            '</div>';
        }).join('');
        partnerSuggestBox.style.display = 'block';
        partnerSuggestBox.querySelectorAll('.dc-partner-suggest-item').forEach(function (item) {
          item.addEventListener('mouseenter', function () { item.style.background = '#2a2a3e'; });
          item.addEventListener('mouseleave', function () { item.style.background = ''; });
          item.addEventListener('click', function () {
            var partnerName = item.dataset.name;
            var textarea = sidebar.querySelector('#dcPartnerInput');
            if (textarea) {
              var existing = textarea.value.trim();
              textarea.value = (existing ? existing + '\n' : '') + partnerName;
            }
            partnerSearchInput.value = '';
            partnerSuggestBox.style.display = 'none';
            partnerSuggestBox.innerHTML = '';
            partnerSearchInput.focus();
          });
        });
      });
      partnerSearchInput.addEventListener('blur', function () {
        setTimeout(function () { partnerSuggestBox.style.display = 'none'; }, 200);
      });
      partnerSearchInput.addEventListener('focus', function () {
        if (partnerSearchInput.value.trim().length >= 1) {
          partnerSearchInput.dispatchEvent(new Event('input'));
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
    const finishSuppliersBtn = sidebar.querySelector('.dc-btn-finish-suppliers');
    if (finishSuppliersBtn) finishSuppliersBtn.addEventListener('click', showFinishSuppliersDialog);
    const telegramBtn = sidebar.querySelector('.dc-btn-telegram');
    if (telegramBtn) telegramBtn.addEventListener('click', sendToTelegram);
    const checkTgBtn = sidebar.querySelector('.dc-btn-check-tg');
    if (checkTgBtn) checkTgBtn.addEventListener('click', function () {
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

    // Toggle map selection mode
    var mapSelectBtn = sidebar.querySelector('.dc-map-select-toggle');
    if (mapSelectBtn) {
      mapSelectBtn.addEventListener('click', function (e) {
        e.preventDefault();
        _mapSelectMode = !_mapSelectMode;
        renderAll();
        showToast(_mapSelectMode ? 'Режим выбора на карте включен' : 'Режим выбора на карте выключен');
      });
    }
    // Clear selection
    var clearSelBtn = sidebar.querySelector('.dc-clear-selection');
    if (clearSelBtn) {
      clearSelBtn.addEventListener('click', function (e) {
        e.preventDefault();
        _selectedOrderIds = {};
        renderAll();
      });
    }
    // Bulk assign selected points
    sidebar.querySelectorAll('.dc-bulk-assign-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        bulkAssignSelectedToDriver(parseInt(btn.dataset.driverId, 10));
      });
    });

    // Hover on sidebar item -> highlight point on map
    sidebar.querySelectorAll('.dc-order-item').forEach(function (item) {
      item.addEventListener('mouseenter', function () {
        highlightMapOrder(item.dataset.orderId);
      });
      item.addEventListener('mouseleave', function () {
        clearMapOrderHighlight();
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
      btn.addEventListener('click', async function () {
        const idx = orders.findIndex(function (o) { return o.id === btn.dataset.id; });
        if (idx === -1) return;
        var orderToDelete = orders[idx];
        var affectedDriverId = getOrderDriverId(idx);
        if (orderToDelete && orderToDelete.isSupplier) {
          await clearSupplierItemsForOrder(orderToDelete);
        }
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
    sidebar.querySelectorAll('.dc-partner-not-found, .dc-partner-search-btn').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        openPartnerSearch(el.dataset.id);
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

    // Send items update button
    sidebar.querySelectorAll('.dc-send-items-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        sendItemsToDriver(btn.dataset.id);
      });
    });
  }

  // ─── Init on tab switch ───────────────────────────────────
  async function onSectionActivated() {
    loadSupplierAliases();
    loadPartnerAliases();
    // Load drivers and suppliers from DB
    await Promise.all([loadDbDrivers(), loadDbSuppliers(), loadDbPartners()]);
    // Apply custom driver colors
    loadDriverColors();
    applyCustomColors();
    // Restore saved data on first activation (prefer freshest: cloud vs local)
    if (orders.length === 0) {
      await loadBestAvailableState();
    }
    // Ensure 1C items are loaded even after page refresh/session restore.
    if (orders.some(function (o) { return o.isSupplier; })) {
      await refreshSupplierItems();
      startItemsPolling();
    } else {
      stopItemsPolling();
    }
    _fitBoundsNext = true;
    initMap().then(function () { updatePlacemarks(); });
    renderSidebar();
    // Start auto-polling if there are pending Telegram confirmations
    var hasPending = orders.some(function (o) { return o.isSupplier && o.telegramSent && o.telegramStatus === 'sent'; });
    if (hasPending) startTelegramPolling();
    startCloudStatePolling();
    startCloudRealtimeSync();
    startDayRolloverCheck();
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
        items1c: o.items1c || null,
        itemsSent: !!o.itemsSent,
        itemsSentText: o.itemsSentText || null,
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
    startDayRolloverCheck();
    const section = document.getElementById('distributionSection');
    if (section && section.classList.contains('active')) {
      onSectionActivated();
    }
  });
})();
