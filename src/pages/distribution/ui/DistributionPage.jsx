import { useState, useCallback, useMemo, useEffect } from 'react';
import '../../../App.css';
import YandexMapView from '../../../widgets/map/ui/YandexMapView.jsx';
import { parseOrders } from '../../../entities/order/model/parser.js';
import {
  geocodeOrders,
  geocodeAddress,
} from '../../../entities/order/lib/geocoder.js';
import {
  generateVariants,
  DRIVER_COLORS,
} from '../../../entities/distribution/lib/distributor.js';
import {
  fetchCustomerOrdersForDate,
  mapDbOrderToUi,
} from '../../../entities/order/api/customerOrdersApi.js';
import { fetchSuppliers } from '../../../shared/api/suppliersApi.js';
import { fetchPartners } from '../../../shared/api/partnersApi.js';
import { fetchDrivers } from '../../../shared/api/driversApi.js';
import {
  saveDriverRoutes,
  syncDriverRoute,
  clearActiveRoute,
} from '../../../shared/api/driverRoutesApi.js';

// POI (ПВЗ / склады) — фиксированные точки на карте
const POI_DEFS = [
  { id: 'pvz1', label: 'ПВЗ 1', short: 'П1', address: 'Минск, Притыцкого 89', color: '#2563eb' },
  { id: 'pvz2', label: 'ПВЗ 2', short: 'П2', address: 'Минск, Туровского 12', color: '#7c3aed' },
  { id: 'rbdodoma', label: 'РБ Додома', short: 'РБ', address: 'Минск, Железнодорожная 33к1', color: '#ea580c' },
];

function DistributionPage() {
  const [rawText, setRawText] = useState('');
  const [orders, setOrders] = useState([]);
  const [driverCount, setDriverCount] = useState(3);
  const [assignments, setAssignments] = useState(null);
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geocodeProgress, setGeocodeProgress] = useState({ current: 0, total: 0 });
  const [toast, setToast] = useState(null);

  // Водители из БД и привязка слот → driver_id
  const [dbDrivers, setDbDrivers] = useState([]);
  const [driverSlots, setDriverSlots] = useState([]); // [driver_id, ...] по индексу слота

  // Variants
  const [variants, setVariants] = useState([]);
  const [activeVariant, setActiveVariant] = useState(-1);

  // Manual assignment mode
  const [manualMode, setManualMode] = useState(false);
  const [assigningDriver, setAssigningDriver] = useState(null);

  // Edit address mode
  const [editingOrderId, setEditingOrderId] = useState(null);
  const [editAddress, setEditAddress] = useState('');
  const [isRetrying, setIsRetrying] = useState(false);

  // Place on map mode
  const [placingOrderId, setPlacingOrderId] = useState(null);

  // Loading suppliers/partners from DB
  const [loadingSuppliers, setLoadingSuppliers] = useState(false);
  const [loadingPartners, setLoadingPartners] = useState(false);

  // Модалки: распределить маршрут (выбор водителей), сбросить данные, завершить
  const [showDistributeModal, setShowDistributeModal] = useState(false);
  const [distributeSelectedIds, setDistributeSelectedIds] = useState([]); // выбранные driver_id для распределения
  const [showClearModal, setShowClearModal] = useState(false);
  const [clearStep, setClearStep] = useState(1);
  const [clearTarget, setClearTarget] = useState(null); // { driverId, driverName } or __all__ / __unassigned__
  const [finishLoading, setFinishLoading] = useState(false);

  // POI на карте
  const [poiCoords, setPoiCoords] = useState({}); // { pvz1: { lat, lng }, ... }

  // Массовый выбор для назначения водителя
  const [selectedOrderIds, setSelectedOrderIds] = useState(new Set());
  const [mapSelectMode, setMapSelectMode] = useState(false);

  // Поиск по точкам
  const [pointSearchQuery, setPointSearchQuery] = useState('');
  const [pointSearchResults, setPointSearchResults] = useState([]);
  const [showSearchResults, setShowSearchResults] = useState(false);

  // Текстовые поля для добавления по именам
  const [supplierNamesText, setSupplierNamesText] = useState('');
  const [partnerNamesText, setPartnerNamesText] = useState('');
  const [loadingSuppliersByName, setLoadingSuppliersByName] = useState(false);
  const [loadingPartnersByName, setLoadingPartnersByName] = useState(false);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Загрузка водителей из БД
  useEffect(() => {
    fetchDrivers().then(setDbDrivers).catch(() => setDbDrivers([]));
  }, []);

  // Первичная загрузка сегодняшних заказов из customer_orders и геокодирование для карты
  useEffect(() => {
    const loadToday = async () => {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const rows = await fetchCustomerOrdersForDate(today);
        if (!rows || rows.length === 0) return;
        const uiOrders = rows.map(mapDbOrderToUi);
        setOrders(uiOrders);
        setIsGeocoding(true);
        setGeocodeProgress({ current: 0, total: uiOrders.length });
        const geocoded = await geocodeOrders(uiOrders, (current, total) => {
          setGeocodeProgress({ current, total });
        });
        setOrders(geocoded);
        const ok = geocoded.filter(o => o.geocoded).length;
        const fail = geocoded.filter(o => !o.geocoded).length;
        if (fail > 0) showToast(`Загружено ${geocoded.length} заказов, на карте: ${ok}, не найдено: ${fail}`, 'error');
        else if (ok > 0) showToast(`Загружено ${ok} заказов на карту`);
      } catch (e) {
        console.warn('Не удалось загрузить заказы из Supabase:', e);
      } finally {
        setIsGeocoding(false);
      }
    };
    loadToday();
  }, []);

  // Parse and geocode (replace all)
  const handleLoadAddresses = useCallback(async () => {
    const parsed = parseOrders(rawText);
    if (parsed.length === 0) {
      showToast('Не найдено адресов. Вставьте список адресов.', 'error');
      return;
    }
    setOrders(parsed);
    setAssignments(null);
    setSelectedDriver(null);
    setVariants([]);
    setActiveVariant(-1);
    setManualMode(false);
    setIsGeocoding(true);
    setGeocodeProgress({ current: 0, total: parsed.length });

    try {
      const geocoded = await geocodeOrders(parsed, (current, total) => {
        setGeocodeProgress({ current, total });
      });
      setOrders(geocoded);
      const ok = geocoded.filter(o => o.geocoded).length;
      const fail = geocoded.filter(o => !o.geocoded).length;
      showToast(
        fail > 0
          ? `Геокодировано: ${ok} из ${geocoded.length}. Ошибок: ${fail}`
          : `Все ${ok} адресов найдены на карте`,
        fail > 0 ? 'error' : 'success',
      );
    } catch (err) {
      showToast('Ошибка: ' + err.message, 'error');
    } finally {
      setIsGeocoding(false);
      setRawText('');
    }
  }, [rawText, showToast]);

  // Parse and geocode (append to existing)
  const handleAppendAddresses = useCallback(async () => {
    const parsed = parseOrders(rawText);
    if (parsed.length === 0) {
      showToast('Не найдено адресов для добавления.', 'error');
      return;
    }
    // Reset distribution since point set is changing
    setAssignments(null);
    setVariants([]);
    setActiveVariant(-1);
    setManualMode(false);
    setIsGeocoding(true);
    setGeocodeProgress({ current: 0, total: parsed.length });

    try {
      const geocoded = await geocodeOrders(parsed, (current, total) => {
        setGeocodeProgress({ current, total });
      });
      // Append to existing orders
      setOrders(prev => [...prev, ...geocoded]);
      const ok = geocoded.filter(o => o.geocoded).length;
      const fail = geocoded.filter(o => !o.geocoded).length;
      showToast(
        `Добавлено ${geocoded.length} адресов` +
          (fail > 0 ? `. Найдено: ${ok}, ошибок: ${fail}` : `, все найдены`),
        fail > 0 ? 'error' : 'success',
      );
    } catch (err) {
      showToast('Ошибка: ' + err.message, 'error');
    } finally {
      setIsGeocoding(false);
      setRawText('');
    }
  }, [rawText, showToast]);

  // Добавить поставщиков из БД на карту (с координатами — сразу, без координат — геокодируем по адресу)
  const handleAddSuppliers = useCallback(async () => {
    setLoadingSuppliers(true);
    try {
      const suppliers = await fetchSuppliers();
      if (!suppliers || suppliers.length === 0) {
        showToast('Нет поставщиков в базе', 'error');
        return;
      }
      const needGeocode = [];
      const withCoords = suppliers.filter(s => {
        const lat = parseFloat(s.lat);
        const lon = parseFloat(s.lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) return true;
        if (s.address && s.address.trim()) needGeocode.push(s);
        return false;
      });
      const newOrders = withCoords.map(s => ({
        id: `supplier-${s.id}`,
        address: s.name || s.address || '',
        lat: parseFloat(s.lat),
        lng: parseFloat(s.lon),
        geocoded: true,
        formattedAddress: s.address || `${s.lat}, ${s.lon}`,
        error: null,
        phone: '',
        timeSlot: s.working_hours || null,
        isSupplier: true,
      }));
      if (needGeocode.length > 0) {
        setIsGeocoding(true);
        const toGeocode = needGeocode.map(s => ({
          id: `supplier-${s.id}`,
          address: s.address || s.name || '',
          lat: null,
          lng: null,
          geocoded: false,
        }));
        setGeocodeProgress({ current: 0, total: toGeocode.length });
        const geocoded = await geocodeOrders(toGeocode, (cur, tot) => setGeocodeProgress({ current: cur, total: tot }));
        setIsGeocoding(false);
        geocoded.forEach(o => {
          if (o.geocoded) {
            const src = needGeocode.find(s => `supplier-${s.id}` === o.id);
            newOrders.push({
              ...o,
              address: src?.name || o.address,
              timeSlot: src?.working_hours || null,
              isSupplier: true,
            });
          }
        });
      }
      setOrders(prev => [...prev, ...newOrders]);
      setAssignments(null);
      setVariants([]);
      setActiveVariant(-1);
      showToast(`Добавлено поставщиков на карту: ${newOrders.length}`);
    } catch (err) {
      showToast('Ошибка: ' + err.message, 'error');
    } finally {
      setLoadingSuppliers(false);
    }
  }, [showToast]);

  // Добавить партнёров из БД на карту
  const handleAddPartners = useCallback(async () => {
    setLoadingPartners(true);
    try {
      const partners = await fetchPartners();
      if (!partners || partners.length === 0) {
        showToast('Нет партнёров в базе', 'error');
        return;
      }
      const needGeocode = [];
      const withCoords = partners.filter(p => {
        const lat = parseFloat(p.lat);
        const lon = parseFloat(p.lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) return true;
        if (p.address && p.address.trim()) needGeocode.push(p);
        return false;
      });
      const newOrders = withCoords.map(p => ({
        id: `partner-${p.id}`,
        address: p.name || p.address || '',
        lat: parseFloat(p.lat),
        lng: parseFloat(p.lon),
        geocoded: true,
        formattedAddress: p.address || `${p.lat}, ${p.lon}`,
        error: null,
        phone: '',
        timeSlot: null,
        isPartner: true,
      }));
      if (needGeocode.length > 0) {
        setIsGeocoding(true);
        const toGeocode = needGeocode.map(p => ({
          id: `partner-${p.id}`,
          address: p.address || p.name || '',
          lat: null,
          lng: null,
          geocoded: false,
        }));
        setGeocodeProgress({ current: 0, total: toGeocode.length });
        const geocoded = await geocodeOrders(toGeocode, (cur, tot) => setGeocodeProgress({ current: cur, total: tot }));
        setIsGeocoding(false);
        geocoded.forEach(o => {
          if (o.geocoded) {
            const src = needGeocode.find(pp => `partner-${pp.id}` === o.id);
            newOrders.push({ ...o, address: src?.name || o.address, isPartner: true });
          }
        });
      }
      setOrders(prev => [...prev, ...newOrders]);
      setAssignments(null);
      setVariants([]);
      setActiveVariant(-1);
      showToast(`Добавлено партнёров на карту: ${newOrders.length}`);
    } catch (err) {
      showToast('Ошибка: ' + err.message, 'error');
    } finally {
      setLoadingPartners(false);
    }
  }, [showToast]);

  // Открыть модалку выбора водителей для распределения
  const handleDistributeClick = useCallback(() => {
    const geocodedCount = orders.filter(o => o.geocoded).length;
    if (geocodedCount === 0) {
      showToast('Нет геокодированных адресов', 'error');
      return;
    }
    setDistributeSelectedIds(driverSlots.length > 0 ? [...driverSlots] : (dbDrivers.length ? [dbDrivers[0].id] : []));
    setShowDistributeModal(true);
  }, [orders, driverSlots, dbDrivers, showToast]);

  // Выполнить распределение по выбранным водителям (из модалки)
  const runDistribute = useCallback(
    (selectedDriverIds) => {
      if (!selectedDriverIds || selectedDriverIds.length === 0) {
        showToast('Выберите хотя бы одного водителя', 'error');
        return;
      }
      setShowDistributeModal(false);
      const count = selectedDriverIds.length;
      setDriverCount(count);
      setDriverSlots(selectedDriverIds);
      const vars = generateVariants(orders, count);
      setVariants(vars);
      setActiveVariant(0);
      setAssignments(vars[0].assignments);
      setSelectedDriver(null);
      setManualMode(false);
      showToast(`Распределено на ${count} водител${count === 1 ? 'я' : 'ей'}`);
    },
    [orders, showToast]
  );

  // Завершить маршрут — сохранить в БД для водителей
  const handleFinishRoute = useCallback(async () => {
    if (!assignments || driverSlots.length === 0) return;
    const routeDate = new Date().toISOString().slice(0, 10);
    const routesByDriver = {};
    orders.forEach((order, idx) => {
      if (!order.geocoded || !order.lat || !order.lng) return;
      const slotIdx = assignments[idx];
      if (slotIdx < 0 || slotIdx >= driverSlots.length) return;
      const driverId = driverSlots[slotIdx];
      if (!driverId) return;
      if (!routesByDriver[driverId]) routesByDriver[driverId] = [];
      const pointData = {
        address: order.address,
        lat: order.lat,
        lng: order.lng,
        phone: order.phone || null,
        timeSlot: order.timeSlot || null,
        formattedAddress: order.formattedAddress || null,
        orderNum: routesByDriver[driverId].length + 1,
      };
      if (order.isSupplier) pointData.isSupplier = true;
      if (order.isPartner) pointData.isPartner = true;
      if (order.poiId) pointData.isPoi = true;
      routesByDriver[driverId].push(pointData);
    });
    const routes = Object.keys(routesByDriver).map((driverId) => ({
      driver_id: parseInt(driverId, 10),
      route_date: routeDate,
      points: routesByDriver[driverId],
    }));
    if (routes.length === 0) {
      showToast('Нет точек для сохранения', 'error');
      return;
    }
    setFinishLoading(true);
    try {
      await saveDriverRoutes(routes);
      showToast('Маршруты опубликованы! Водители увидят их в своём разделе');
    } catch (err) {
      showToast('Ошибка сохранения: ' + err.message, 'error');
    } finally {
      setFinishLoading(false);
    }
  }, [orders, assignments, driverSlots, showToast]);

  // Сбросить данные: модалка (шаг 1 — выбор водителя/всех, шаг 2 — тип: поставщики/адреса/всё)
  const doClear = useCallback(
    (type, driverId, driverName) => {
      setShowClearModal(false);
      setClearStep(1);
      setClearTarget(null);
      const isAll = !driverId || driverId === '__all__';
      const getOrderDriverId = (idx) => {
        if (!assignments || idx < 0 || idx >= assignments.length) return null;
        const slot = assignments[idx];
        if (slot < 0 || slot >= driverSlots.length) return null;
        return driverSlots[slot];
      };
      const shouldRemove = (order, idx) => {
        if (isAll) return true;
        if (driverId === '__unassigned__') return !getOrderDriverId(idx);
        return getOrderDriverId(idx) != null && String(getOrderDriverId(idx)) === String(driverId);
      };
      const filterType = (order) => {
        if (type === 'suppliers') return order.isSupplier;
        if (type === 'addresses') return !order.isSupplier && !order.isPartner && !order.poiId;
        return true;
      };
      if (isAll && type === 'all') {
        setOrders([]);
        setAssignments(null);
        setDriverSlots([]);
        setVariants([]);
        setActiveVariant(-1);
        setSelectedDriver(null);
        setManualMode(false);
        setRawText('');
        setSupplierNamesText('');
        setPartnerNamesText('');
        showToast('Все данные сброшены');
        return;
      }
      const keep = [];
      const keepA = [];
      orders.forEach((o, i) => {
        if (shouldRemove(o, i) && filterType(o)) return;
        keep.push(o);
        if (assignments) keepA.push(assignments[i]);
      });
      setOrders(keep);
      setAssignments(keepA.length > 0 ? keepA : null);
      setVariants([]);
      setActiveVariant(-1);
      const label = type === 'suppliers' ? 'поставщиков' : type === 'addresses' ? 'адресов' : 'точек';
      const who = isAll ? '' : ` у ${driverName}`;
      showToast(`Сброшено ${orders.length - keep.length} ${label}${who}`);
    },
    [orders, assignments, driverSlots, showToast]
  );

  // POI: добавить/убрать фиксированную точку на карте
  const handleTogglePoi = useCallback(
    async (poiId) => {
      const def = POI_DEFS.find((p) => p.id === poiId);
      if (!def) return;
      const existingIdx = orders.findIndex((o) => o.poiId === poiId);
      if (existingIdx >= 0) {
        setOrders((prev) => prev.filter((o) => o.poiId !== poiId));
        setAssignments((prev) => {
          if (!prev || prev.length !== orders.length) return null;
          const next = prev.filter((_, i) => orders[i].poiId !== poiId);
          return next.length > 0 ? next : null;
        });
        setVariants([]);
        setActiveVariant(-1);
        return;
      }
      if (poiCoords[poiId]) {
        setOrders((prev) => [
          ...prev,
          {
            id: `poi-${poiId}`,
            address: def.address,
            lat: poiCoords[poiId].lat,
            lng: poiCoords[poiId].lng,
            geocoded: true,
            formattedAddress: poiCoords[poiId].formatted || def.address,
            error: null,
            phone: '',
            timeSlot: null,
            poiId,
            poiLabel: def.label,
          },
        ]);
        setAssignments(null);
        setVariants([]);
        setActiveVariant(-1);
        return;
      }
      try {
        const geo = await geocodeAddress(def.address);
        setPoiCoords((c) => ({ ...c, [poiId]: { lat: geo.lat, lng: geo.lng, formatted: geo.formattedAddress } }));
        setOrders((prev) => [
          ...prev,
          {
            id: `poi-${poiId}`,
            address: def.address,
            lat: geo.lat,
            lng: geo.lng,
            geocoded: true,
            formattedAddress: geo.formattedAddress || def.address,
            error: null,
            phone: '',
            timeSlot: null,
            poiId,
            poiLabel: def.label,
          },
        ]);
        setAssignments(null);
        setVariants([]);
        setActiveVariant(-1);
      } catch (e) {
        showToast('Не удалось найти: ' + def.address, 'error');
      }
    },
    [orders, poiCoords, showToast]
  );

  // Добавить поставщиков по списку имён (каждая строка — название, ищем в БД)
  const handleAddSuppliersByNames = useCallback(
    async (append) => {
      const names = supplierNamesText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      if (names.length === 0) {
        showToast('Вставьте названия поставщиков, каждый с новой строки', 'error');
        return;
      }
      setLoadingSuppliersByName(true);
      try {
        const suppliers = await fetchSuppliers();
        const compact = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
        const newOrders = [];
        for (const name of names) {
          const n = compact(name);
          const found = suppliers.find((s) => compact(s.name) === n || compact(s.name).includes(n) || compact(s.address || '').includes(n));
          if (found && Number.isFinite(parseFloat(found.lat)) && Number.isFinite(parseFloat(found.lon))) {
            newOrders.push({
              id: `supplier-${found.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              address: found.name || found.address || '',
              lat: parseFloat(found.lat),
              lng: parseFloat(found.lon),
              geocoded: true,
              formattedAddress: found.address || '',
              error: null,
              phone: '',
              timeSlot: found.working_hours || null,
              isSupplier: true,
            });
          }
        }
        if (append) setOrders((prev) => [...prev, ...newOrders]);
        else setOrders((prev) => [...newOrders, ...prev.filter((o) => !o.isSupplier)]);
        setAssignments(null);
        setVariants([]);
        setActiveVariant(-1);
        setSupplierNamesText('');
        showToast(`Добавлено поставщиков: ${newOrders.length}`);
      } catch (e) {
        showToast('Ошибка: ' + (e.message || e), 'error');
      } finally {
        setLoadingSuppliersByName(false);
      }
    },
    [supplierNamesText, showToast]
  );

  // Добавить партнёров по списку имён
  const handleAddPartnersByNames = useCallback(
    async (append) => {
      const names = partnerNamesText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      if (names.length === 0) {
        showToast('Вставьте названия партнёров', 'error');
        return;
      }
      setLoadingPartnersByName(true);
      try {
        const partners = await fetchPartners();
        const compact = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
        const newOrders = [];
        for (const name of names) {
          const n = compact(name);
          const found = partners.find((p) => compact(p.name) === n || compact(p.name).includes(n) || compact(p.address || '').includes(n));
          if (found && Number.isFinite(parseFloat(found.lat)) && Number.isFinite(parseFloat(found.lon))) {
            newOrders.push({
              id: `partner-${found.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              address: found.name || found.address || '',
              lat: parseFloat(found.lat),
              lng: parseFloat(found.lon),
              geocoded: true,
              formattedAddress: found.address || '',
              error: null,
              phone: '',
              timeSlot: null,
              isPartner: true,
            });
          }
        }
        if (append) setOrders((prev) => [...prev, ...newOrders]);
        else setOrders((prev) => [...newOrders, ...prev.filter((o) => !o.isPartner)]);
        setAssignments(null);
        setVariants([]);
        setActiveVariant(-1);
        setPartnerNamesText('');
        showToast(`Добавлено партнёров: ${newOrders.length}`);
      } catch (e) {
        showToast('Ошибка: ' + (e.message || e), 'error');
      } finally {
        setLoadingPartnersByName(false);
      }
    },
    [partnerNamesText, showToast]
  );

  // Массовое назначение выбранных точек на водителя
  const handleBulkAssign = useCallback(
    (driverIdx) => {
      if (!assignments || driverIdx < 0 || driverIdx >= driverSlots.length) return;
      const ids = Array.from(selectedOrderIds);
      if (ids.length === 0) return;
      const newAssignments = [...assignments];
      orders.forEach((o, i) => {
        if (ids.includes(o.id)) newAssignments[i] = driverIdx;
      });
      setAssignments(newAssignments);
      setActiveVariant(-1);
      setSelectedOrderIds(new Set());
      showToast(`Назначено ${ids.length} точек`);
    },
    [assignments, driverSlots, orders, selectedOrderIds, showToast]
  );

  // Переключить выбор точки для массового назначения
  const toggleOrderSelected = useCallback((orderId) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }, []);

  // Обновить из 1С — подтянуть новые заказы за сегодня
  const handleRefresh1C = useCallback(async () => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      const existing1cIds = new Set(orders.filter((o) => o.order1cId).map((o) => o.order1cId));
      const rows = await fetchCustomerOrdersForDate(today);
      if (!rows || rows.length === 0) {
        showToast('Нет заказов за сегодня');
        return;
      }
      const toAdd = rows.filter((r) => r.order_1c_id && !existing1cIds.has(r.order_1c_id));
      if (toAdd.length === 0) {
        showToast('Нет новых заказов из 1С');
        return;
      }
      const uiNew = toAdd.map(mapDbOrderToUi);
      setIsGeocoding(true);
      setGeocodeProgress({ current: 0, total: uiNew.length });
      const geocoded = await geocodeOrders(uiNew, (cur, tot) => setGeocodeProgress({ current: cur, total: tot }));
      setIsGeocoding(false);
      setOrders((prev) => [...prev, ...geocoded]);
      setAssignments(null);
      setVariants([]);
      setActiveVariant(-1);
      const ok = geocoded.filter((o) => o.geocoded).length;
      showToast(`Добавлено из 1С: ${geocoded.length} заказов, на карте: ${ok}`);
    } catch (e) {
      showToast('Ошибка: ' + (e.message || e), 'error');
    }
  }, [orders, showToast]);

  // Select a variant
  const handleSelectVariant = useCallback(
    idx => {
      setActiveVariant(idx);
      setAssignments([...variants[idx].assignments]);
      setSelectedDriver(null);
      setManualMode(false);
    },
    [variants],
  );

  // Toggle manual mode
  const handleToggleManual = useCallback(() => {
    setManualMode(m => !m);
    setAssigningDriver(null);
  }, []);

  // Manual: click on order in sidebar to assign to selected driver
  const handleManualAssign = useCallback(
    orderIndex => {
      if (!manualMode || assigningDriver === null || !assignments) return;
      const newAssignments = [...assignments];
      newAssignments[orderIndex] = assigningDriver;
      setAssignments(newAssignments);
      setActiveVariant(-1);
    },
    [manualMode, assigningDriver, assignments],
  );

  // Assign driver from map balloon (works always when distributed)
  const handleMapAssignDriver = useCallback(
    (globalIndex, driverIdx) => {
      if (!assignments) return;
      const newAssignments = [...assignments];
      newAssignments[globalIndex] = driverIdx;
      setAssignments(newAssignments);
      setActiveVariant(-1);
    },
    [assignments],
  );

  // Start editing an address
  const handleStartEdit = useCallback(order => {
    setEditingOrderId(order.id);
    setEditAddress(order.address);
    setPlacingOrderId(null);
  }, []);

  // Retry geocoding with edited address
  const handleRetryGeocode = useCallback(
    async orderId => {
      setIsRetrying(true);
      try {
        const geo = await geocodeAddress(editAddress);
        setOrders(prev =>
          prev.map(o =>
            o.id === orderId
              ? {
                  ...o,
                  address: editAddress,
                  lat: geo.lat,
                  lng: geo.lng,
                  formattedAddress: geo.formattedAddress,
                  geocoded: true,
                  error: null,
                }
              : o,
          ),
        );
        setEditingOrderId(null);
        showToast('Адрес найден');
      } catch (err) {
        showToast('Не найден: ' + editAddress, 'error');
      } finally {
        setIsRetrying(false);
      }
    },
    [editAddress, showToast],
  );

  // Start "place on map" mode for an order
  const handleStartPlacing = useCallback(orderId => {
    setPlacingOrderId(orderId);
    setEditingOrderId(null);
    showToast('Кликните на карту, чтобы поставить точку');
  }, [showToast]);

  // Map click handler — places the order at clicked coordinates
  const handleMapClick = useCallback(
    (lat, lng) => {
      if (!placingOrderId) return;
      setOrders(prev =>
        prev.map(o =>
          o.id === placingOrderId
            ? {
                ...o,
                lat,
                lng,
                geocoded: true,
                error: null,
                formattedAddress: `${lat.toFixed(5)}, ${lng.toFixed(5)} (вручную)`,
              }
            : o,
        ),
      );
      setPlacingOrderId(null);
      showToast('Точка установлена вручную');
    },
    [placingOrderId, showToast],
  );

  // Delete a single order (и убираем его из assignments по индексу)
  const handleDeleteOrder = useCallback(
    orderId => {
      const idx = orders.findIndex(o => o.id === orderId);
      if (idx < 0) return;
      setOrders(prev => prev.filter(o => o.id !== orderId));
      setAssignments(prev => {
        if (!prev || prev.length !== orders.length) return null;
        const next = prev.filter((_, i) => i !== idx);
        return next.length > 0 ? next : null;
      });
      setVariants([]);
      setActiveVariant(-1);
    },
    [orders]
  );

  // Clear all
  const handleClear = useCallback(() => {
    setOrders([]);
    setAssignments(null);
    setSelectedDriver(null);
    setVariants([]);
    setActiveVariant(-1);
    setManualMode(false);
    setRawText('');
  }, []);

  // Stats
  const stats = useMemo(() => {
    const total = orders.length;
    const geocoded = orders.filter(o => o.geocoded).length;
    const assigned = assignments ? assignments.filter(a => a >= 0).length : 0;
    return { total, geocoded, assigned };
  }, [orders, assignments]);

  // Driver routes (с привязкой к реальным водителям из БД)
  const driverRoutes = useMemo(() => {
    if (!assignments) return [];
    return Array.from({ length: driverCount }, (_, driverIdx) => {
      const driverOrders = orders.filter((_, i) => assignments[i] === driverIdx);
      const driverId = driverSlots[driverIdx] ?? null;
      const driver = dbDrivers.find(d => String(d.id) === String(driverId));
      let km = 0;
      const geo = driverOrders.filter(o => o.geocoded && o.lat && o.lng);
      for (let i = 0; i < geo.length - 1; i++) {
        const R = 6371;
        const dLat = ((geo[i + 1].lat - geo[i].lat) * Math.PI) / 180;
        const dLng = ((geo[i + 1].lng - geo[i].lng) * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos((geo[i].lat * Math.PI) / 180) *
            Math.cos((geo[i + 1].lat * Math.PI) / 180) *
            Math.sin(dLng / 2) ** 2;
        km += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      }
      return {
        index: driverIdx,
        driverId,
        driverName: driver ? driver.name : `Водитель ${driverIdx + 1}`,
        orders: driverOrders,
        color: DRIVER_COLORS[driverIdx % DRIVER_COLORS.length],
        km: Math.round(km * 10) / 10,
      };
    });
  }, [orders, assignments, driverCount, driverSlots, dbDrivers]);

  // Синхронизация маршрутов водителей с БД при изменении назначений (с задержкой)
  useEffect(() => {
    if (!assignments || driverSlots.length === 0) return;
    const routeDate = new Date().toISOString().slice(0, 10);
    const t = setTimeout(() => {
      const done = new Set();
      driverSlots.forEach((driverId, slotIdx) => {
        if (!driverId || done.has(driverId)) return;
        const points = orders
          .map((o, i) => (assignments[i] === slotIdx && o.geocoded && o.lat != null && o.lng != null ? { address: o.address, lat: o.lat, lng: o.lng, phone: o.phone || null, timeSlot: o.timeSlot || null, formattedAddress: o.formattedAddress || null } : null))
          .filter(Boolean);
        done.add(driverId);
        if (points.length === 0) {
          clearActiveRoute(driverId, routeDate).catch(() => {});
        } else {
          syncDriverRoute(driverId, routeDate, points.map((p, i) => ({ ...p, orderNum: i + 1 }))).catch(() => {});
        }
      });
    }, 2000);
    return () => clearTimeout(t);
  }, [assignments, orders, driverSlots]);

  // Display orders (с фильтром по выбранному водителю)
  const displayOrders = useMemo(() => {
    const all = orders.map((o, i) => ({
      ...o,
      driverIndex: assignments ? assignments[i] : -1,
      orderNum: i + 1,
      globalIndex: i,
    }));
    if (!assignments || selectedDriver === null || selectedDriver === -1) return all;
    return all.filter(o => o.driverIndex === selectedDriver);
  }, [orders, assignments, selectedDriver]);

  // Секции для списка: поставщики, партнёры, адреса (для заголовков)
  const supplierItems = useMemo(() => displayOrders.filter((o) => o.isSupplier), [displayOrders]);
  const partnerItems = useMemo(() => displayOrders.filter((o) => o.isPartner), [displayOrders]);
  const addressItems = useMemo(() => displayOrders.filter((o) => !o.isSupplier && !o.isPartner && !o.poiId), [displayOrders]);

  return (
    <div className="app distribution-page" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header className="header" style={{ flexShrink: 0 }}>
        <div className="header-brand">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
          </svg>
          <h1>
            Drive<span>Control</span>
          </h1>
        </div>
        <div className="header-stats">
          {stats.total > 0 && (
            <>
              <div className="header-stat">
                Заказов: <strong>{stats.total}</strong>
              </div>
              <div className="header-stat">
                На карте: <strong>{stats.geocoded}</strong>
              </div>
              {stats.assigned > 0 && (
                <div className="header-stat">
                  Распределено: <strong>{stats.assigned}</strong>
                </div>
              )}
            </>
          )}
        </div>
      </header>

      <div className="dc-layout">
        <aside className="dc-sidebar-wrap">
          <div className="dc-sidebar-scroll">
          {/* Вставить список поставщиков */}
          <div className="sidebar-section">
            <details className="dc-bulk-details">
              <summary className="sidebar-section-title" style={{ cursor: 'pointer' }}>Вставить список поставщиков</summary>
              <textarea
                className="address-input"
                style={{ minHeight: 60, marginTop: 6 }}
                placeholder="Названия поставщиков, каждый с новой строки"
                value={supplierNamesText}
                onChange={(e) => setSupplierNamesText(e.target.value)}
                disabled={loadingSuppliersByName}
              />
              <div className="buttons-row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => handleAddSuppliersByNames(false)} disabled={loadingSuppliersByName}>Найти</button>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => handleAddSuppliersByNames(true)} disabled={loadingSuppliersByName}>+ Добавить</button>
                <button type="button" className="btn btn-outline btn-sm" onClick={handleAddSuppliers} disabled={loadingSuppliers}>Все на карту</button>
              </div>
            </details>
          </div>

          {/* Вставить список партнёров */}
          <div className="sidebar-section">
            <details className="dc-bulk-details">
              <summary className="sidebar-section-title" style={{ cursor: 'pointer' }}>Вставить список партнёров</summary>
              <textarea
                className="address-input"
                style={{ minHeight: 60, marginTop: 6 }}
                placeholder="Названия партнёров, каждый с новой строки"
                value={partnerNamesText}
                onChange={(e) => setPartnerNamesText(e.target.value)}
                disabled={loadingPartnersByName}
              />
              <div className="buttons-row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => handleAddPartnersByNames(false)} disabled={loadingPartnersByName}>Добавить список</button>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => handleAddPartnersByNames(true)} disabled={loadingPartnersByName}>+ Добавить</button>
                <button type="button" className="btn btn-outline btn-sm" onClick={handleAddPartners} disabled={loadingPartners}>Все на карту</button>
              </div>
            </details>
          </div>

          {/* POI (ПВЗ / склады) */}
          <div className="sidebar-section">
            <div className="sidebar-section-title" style={{ fontSize: 12, color: 'var(--text-muted)' }}>Отображение на карте</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {POI_DEFS.map((def) => {
                const active = orders.some((o) => o.poiId === def.id);
                return (
                  <button
                    key={def.id}
                    type="button"
                    className="btn btn-sm"
                    style={{
                      border: `2px solid ${active ? def.color : 'var(--border)'}`,
                      background: active ? def.color : 'transparent',
                      color: active ? '#fff' : 'var(--text-secondary)',
                    }}
                    onClick={() => handleTogglePoi(def.id)}
                  >
                    {def.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Input */}
          <div className="sidebar-section">
            <div className="sidebar-section-title">Ввод адресов</div>
            <textarea
              className="address-input"
              placeholder={
                orders.length > 0
                  ? `Вставьте дополнительные адреса и нажмите «+ Добавить»\n\nФормат: адрес [TAB] телефон [TAB] время`
                  : `Вставьте список адресов, каждый с новой строки.\nФормат: адрес [TAB] телефон [TAB] время\n\nПример:\nул. Немига 12\tтелефон\t9:00-12:00\nпр-т Независимости 45\tтелефон\t14:00-18:00`
              }
              value={rawText}
              onChange={e => setRawText(e.target.value)}
              disabled={isGeocoding}
            />
            {orders.length > 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Загружено точек: <strong>{orders.length}</strong> (найдено:{' '}
                {orders.filter(o => o.geocoded).length})
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="sidebar-section">
            <div className="controls-row">
              <div className="control-group">
                <label>Водителей</label>
                <input
                  type="number"
                  className="control-input"
                  min={1}
                  max={12}
                  value={driverCount}
                  onChange={e =>
                    setDriverCount(
                      Math.max(1, Math.min(12, parseInt(e.target.value, 10) || 1)),
                    )
                  }
                />
              </div>
              <div className="buttons-row" style={{ flex: 1, flexWrap: 'wrap' }}>
                {orders.length === 0 ? (
                  <button
                    className="btn btn-primary"
                    onClick={handleLoadAddresses}
                    disabled={isGeocoding || !rawText.trim()}
                  >
                    {isGeocoding ? (
                      <>
                        <span
                          className="spinner"
                          style={{ width: 14, height: 14, borderWidth: 2 }}
                        />
                        {geocodeProgress.current}/{geocodeProgress.total}
                      </>
                    ) : (
                      'На карту'
                    )}
                  </button>
                ) : (
                  <>
                    <button
                      className="btn btn-primary"
                      onClick={handleAppendAddresses}
                      disabled={isGeocoding || !rawText.trim()}
                      title="Добавить к существующим точкам"
                    >
                      {isGeocoding ? (
                        <>
                          <span
                            className="spinner"
                            style={{ width: 14, height: 14, borderWidth: 2 }}
                          />
                          {geocodeProgress.current}/{geocodeProgress.total}
                        </>
                      ) : (
                        '+ Добавить'
                      )}
                    </button>
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={handleLoadAddresses}
                      disabled={isGeocoding || !rawText.trim()}
                      title="Заменить все точки новыми"
                    >
                      Заменить всё
                    </button>
                  </>
                )}
                {orders.length > 0 && stats.geocoded > 0 && (
                  <button
                    className="btn btn-success"
                    onClick={handleDistributeClick}
                    disabled={isGeocoding}
                  >
                    Распределить
                  </button>
                )}
                {orders.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    onClick={handleRefresh1C}
                    disabled={isGeocoding}
                    title="Подтянуть новые заказы из 1С"
                  >
                    Обновить из 1С
                  </button>
                )}
                {assignments && (
                  <button
                    className={`btn ${manualMode ? 'btn-primary' : 'btn-outline'} btn-sm`}
                    onClick={handleToggleManual}
                    title="Ручное назначение водителей"
                  >
                    {manualMode ? 'Готово' : 'Вручную'}
                  </button>
                )}
                {assignments && driverSlots.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-success btn-sm"
                    onClick={handleFinishRoute}
                    disabled={finishLoading}
                    title="Сохранить маршруты в БД для водителей"
                  >
                    {finishLoading ? '...' : 'Завершить маршрут'}
                  </button>
                )}
                {orders.length > 0 && (
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => setShowClearModal(true)}
                  >
                    Сбросить данные
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Variant selector */}
          {variants.length > 0 && (
            <div className="sidebar-section" style={{ paddingBottom: 8 }}>
              <div className="sidebar-section-title">Варианты распределения</div>
              <div className="variant-cards">
                {variants.map((v, idx) => (
                  <button
                    key={idx}
                    className={`variant-card ${activeVariant === idx ? 'active' : ''}`}
                    onClick={() => handleSelectVariant(idx)}
                  >
                    <div className="variant-label">{v.label}</div>
                    <div className="variant-desc">{v.description}</div>
                    <div className="variant-stats">
                      {v.stats.map((s, d) => (
                        <span key={d} className="variant-driver-stat">
                          <span
                            className="driver-color-dot"
                            style={{ background: DRIVER_COLORS[d] }}
                          />
                          {s.count} шт · {s.km} км
                        </span>
                      ))}
                    </div>
                  </button>
                ))}
                {activeVariant === -1 && assignments && (
                  <div
                    className="variant-card active"
                    style={{ borderColor: 'var(--warning)' }}
                  >
                    <div className="variant-label">Ручная настройка</div>
                    <div className="variant-desc">Изменено вручную</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Manual mode: driver picker */}
          {manualMode && (
            <div
              className="sidebar-section"
              style={{
                background: 'var(--accent-light)',
                paddingTop: 10,
                paddingBottom: 10,
              }}
            >
              <div
                className="sidebar-section-title"
                style={{ color: 'var(--accent)', marginBottom: 6 }}
              >
                Выберите водителя, затем кликайте на заказы
              </div>
              <div className="buttons-row">
                {(driverRoutes.length ? driverRoutes : Array.from({ length: driverCount }, (_, i) => ({ index: i, driverName: `В${i + 1}`, color: DRIVER_COLORS[i % DRIVER_COLORS.length] }))).map((dr) => (
                  <button
                    key={dr.index}
                    className={`btn btn-sm ${assigningDriver === dr.index ? 'btn-primary' : 'btn-outline'}`}
                    style={assigningDriver === dr.index ? { background: dr.color, borderColor: dr.color } : {}}
                    onClick={() => setAssigningDriver(dr.index)}
                  >
                    <span className="driver-color-dot" style={{ background: dr.color }} />
                    {typeof dr.driverName === 'string' ? dr.driverName.split(' ')[0] : `В${dr.index + 1}`}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Driver tabs */}
          {assignments && (
            <div className="driver-tabs">
              <button
                className={`driver-tab ${
                  selectedDriver === null || selectedDriver === -1 ? 'active' : ''
                }`}
                onClick={() => setSelectedDriver(null)}
              >
                Все <span className="tab-count">{stats.total}</span>
              </button>
              {driverRoutes.map(dr => (
                <button
                  key={dr.index}
                  className={`driver-tab ${
                    selectedDriver === dr.index ? 'active' : ''
                  }`}
                  onClick={() => setSelectedDriver(dr.index)}
                  style={selectedDriver === dr.index ? { borderBottomColor: dr.color } : {}}
                >
                  <span
                    className="driver-color-dot"
                    style={{ background: dr.color }}
                  />
                  {dr.driverName ? dr.driverName.split(' ')[0] : `В${dr.index + 1}`}
                  <span className="tab-count">
                    {dr.orders.length} шт · {dr.km} км
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Массовое назначение выбранных */}
          {selectedOrderIds.size > 0 && assignments && driverRoutes.length > 0 && (
            <div className="sidebar-section" style={{ background: 'var(--accent-light)', padding: 8, borderRadius: 8 }}>
              <div style={{ fontSize: 12, marginBottom: 6 }}>Выбрано точек: <strong>{selectedOrderIds.size}</strong></div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setSelectedOrderIds(new Set())}>Снять выбор</button>
                {driverRoutes.map((dr) => (
                  <button
                    key={dr.index}
                    type="button"
                    className="btn btn-sm"
                    style={{ background: dr.color, color: '#fff', border: 'none' }}
                    onClick={() => handleBulkAssign(dr.index)}
                  >
                    {dr.driverName ? dr.driverName.split(' ')[0] : `В${dr.index + 1}`}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Поиск по точкам */}
          {orders.length > 0 && (
            <div className="sidebar-section">
              <input
                type="text"
                className="form-input"
                placeholder="Поиск по точкам на карте..."
                value={pointSearchQuery}
                onChange={(e) => {
                  setPointSearchQuery(e.target.value);
                  const q = e.target.value.trim().toLowerCase().replace(/ё/g, 'е');
                  if (q.length < 2) {
                    setPointSearchResults([]);
                    setShowSearchResults(false);
                    return;
                  }
                  const norm = (s) => (s || '').toLowerCase().replace(/ё/g, 'е');
                  const matches = orders
                    .map((o, i) => ({ order: o, i }))
                    .filter(({ order }) => order.geocoded && norm(order.address + ' ' + (order.formattedAddress || '') + ' ' + (order.phone || '')).includes(q))
                    .slice(0, 15);
                  setPointSearchResults(matches);
                  setShowSearchResults(matches.length > 0);
                }}
                onFocus={() => pointSearchResults.length > 0 && setShowSearchResults(true)}
              />
              {showSearchResults && pointSearchResults.length > 0 && (
                <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, marginTop: 4 }}>
                  {pointSearchResults.map(({ order, i }) => (
                    <div
                      key={order.id}
                      role="button"
                      tabIndex={0}
                      style={{ padding: '6px 8px', cursor: 'pointer', fontSize: 12, borderBottom: '1px solid var(--border)' }}
                      onClick={() => {
                        setShowSearchResults(false);
                        setPointSearchQuery('');
                        if (window.__drivecontrol_centerOrder) window.__drivecontrol_centerOrder(order.lat, order.lng);
                      }}
                    >
                      {order.isSupplier ? '📦 ' : order.isPartner ? '🤝 ' : '📍 '}{order.address}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Orders list */}
          <div className="orders-list-container">
            {orders.length === 0 ? (
              <div className="empty-state">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <line x1="12" y1="8" x2="12" y2="16" />
                  <line x1="8" y1="12" x2="16" y2="12" />
                </svg>
                <h3>Нет заказов</h3>
                <p>Вставьте список адресов в поле выше и нажмите «На карту»</p>
              </div>
            ) : (
              <>
                <div className="orders-list-header">
                  <h3>
                    {selectedDriver !== null && selectedDriver >= 0 && driverRoutes[selectedDriver]
                      ? driverRoutes[selectedDriver].driverName
                      : selectedDriver !== null && selectedDriver >= 0
                      ? `Водитель ${selectedDriver + 1}`
                      : 'Все заказы'}
                  </h3>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {displayOrders.length} шт.
                  </span>
                </div>
                {displayOrders.map(order => {
                  const driverIdx = order.driverIndex;
                  const color =
                    driverIdx >= 0
                      ? DRIVER_COLORS[driverIdx % DRIVER_COLORS.length]
                      : undefined;
                  const isEditing = editingOrderId === order.id;
                  const isPlacing = placingOrderId === order.id;
                  const isFailed = !order.geocoded && order.error;

                  return (
                    <div key={order.id}>
                      <div
                        className={`order-item ${
                          driverIdx >= 0 ? 'assigned' : ''
                        } ${manualMode ? 'clickable' : ''} ${
                          isPlacing ? 'placing' : ''
                        }`}
                        style={{
                          borderLeftColor: driverIdx >= 0 ? color : undefined,
                          borderLeftWidth: isFailed ? 3 : undefined,
                          ...(isFailed && driverIdx < 0
                            ? { borderLeftColor: 'var(--danger)' }
                            : {}),
                        }}
                        onClick={() => manualMode && handleManualAssign(order.globalIndex)}
                      >
                        {assignments && (
                          <input
                            type="checkbox"
                            checked={selectedOrderIds.has(order.id)}
                            onChange={(e) => {
                              e.stopPropagation();
                              toggleOrderSelected(order.id);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            style={{ marginRight: 6, flexShrink: 0 }}
                          />
                        )}
                        <div
                          className="order-number"
                          style={
                            driverIdx >= 0
                              ? { background: color, color: '#fff' }
                              : isFailed
                              ? { background: 'var(--danger)', color: '#fff' }
                              : {}
                          }
                        >
                          {order.orderNum}
                        </div>
                        <div className="order-info">
                          <div
                            className="order-address"
                            title={order.formattedAddress || order.address}
                          >
                            {order.address}
                          </div>
                          <div className="order-time">
                            {order.timeSlot && <span>⏰ {order.timeSlot}</span>}
                            {order.phone && (
                              <span
                                style={{
                                  marginLeft: order.timeSlot ? 8 : 0,
                                }}
                              >
                                📞 {order.phone}
                              </span>
                            )}
                            {order.formattedAddress && (
                              <span
                                style={{
                                  marginLeft:
                                    order.timeSlot || order.phone ? 8 : 0,
                                  opacity: 0.7,
                                  display: 'block',
                                }}
                              >
                                📍 {order.formattedAddress}
                              </span>
                            )}
                          </div>
                        </div>
                        {manualMode ? (
                          <span
                            className="order-status"
                            style={{
                              background: 'var(--accent-light)',
                              color: 'var(--accent)',
                              cursor: 'pointer',
                            }}
                          >
                            {driverIdx >= 0 ? `В${driverIdx + 1}` : '?'}
                          </span>
                        ) : order.geocoded ? (
                          <div
                            style={{
                              display: 'flex',
                              gap: 4,
                              flexShrink: 0,
                              alignItems: 'center',
                            }}
                          >
                            <span className="order-status geocoded">✓</span>
                            <button
                              className="btn-icon-delete"
                              onClick={e => {
                                e.stopPropagation();
                                handleDeleteOrder(order.id);
                              }}
                              title="Удалить точку"
                            >
                              ×
                            </button>
                          </div>
                        ) : order.error ? (
                          <div
                            style={{
                              display: 'flex',
                              gap: 4,
                              flexShrink: 0,
                            }}
                          >
                            <button
                              className="btn btn-sm btn-outline"
                              onClick={e => {
                                e.stopPropagation();
                                handleStartEdit(order);
                              }}
                              title="Изменить адрес"
                            >
                              ✎
                            </button>
                            <button
                              className="btn btn-sm btn-outline"
                              onClick={e => {
                                e.stopPropagation();
                                handleStartPlacing(order.id);
                              }}
                              title="Поставить на карте"
                            >
                              📍
                            </button>
                            <button
                              className="btn-icon-delete"
                              onClick={e => {
                                e.stopPropagation();
                                handleDeleteOrder(order.id);
                              }}
                              title="Удалить точку"
                            >
                              ×
                            </button>
                          </div>
                        ) : (
                          <span className="order-status pending">...</span>
                        )}
                      </div>

                      {/* Inline address editor */}
                      {isEditing && (
                        <div className="order-edit-row">
                          <input
                            className="order-edit-input"
                            value={editAddress}
                            onChange={e => setEditAddress(e.target.value)}
                            onKeyDown={e =>
                              e.key === 'Enter' && handleRetryGeocode(order.id)
                            }
                            placeholder="Введите адрес..."
                            autoFocus
                          />
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={() => handleRetryGeocode(order.id)}
                            disabled={isRetrying || !editAddress.trim()}
                          >
                            {isRetrying ? '...' : 'Найти'}
                          </button>
                          <button
                            className="btn btn-sm btn-outline"
                            onClick={() => setEditingOrderId(null)}
                          >
                            ✕
                          </button>
                        </div>
                      )}

                      {/* Placing indicator */}
                      {isPlacing && (
                        <div
                          className="order-edit-row"
                          style={{ color: 'var(--warning)', fontSize: 12 }}
                        >
                          👆 Кликните на карту для установки точки
                          <button
                            className="btn btn-sm btn-outline"
                            onClick={() => setPlacingOrderId(null)}
                            style={{ marginLeft: 'auto' }}
                          >
                            Отмена
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
          </div>
        </aside>

        {/* Карта занимает всё остальное пространство справа (как в старой версии) */}
        <div className="dc-map-wrap">
        <YandexMapView
          orders={orders}
          assignments={assignments}
          driverCount={driverCount}
          selectedDriver={selectedDriver}
          onAssignDriver={handleMapAssignDriver}
          onDeleteOrder={handleDeleteOrder}
          placingMode={!!placingOrderId}
          onMapClick={handleMapClick}
        />

        {/* Map legend */}
        {assignments && (
          <div className="map-info-panel">
            <h4>Водители</h4>
            {driverRoutes.map(dr => (
              <div
                key={dr.index}
                className="map-legend-item"
                style={{
                  cursor: 'pointer',
                  opacity:
                    selectedDriver === null || selectedDriver === dr.index ? 1 : 0.4,
                }}
                onClick={() =>
                  setSelectedDriver(
                    selectedDriver === dr.index ? null : dr.index,
                  )
                }
              >
                <span
                  className="driver-color-dot"
                  style={{ background: dr.color }}
                />
                <span>{dr.driverName || `Водитель ${dr.index + 1}`}</span>
                <span className="count">
                  {dr.orders.length} шт · {dr.km} км
                </span>
              </div>
            ))}
          </div>
        )}
        </div>
      </div>

      {/* Модалка: Распределить маршрут — выбор водителей */}
      {showDistributeModal && (
        <div className="modal" style={{ display: 'flex' }}>
          <div className="modal-content" style={{ maxWidth: 400 }}>
            <h3 className="modal-title" style={{ textAlign: 'center' }}>Распределить маршрут</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>Выберите водителей для распределения:</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 300, overflowY: 'auto' }}>
              {dbDrivers.map((dr, di) => {
                const checked = distributeSelectedIds.includes(dr.id);
                const color = DRIVER_COLORS[di % DRIVER_COLORS.length];
                return (
                  <label
                    key={dr.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setDistributeSelectedIds((prev) =>
                          prev.includes(dr.id)
                            ? prev.filter((id) => id !== dr.id)
                            : [...prev, dr.id]
                        );
                      }}
                      style={{ accentColor: color }}
                    />
                    <span style={{ width: 12, height: 12, borderRadius: '50%', background: color, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 13 }}>{dr.name}</span>
                  </label>
                );
              })}
            </div>
            {dbDrivers.length === 0 && (
              <p className="muted" style={{ marginTop: 8 }}>Нет водителей в базе. Добавьте водителей в разделе «Водители».</p>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-primary"
                style={{ flex: 1 }}
                onClick={() => runDistribute(distributeSelectedIds)}
                disabled={distributeSelectedIds.length === 0}
              >
                Распределить
              </button>
              <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={() => setShowDistributeModal(false)}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Модалка: Сбросить данные */}
      {showClearModal && (
        <div className="modal" style={{ display: 'flex' }}>
          <div className="modal-content" style={{ maxWidth: 380 }}>
            <h3 className="modal-title" style={{ textAlign: 'center' }}>Сбросить данные</h3>
            {clearStep === 1 && (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                    onClick={() => {
                      setClearTarget({ driverId: '__all__', driverName: 'Все' });
                      setClearStep(2);
                    }}
                  >
                    Все водители ({orders.length} точек)
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => {
                      setClearTarget({ driverId: '__unassigned__', driverName: 'Нераспределённые' });
                      setClearStep(2);
                    }}
                  >
                    Нераспределённые
                  </button>
                  {driverSlots.map((driverId, di) => {
                    const driver = dbDrivers.find((d) => String(d.id) === String(driverId));
                    const name = driver ? driver.name.split(' ')[0] : `В${di + 1}`;
                    const count = assignments ? assignments.filter((a, i) => a === di).length : 0;
                    return (
                      <button
                        key={driverId}
                        type="button"
                        className="btn btn-outline"
                        onClick={() => {
                          setClearTarget({ driverId, driverName: driver ? driver.name : name });
                          setClearStep(2);
                        }}
                      >
                        {name} ({count})
                      </button>
                    );
                  })}
                </div>
                <button type="button" className="btn btn-outline" style={{ marginTop: 12, width: '100%' }} onClick={() => setShowClearModal(false)}>
                  Отмена
                </button>
              </>
            )}
            {clearStep === 2 && clearTarget && (
              <>
                <p style={{ fontSize: 13, marginBottom: 10 }}>
                  Сбросить: <strong>{clearTarget.driverName}</strong>
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(() => {
                    const getOrderDriverId = (idx) => {
                      if (!assignments || idx < 0 || idx >= assignments.length) return null;
                      const slot = assignments[idx];
                      if (slot < 0 || slot >= driverSlots.length) return null;
                      return driverSlots[slot];
                    };
                    const isAll = clearTarget.driverId === '__all__';
                    const matchDriver = (i) =>
                      isAll || (clearTarget.driverId === '__unassigned__' ? !getOrderDriverId(i) : getOrderDriverId(i) != null && String(getOrderDriverId(i)) === String(clearTarget.driverId));
                    const supCount = orders.filter((o, i) => matchDriver(i) && o.isSupplier).length;
                    const addrCount = orders.filter((o, i) => matchDriver(i) && !o.isSupplier && !o.isPartner && !o.poiId).length;
                    return (
                      <>
                        {supCount > 0 && (
                          <button
                            type="button"
                            className="btn btn-outline"
                            style={{ color: '#10b981', borderColor: '#10b981' }}
                            onClick={() => doClear('suppliers', clearTarget.driverId, clearTarget.driverName)}
                          >
                            Поставщики ({supCount})
                          </button>
                        )}
                        {addrCount > 0 && (
                          <button
                            type="button"
                            className="btn btn-outline"
                            style={{ color: '#3b82f6', borderColor: '#3b82f6' }}
                            onClick={() => doClear('addresses', clearTarget.driverId, clearTarget.driverName)}
                          >
                            Адреса доставки ({addrCount})
                          </button>
                        )}
                        {supCount + addrCount > 0 && (
                          <button
                            type="button"
                            className="btn btn-outline"
                            style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                            onClick={() => doClear('all', clearTarget.driverId, clearTarget.driverName)}
                          >
                            Всё ({supCount + addrCount})
                          </button>
                        )}
                        {(supCount === 0 && addrCount === 0) && (
                          <p className="muted" style={{ textAlign: 'center', padding: 12 }}>Нет точек</p>
                        )}
                      </>
                    );
                  })()}
                </div>
                <button type="button" className="btn btn-outline" style={{ marginTop: 12, width: '100%' }} onClick={() => { setClearStep(1); setClearTarget(null); }}>
                  ← Назад
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Loading overlay */}
      {isGeocoding && (
        <div className="loading-overlay">
          <div className="spinner" />
          <div className="loading-text">
            Геокодирование адресов... {geocodeProgress.current}/{geocodeProgress.total}
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.type === 'success' ? '✓' : '⚠'} {toast.message}
        </div>
      )}
    </div>
  );
}

export default DistributionPage;

