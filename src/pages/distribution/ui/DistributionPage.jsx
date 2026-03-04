import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
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
  stripOrgForm,
  extractSupplierTimeSlot,
  compactName as compactNameHelper,
  findSupplierInDb,
  findPartnerInDb,
  loadJson,
  saveJson,
  SUPPLIER_ALIASES_KEY,
  PARTNER_ALIASES_KEY,
  DRIVER_COLORS_KEY,
  COLOR_PALETTE,
  DISTRIBUTION_DATA_KEY,
  DISTRIBUTION_SCHEMA_VERSION,
} from '../../../entities/distribution/lib/distributionHelpers.js';
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
import {
  loadDistributionState,
  saveDistributionState,
} from '../../../shared/api/distributionStateApi.js';

// POI (ПВЗ / склады) — фиксированные точки на карте
const POI_DEFS = [
  { id: 'pvz1', label: 'ПВЗ 1', short: 'П1', address: 'Минск, Притыцкого 89', color: '#2563eb' },
  { id: 'pvz2', label: 'ПВЗ 2', short: 'П2', address: 'Минск, Туровского 12', color: '#7c3aed' },
  { id: 'rbdodoma', label: 'РБ Додома', short: 'РБ', address: 'Минск, Железнодорожная 33к1', color: '#ea580c' },
];

function loadSavedDistributionState() {
  try {
    const raw = localStorage.getItem(DISTRIBUTION_DATA_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || !Array.isArray(d.orders)) return null;
    return {
      orders: d.orders,
      assignments: d.assignments ?? null,
      driverCount: Math.max(1, Math.min(12, Number(d.driverCount) || 3)),
      driverSlots: Array.isArray(d.driverSlots) ? d.driverSlots : [],
      activeVariant: typeof d.activeVariant === 'number' ? d.activeVariant : -1,
      poiCoords: d.poiCoords && typeof d.poiCoords === 'object' ? d.poiCoords : {},
    };
  } catch {
    return null;
  }
}

function DistributionPage() {
  const savedState = useMemo(() => loadSavedDistributionState(), []);

  const [rawText, setRawText] = useState('');
  const [orders, setOrders] = useState(() => savedState?.orders ?? []);
  const [driverCount, setDriverCount] = useState(() => savedState ? Math.max(1, Math.min(12, savedState.driverCount || 3)) : 3);
  const [assignments, setAssignments] = useState(() => savedState?.assignments ?? null);
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geocodeProgress, setGeocodeProgress] = useState({ current: 0, total: 0 });
  const [toast, setToast] = useState(null);

  // Водители, поставщики, партнёры из БД (как в старой версии)
  const [dbDrivers, setDbDrivers] = useState([]);
  const [dbSuppliers, setDbSuppliers] = useState([]);
  const [dbPartners, setDbPartners] = useState([]);
  const [driverSlots, setDriverSlots] = useState(() => savedState?.driverSlots ?? []); // [driver_id, ...] по индексу слота

  // Поиск поставщика/партнёра по базе (сквозной поиск как в старой версии)
  const [supplierSearchQuery, setSupplierSearchQuery] = useState('');
  const [showSupplierSuggest, setShowSupplierSuggest] = useState(false);
  const [partnerSearchQuery, setPartnerSearchQuery] = useState('');
  const [showPartnerSuggest, setShowPartnerSuggest] = useState(false);

  // Variants
  const [variants, setVariants] = useState([]);
  const [activeVariant, setActiveVariant] = useState(() => savedState?.activeVariant ?? -1);

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
  const [poiCoords, setPoiCoords] = useState(() => savedState?.poiCoords ?? {}); // { pvz1: { lat, lng }, ... }

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

  // Алиасы: введённое имя (compact) → supplier.id / partner.id (localStorage)
  const [supplierAliases, setSupplierAliases] = useState(() => loadJson(SUPPLIER_ALIASES_KEY, {}));
  const [partnerAliases, setPartnerAliases] = useState(() => loadJson(PARTNER_ALIASES_KEY, {}));
  // Кастомные цвета водителей: driverId → hex
  const [driverCustomColors, setDriverCustomColors] = useState(() => loadJson(DRIVER_COLORS_KEY, {}));
  // Режим редактирования маршрута одного водителя
  const [editingDriverId, setEditingDriverId] = useState(null);
  // Подсветка точки на карте при наведении на строку в сайдбаре
  const [hoveredOrderId, setHoveredOrderId] = useState(null);
  // Модалки: найти в базе (supplier/partner), завершить поставщиков, создать поставщика/партнёра
  const [findSupplierOrderId, setFindSupplierOrderId] = useState(null);
  const [findPartnerOrderId, setFindPartnerOrderId] = useState(null);
  const [showFinishSuppliersModal, setShowFinishSuppliersModal] = useState(false);
  const [createSupplierOrderId, setCreateSupplierOrderId] = useState(null);
  const [showCreatePartner, setShowCreatePartner] = useState(false);
  // Палитра цвета водителя (по клику на кружок)
  const [colorPickerDriverId, setColorPickerDriverId] = useState(null);
  // Позиция выпадающего списка подсказок (сквозной поиск) — чтобы не обрезался в сайдбаре
  const supplierSearchRef = useRef(null);
  const partnerSearchRef = useRef(null);
  const [supplierDropdownRect, setSupplierDropdownRect] = useState(null);
  const [partnerDropdownRect, setPartnerDropdownRect] = useState(null);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  // Нормализация для поиска (как в старой версии: compactName) — для UI-поиска по списку
  const compactName = useCallback((s) => {
    if (s == null) return '';
    return String(s).toLowerCase().replace(/\s+/g, '').replace(/ё/g, 'е').replace(/[^a-zа-яё0-9]/gi, '');
  }, []);

  // Сохранение алиасов и цветов в localStorage при изменении
  useEffect(() => {
    saveJson(SUPPLIER_ALIASES_KEY, supplierAliases);
  }, [supplierAliases]);
  useEffect(() => {
    saveJson(PARTNER_ALIASES_KEY, partnerAliases);
  }, [partnerAliases]);
  useEffect(() => {
    saveJson(DRIVER_COLORS_KEY, driverCustomColors);
  }, [driverCustomColors]);

  // Позиция выпадающего списка подсказок при показе (чтобы портал отрисовался в нужном месте)
  useEffect(() => {
    if (showSupplierSuggest && supplierSearchQuery.trim().length >= 1 && supplierSearchRef.current) {
      setSupplierDropdownRect(supplierSearchRef.current.getBoundingClientRect());
    }
  }, [showSupplierSuggest, supplierSearchQuery]);
  useEffect(() => {
    if (showPartnerSuggest && partnerSearchQuery.trim().length >= 1 && partnerSearchRef.current) {
      setPartnerDropdownRect(partnerSearchRef.current.getBoundingClientRect());
    }
  }, [showPartnerSuggest, partnerSearchQuery]);

  // Запомнить алиас поставщика (введённое имя → supplier.id)
  const rememberSupplierAlias = useCallback((inputName, supplier) => {
    if (!inputName || !supplier?.id) return;
    const key = compactNameHelper(inputName);
    if (!key || key.length < 2) return;
    setSupplierAliases((prev) => ({ ...prev, [key]: supplier.id }));
  }, []);
  // Запомнить алиас партнёра
  const rememberPartnerAlias = useCallback((inputName, partner) => {
    if (!inputName || !partner?.id) return;
    const key = compactNameHelper(inputName);
    if (!key || key.length < 2) return;
    setPartnerAliases((prev) => ({ ...prev, [key]: partner.id }));
  }, []);

  // Результаты поиска поставщиков по базе
  const supplierSuggestResults = useMemo(() => {
    const q = compactName(supplierSearchQuery);
    if (!q || q.length < 1) return [];
    const list = dbSuppliers || [];
    const results = [];
    for (let i = 0; i < list.length && results.length < 10; i++) {
      const s = list[i];
      const sn = compactName(s.name);
      if (sn && sn.includes(q)) results.push(s);
    }
    return results;
  }, [supplierSearchQuery, dbSuppliers, compactName]);

  // Результаты поиска партнёров по базе
  const partnerSuggestResults = useMemo(() => {
    const q = compactName(partnerSearchQuery);
    if (!q || q.length < 1) return [];
    const list = dbPartners || [];
    const results = [];
    for (let i = 0; i < list.length && results.length < 10; i++) {
      const p = list[i];
      const pn = compactName(p.name);
      if (pn && pn.includes(q)) results.push(p);
    }
    return results;
  }, [partnerSearchQuery, dbPartners, compactName]);

  // При загрузке страницы — справочники и состояние распределения из Supabase (по дате сегодня)
  useEffect(() => {
    Promise.all([
      fetchDrivers().catch(() => []),
      fetchSuppliers().catch(() => []),
      fetchPartners().catch(() => []),
    ]).then(([drivers, suppliers, partners]) => {
      setDbDrivers(drivers || []);
      setDbSuppliers(suppliers || []);
      setDbPartners(partners || []);
    });
  }, []);

  // Загрузить состояние распределения из Supabase на сегодня (перезаписывает localStorage при успехе)
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    loadDistributionState(today).then((cloud) => {
      if (cloud && Array.isArray(cloud.orders)) {
        setOrders(cloud.orders);
        setAssignments(cloud.assignments ?? null);
        setDriverCount(Math.max(1, Math.min(12, cloud.driverCount || 3)));
        setDriverSlots(Array.isArray(cloud.driverSlots) ? cloud.driverSlots : []);
        setActiveVariant(typeof cloud.activeVariant === 'number' ? cloud.activeVariant : -1);
        setPoiCoords(cloud.poiCoords && typeof cloud.poiCoords === 'object' ? cloud.poiCoords : {});
      }
    });
  }, []);

  // Сохранять состояние в Supabase и в localStorage (резерв) при изменении точек/назначений
  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    const snapshot = {
      orders,
      assignments,
      driverCount,
      driverSlots,
      activeVariant,
      poiCoords,
      schemaVersion: DISTRIBUTION_SCHEMA_VERSION,
    };
    const t = setTimeout(() => {
      saveDistributionState(today, snapshot);
      saveJson(DISTRIBUTION_DATA_KEY, snapshot);
    }, 1500);
    return () => clearTimeout(t);
  }, [orders, assignments, driverCount, driverSlots, activeVariant, poiCoords]);

  // Геокодинг и загрузка заказов из 1С — только по кнопкам «На карту», «Обновить из 1С» и т.д., не при открытии страницы.

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

  // Добавить поставщиков по списку имён: stripOrgForm, extractSupplierTimeSlot, findSupplierInDb
  const handleAddSuppliersByNames = useCallback(
    async (append) => {
      const lines = supplierNamesText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length === 0) {
        showToast('Вставьте названия поставщиков, каждый с новой строки', 'error');
        return;
      }
      setLoadingSuppliersByName(true);
      try {
        const suppliers = await fetchSuppliers();
        const newOrders = [];
        let foundCount = 0;
        let notFoundCount = 0;
        for (let i = 0; i < lines.length; i++) {
          const rawLine = lines[i];
          const { name, timeSlot } = extractSupplierTimeSlot(rawLine);
          const displayName = name || rawLine;
          const cleanName = stripOrgForm(name || rawLine);
          const supplier = findSupplierInDb(cleanName, suppliers, supplierAliases, compactNameHelper);
          const uniq = `supplier-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`;
          if (supplier && Number.isFinite(parseFloat(supplier.lat)) && Number.isFinite(parseFloat(supplier.lon))) {
            foundCount++;
            newOrders.push({
              id: uniq,
              address: displayName,
              lat: parseFloat(supplier.lat),
              lng: parseFloat(supplier.lon),
              geocoded: true,
              formattedAddress: supplier.address || '',
              error: null,
              phone: '',
              timeSlot: timeSlot || supplier.working_hours || null,
              isSupplier: true,
              supplierDbId: supplier.id,
              supplierName: displayName,
              sourceSupplierName: rawLine,
            });
          } else if (supplier && (!supplier.lat || !supplier.lon)) {
            notFoundCount++;
            newOrders.push({
              id: uniq,
              address: displayName,
              geocoded: false,
              lat: null,
              lng: null,
              formattedAddress: null,
              error: 'Нет координат в базе',
              phone: '',
              timeSlot: timeSlot || supplier.working_hours || null,
              isSupplier: true,
              supplierDbId: supplier.id,
              supplierName: displayName,
              sourceSupplierName: rawLine,
            });
          } else {
            notFoundCount++;
            newOrders.push({
              id: uniq,
              address: displayName,
              geocoded: false,
              lat: null,
              lng: null,
              formattedAddress: null,
              error: 'Не найден в базе',
              phone: '',
              timeSlot: timeSlot || null,
              isSupplier: true,
              supplierDbId: null,
              supplierName: displayName,
              sourceSupplierName: rawLine,
            });
          }
        }
        if (append) setOrders((prev) => [...prev, ...newOrders]);
        else setOrders((prev) => [...newOrders, ...prev.filter((o) => !o.isSupplier)]);
        setAssignments((prev) => (append && prev ? [...prev, ...newOrders.map(() => -1)] : null));
        setVariants([]);
        setActiveVariant(-1);
        setSupplierNamesText('');
        showToast(
          `Поставщики: найдено ${foundCount}` + (notFoundCount > 0 ? `, не найдено: ${notFoundCount}` : ''),
          notFoundCount > 0 ? 'error' : 'success'
        );
      } catch (e) {
        showToast('Ошибка: ' + (e.message || e), 'error');
      } finally {
        setLoadingSuppliersByName(false);
      }
    },
    [supplierNamesText, supplierAliases, showToast]
  );

  // Добавить партнёров по списку имён: findPartnerInDb, алиасы
  const handleAddPartnersByNames = useCallback(
    async (append) => {
      const names = partnerNamesText
        .split('\n')
        .map((l) => l.replace(/^\d+[\.):\-\s]+\s*/, '').trim())
        .filter(Boolean);
      if (names.length === 0) {
        showToast('Вставьте названия партнёров', 'error');
        return;
      }
      setLoadingPartnersByName(true);
      try {
        const partners = await fetchPartners();
        const newOrders = [];
        for (let i = 0; i < names.length; i++) {
          const rawLine = names[i];
          const partner = findPartnerInDb(rawLine, partners, partnerAliases, compactNameHelper);
          const uniq = `partner-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`;
          if (partner) {
            rememberPartnerAlias(rawLine, partner);
            const lat = parseFloat(partner.lat);
            const lon = parseFloat(partner.lon);
            if (Number.isFinite(lat) && Number.isFinite(lon)) {
              newOrders.push({
                id: uniq,
                address: rawLine,
                lat,
                lng: lon,
                geocoded: true,
                formattedAddress: partner.address || '',
                error: null,
                phone: '',
                timeSlot: null,
                isPartner: true,
                partnerDbId: partner.id,
                partnerName: rawLine,
              });
            } else {
              newOrders.push({
                id: uniq,
                address: rawLine,
                geocoded: false,
                lat: null,
                lng: null,
                formattedAddress: null,
                error: 'Нет координат — выберите точку на карте',
                phone: '',
                timeSlot: null,
                isPartner: true,
                partnerDbId: partner.id,
                partnerName: rawLine,
              });
            }
          } else {
            newOrders.push({
              id: uniq,
              address: rawLine,
              geocoded: false,
              lat: null,
              lng: null,
              formattedAddress: null,
              error: 'Не выбран — нажмите для поиска',
              phone: '',
              timeSlot: null,
              isPartner: true,
              partnerDbId: null,
              partnerName: rawLine,
            });
          }
        }
        if (append) setOrders((prev) => [...prev, ...newOrders]);
        else setOrders((prev) => [...newOrders, ...prev.filter((o) => !o.isPartner)]);
        setAssignments((prev) => (append && prev ? [...prev, ...newOrders.map(() => -1)] : null));
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
    [partnerNamesText, partnerAliases, rememberPartnerAlias, showToast]
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

  // Переключить выбор точки для массового назначения (из сайдбара или из балуна на карте)
  const toggleOrderSelected = useCallback((orderId) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }, []);

  // Из балуна на карте: добавить/убрать точку в выбор по индексу (для массового назначения водителя)
  const handleMapToggleOrderSelect = useCallback(
    (globalIdx) => {
      const order = orders[globalIdx];
      if (order?.id) toggleOrderSelected(order.id);
    },
    [orders, toggleOrderSelected]
  );

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

  // Assign driver from map balloon (driverIdx = slot index, -1 = Снять)
  const handleMapAssignDriver = useCallback(
    (globalIndex, driverIdx) => {
      if (!assignments) {
        const len = orders.length;
        const next = Array.from({ length: len }, (_, i) => (i === globalIndex ? (driverIdx >= 0 ? driverIdx : -1) : -1));
        setAssignments(next);
      } else {
        const newAssignments = [...assignments];
        newAssignments[globalIndex] = driverIdx >= 0 ? driverIdx : -1;
        setAssignments(newAssignments);
      }
      setActiveVariant(-1);
    },
    [assignments, orders.length],
  );

  // КБТ +1: переключить флаг на точке
  const handleToggleKbt = useCallback((globalIndex) => {
    setOrders((prev) =>
      prev.map((o, i) =>
        i === globalIndex
          ? { ...o, isKbt: !o.isKbt, helperDriverSlot: !o.isKbt ? (o.helperDriverSlot ?? null) : null }
          : o
      )
    );
  }, []);

  // Помощник (едет вместе) для КБТ
  const handleSetHelper = useCallback((globalIndex, helperSlot) => {
    setOrders((prev) =>
      prev.map((o, i) => (i === globalIndex ? { ...o, helperDriverSlot: helperSlot } : o))
    );
  }, []);

  // Привязать заказ к поставщику из базы (модалка «найти в базе»)
  const handleLinkSupplier = useCallback(
    (orderId, supplier) => {
      if (!supplier?.id) return;
      const idx = orders.findIndex((o) => o.id === orderId);
      if (idx < 0) return;
      const order = orders[idx];
      rememberSupplierAlias(order.sourceSupplierName || order.address || order.supplierName, supplier);
      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderId
            ? {
                ...o,
                supplierDbId: supplier.id,
                supplierName: supplier.name,
                address: supplier.name || o.address,
                lat: supplier.lat != null ? parseFloat(supplier.lat) : o.lat,
                lng: supplier.lon != null ? parseFloat(supplier.lon) : o.lng,
                formattedAddress: supplier.address || o.formattedAddress,
                geocoded: Number.isFinite(parseFloat(supplier.lat)) && Number.isFinite(parseFloat(supplier.lon)),
                error: null,
                timeSlot: supplier.working_hours || o.timeSlot,
              }
            : o
        )
      );
      setFindSupplierOrderId(null);
      showToast('Поставщик привязан');
    },
    [orders, rememberSupplierAlias, showToast]
  );

  // Привязать заказ к партнёру из базы
  const handleLinkPartner = useCallback(
    (orderId, partner) => {
      if (!partner?.id) return;
      const idx = orders.findIndex((o) => o.id === orderId);
      if (idx < 0) return;
      const order = orders[idx];
      rememberPartnerAlias(order.partnerName || order.address, partner);
      setOrders((prev) =>
        prev.map((o) =>
          o.id === orderId
            ? {
                ...o,
                partnerDbId: partner.id,
                partnerName: partner.name,
                address: partner.name || o.address,
                lat: partner.lat != null ? parseFloat(partner.lat) : o.lat,
                lng: partner.lon != null ? parseFloat(partner.lon) : o.lng,
                formattedAddress: partner.address || o.formattedAddress,
                geocoded: Number.isFinite(parseFloat(partner.lat)) && Number.isFinite(parseFloat(partner.lon)),
                error: null,
              }
            : o
        )
      );
      setFindPartnerOrderId(null);
      showToast('Партнёр привязан');
    },
    [orders, rememberPartnerAlias, showToast]
  );

  // Завершить поставщиков по водителю: сохранить маршрут, убрать точки с карты (skipClose для кнопки «Все водители»)
  const handleFinishSupplierRoute = useCallback(
    async (driverId, skipClose = false) => {
      const routeDate = new Date().toISOString().slice(0, 10);
      const driverName = dbDrivers.find((d) => String(d.id) === String(driverId))?.name ?? 'Водитель';
      const supplierPoints = [];
      const indicesToRemove = [];
      orders.forEach((o, i) => {
        if (!o.isSupplier || !o.geocoded || o.poiId) return;
        const slot = assignments?.[i];
        if (slot == null || slot < 0) return;
        const did = driverSlots[slot];
        if (!did || String(did) !== String(driverId)) return;
        supplierPoints.push({
          address: o.address,
          lat: o.lat,
          lng: o.lng,
          phone: o.phone || null,
          timeSlot: o.timeSlot || null,
          formattedAddress: o.formattedAddress || null,
          orderNum: supplierPoints.length + 1,
          isSupplier: true,
        });
        indicesToRemove.push(i);
      });
      if (supplierPoints.length === 0) {
        showToast('Нет поставщиков для ' + driverName, 'error');
        return;
      }
      try {
        await syncDriverRoute(driverId, routeDate, supplierPoints);
        const toRemove = new Set(indicesToRemove.sort((a, b) => b - a));
        setOrders((prev) => prev.filter((_, i) => !toRemove.has(i)));
        setAssignments((prev) => (prev ? prev.filter((_, i) => !toRemove.has(i)) : null));
        if (!skipClose) setShowFinishSuppliersModal(false);
        showToast('Поставщики для ' + driverName + ' завершены (' + supplierPoints.length + ')');
      } catch (err) {
        showToast('Ошибка: ' + (err?.message || err), 'error');
      }
    },
    [orders, assignments, driverSlots, dbDrivers, showToast]
  );

  // Завершить поставщиков по всем водителям (одним сценарием, чтобы не ломать индексы)
  const handleFinishAllSupplierRoutes = useCallback(async () => {
    const routeDate = new Date().toISOString().slice(0, 10);
    const byDriver = {};
    const allIndices = new Set();
    orders.forEach((o, i) => {
      if (!o.isSupplier || !o.geocoded || o.poiId) return;
      const slot = assignments?.[i];
      if (slot == null || slot < 0) return;
      const did = driverSlots[slot];
      if (!did) return;
      if (!byDriver[did]) byDriver[did] = { points: [], indices: [] };
      byDriver[did].points.push({
        address: o.address,
        lat: o.lat,
        lng: o.lng,
        phone: o.phone || null,
        timeSlot: o.timeSlot || null,
        formattedAddress: o.formattedAddress || null,
        orderNum: byDriver[did].points.length + 1,
        isSupplier: true,
      });
      byDriver[did].indices.push(i);
      allIndices.add(i);
    });
    try {
      for (const driverId of Object.keys(byDriver)) {
        await syncDriverRoute(driverId, routeDate, byDriver[driverId].points);
      }
      const sorted = Array.from(allIndices).sort((a, b) => b - a);
      setOrders((prev) => prev.filter((_, i) => !allIndices.has(i)));
      setAssignments((prev) => (prev ? prev.filter((_, i) => !allIndices.has(i)) : null));
      setShowFinishSuppliersModal(false);
      showToast('Поставщики всех водителей завершены (' + sorted.length + ')');
    } catch (err) {
      showToast('Ошибка: ' + (err?.message || err), 'error');
    }
  }, [orders, assignments, driverSlots, showToast]);

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
        color: driverColorsBySlot[driverIdx] ?? DRIVER_COLORS[driverIdx % DRIVER_COLORS.length],
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

  // Цвета водителей: по слоту (индекс в driverSlots) — кастом из localStorage или дефолт
  const driverColorsBySlot = useMemo(() => {
    const list = [];
    for (let i = 0; i < driverSlots.length; i++) {
      const driverId = driverSlots[i];
      list.push(driverCustomColors[driverId] || DRIVER_COLORS[i % DRIVER_COLORS.length]);
    }
    return list;
  }, [driverSlots, driverCustomColors]);

  // Display orders (фильтр по выбранному водителю; в режиме редактирования — только заказы этого водителя)
  const displayOrders = useMemo(() => {
    const all = orders.map((o, i) => ({
      ...o,
      driverIndex: assignments ? assignments[i] : -1,
      orderNum: i + 1,
      globalIndex: i,
    }));
    if (editingDriverId != null) {
      return all.filter(
        (o) => o.driverIndex >= 0 && driverSlots[o.driverIndex] != null && String(driverSlots[o.driverIndex]) === String(editingDriverId)
      );
    }
    if (!assignments || selectedDriver === null || selectedDriver === -1) return all;
    if (selectedDriver === '__unassigned__') return all.filter((o) => o.driverIndex < 0);
    return all.filter((o) => o.driverIndex === selectedDriver);
  }, [orders, assignments, selectedDriver, editingDriverId, driverSlots]);

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

      {/* Режим редактирования маршрута водителя */}
      {editingDriverId != null && (
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 16px',
            background: 'var(--accent)',
            color: '#fff',
            fontSize: 14,
          }}
        >
          <span>
            Редактирование: {dbDrivers.find((d) => String(d.id) === String(editingDriverId))?.name ?? 'Водитель'}
          </span>
          <button
            type="button"
            className="btn btn-sm"
            style={{ background: 'rgba(255,255,255,0.25)', border: 'none', color: '#fff' }}
            onClick={() => setEditingDriverId(null)}
          >
            Готово
          </button>
        </div>
      )}

      <div className="dc-layout" style={{ flex: 1, minHeight: 0 }}>
        <aside className="dc-sidebar-wrap">
          <div className="dc-sidebar-scroll">
          {/* Вставить список поставщиков + сквозной поиск по базе (как в старой версии) */}
          <div className="sidebar-section">
            <details className="dc-bulk-details">
              <summary className="sidebar-section-title" style={{ cursor: 'pointer' }}>Вставить список поставщиков</summary>
              <div className="dc-supplier-search" style={{ position: 'relative', marginBottom: 6 }}>
                <input
                  ref={supplierSearchRef}
                  type="text"
                  className="form-input"
                  placeholder="Поиск поставщика по базе..."
                  value={supplierSearchQuery}
                  onChange={(e) => {
                    setSupplierSearchQuery(e.target.value);
                    setShowSupplierSuggest(true);
                    const r = supplierSearchRef.current?.getBoundingClientRect();
                    if (r) setSupplierDropdownRect(r);
                  }}
                  onFocus={() => {
                    if (supplierSearchQuery.trim().length >= 1) {
                      setShowSupplierSuggest(true);
                      const r = supplierSearchRef.current?.getBoundingClientRect();
                      if (r) setSupplierDropdownRect(r);
                    }
                  }}
                  onBlur={() => setTimeout(() => { setShowSupplierSuggest(false); setSupplierDropdownRect(null); }, 200)}
                  style={{ width: '100%' }}
                />
                {showSupplierSuggest && supplierSearchQuery.trim().length >= 1 && createPortal(
                  <div
                    className="dc-suggest-dropdown"
                    style={{
                      position: 'fixed',
                      top: (supplierDropdownRect?.bottom ?? 0) + 2,
                      left: supplierDropdownRect?.left ?? 0,
                      width: Math.max(supplierDropdownRect?.width ?? 260, 260),
                      zIndex: 10000,
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      maxHeight: 220,
                      overflowY: 'auto',
                      boxShadow: 'var(--shadow-lg)',
                    }}
                  >
                    {supplierSuggestResults.length === 0 ? (
                      <div style={{ padding: 8, color: 'var(--text-muted)', fontSize: 12 }}>Не найдено</div>
                    ) : (
                      supplierSuggestResults.map((s) => (
                        <div
                          key={s.id}
                          role="button"
                          tabIndex={0}
                          className="dc-suggest-item"
                          style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid var(--border)' }}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setSupplierNamesText((prev) => (prev ? prev + '\n' : '') + (s.name || ''));
                            setSupplierSearchQuery('');
                            setShowSupplierSuggest(false);
                            setSupplierDropdownRect(null);
                          }}
                        >
                          <div style={{ fontWeight: 600 }}>{s.name}</div>
                          {s.address && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.address}</div>}
                        </div>
                      ))
                    )}
                  </div>,
                  document.body
                )}
              </div>
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

          {/* Вставить список партнёров + сквозной поиск по базе (как в старой версии) */}
          <div className="sidebar-section">
            <details className="dc-bulk-details">
              <summary className="sidebar-section-title" style={{ cursor: 'pointer' }}>Вставить список партнёров</summary>
              <div className="dc-partner-search" style={{ position: 'relative', marginBottom: 6 }}>
                <input
                  ref={partnerSearchRef}
                  type="text"
                  className="form-input"
                  placeholder="Поиск партнёра по базе..."
                  value={partnerSearchQuery}
                  onChange={(e) => {
                    setPartnerSearchQuery(e.target.value);
                    setShowPartnerSuggest(true);
                    const r = partnerSearchRef.current?.getBoundingClientRect();
                    if (r) setPartnerDropdownRect(r);
                  }}
                  onFocus={() => {
                    if (partnerSearchQuery.trim().length >= 1) {
                      setShowPartnerSuggest(true);
                      const r = partnerSearchRef.current?.getBoundingClientRect();
                      if (r) setPartnerDropdownRect(r);
                    }
                  }}
                  onBlur={() => setTimeout(() => { setShowPartnerSuggest(false); setPartnerDropdownRect(null); }, 200)}
                  style={{ width: '100%' }}
                />
                {showPartnerSuggest && partnerSearchQuery.trim().length >= 1 && createPortal(
                  <div
                    className="dc-suggest-dropdown"
                    style={{
                      position: 'fixed',
                      top: (partnerDropdownRect?.bottom ?? 0) + 2,
                      left: partnerDropdownRect?.left ?? 0,
                      width: Math.max(partnerDropdownRect?.width ?? 260, 260),
                      zIndex: 10000,
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      maxHeight: 220,
                      overflowY: 'auto',
                      boxShadow: 'var(--shadow-lg)',
                    }}
                  >
                    {partnerSuggestResults.length === 0 ? (
                      <div style={{ padding: 8, color: 'var(--text-muted)', fontSize: 12 }}>Не найдено</div>
                    ) : (
                      partnerSuggestResults.map((p) => (
                        <div
                          key={p.id}
                          role="button"
                          tabIndex={0}
                          className="dc-partner-suggest-item"
                          style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid var(--border)' }}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            setPartnerNamesText((prev) => (prev ? prev + '\n' : '') + (p.name || ''));
                            setPartnerSearchQuery('');
                            setShowPartnerSuggest(false);
                            setPartnerDropdownRect(null);
                          }}
                        >
                          <div style={{ fontWeight: 600 }}>{p.name}</div>
                          {p.address && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.address}</div>}
                        </div>
                      ))
                    )}
                  </div>,
                  document.body
                )}
              </div>
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
                {orders.some((o) => o.isSupplier) && assignments && (
                  <button
                    type="button"
                    className="btn btn-outline btn-sm"
                    style={{ borderColor: 'var(--success)', color: 'var(--success)' }}
                    onClick={() => setShowFinishSuppliersModal(true)}
                    title="Завершить поставщиков (убрать с карты, сохранить выезд)"
                  >
                    🏁 Завершить поставщиков
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

          {/* Список водителей с палитрой цветов (как в старой версии) */}
          {dbDrivers.length > 0 && (
            <div className="sidebar-section">
              <details className="dc-list-details dc-details-drivers" open>
                <summary className="sidebar-section-title" style={{ cursor: 'pointer', userSelect: 'none' }}>
                  Водители{' '}
                  <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>
                    ({assignments ? assignments.filter((a) => a >= 0).length : 0}/{orders.length} точек)
                  </span>
                </summary>
                <div className="dc-drivers-list" style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 0' }}>
                  <button
                    type="button"
                    className={`dc-driver-filter-btn ${selectedDriver === null ? 'active' : ''}`}
                    onClick={() => setSelectedDriver(null)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8,
                      border: `1px solid ${selectedDriver === null ? 'var(--accent)' : 'var(--border)'}`,
                      background: selectedDriver === null ? 'rgba(16,185,129,0.1)' : 'transparent',
                      cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 12, fontWeight: selectedDriver === null ? 700 : 400, width: '100%',
                    }}
                  >
                    Все точки
                  </button>
                  <button
                    type="button"
                    className={`dc-driver-filter-btn ${selectedDriver === '__unassigned__' ? 'active' : ''}`}
                    onClick={() => setSelectedDriver(selectedDriver === '__unassigned__' ? null : '__unassigned__')}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 8,
                      border: `1px solid ${selectedDriver === '__unassigned__' ? '#888' : 'var(--border)'}`,
                      background: selectedDriver === '__unassigned__' ? 'rgba(136,136,136,0.15)' : 'transparent',
                      cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 12, width: '100%',
                    }}
                  >
                    <span style={{ width: 14, height: 14, borderRadius: '50%', background: '#888', flexShrink: 0 }} />
                    Нераспределённые
                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                      {assignments ? assignments.filter((a) => a < 0).length : 0} точ.
                    </span>
                  </button>
                  {dbDrivers.map((dr, di) => {
                    const slotIdx = driverSlots.findIndex((id) => String(id) === String(dr.id));
                    const color = slotIdx >= 0 ? (driverColorsBySlot[slotIdx] ?? DRIVER_COLORS[slotIdx % DRIVER_COLORS.length]) : (driverCustomColors[dr.id] || DRIVER_COLORS[di % DRIVER_COLORS.length]);
                    const count = assignments && slotIdx >= 0 ? assignments.filter((a) => a === slotIdx).length : 0;
                    const isActive = selectedDriver !== null && selectedDriver !== '__unassigned__' && selectedDriver === slotIdx;
                    return (
                      <div key={dr.id} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 0 }}>
                        <button
                          type="button"
                          className={`dc-driver-filter-btn ${isActive ? 'active' : ''}`}
                          onClick={() => setSelectedDriver(isActive ? null : (slotIdx >= 0 ? slotIdx : null))}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: '8px 0 0 8px',
                            border: `1px solid ${isActive ? color : 'var(--border)'}`, borderRight: 'none',
                            background: isActive ? 'rgba(255,255,255,0.05)' : 'transparent',
                            cursor: 'pointer', flex: 1, minWidth: 0,
                          }}
                        >
                          <span
                            className="dc-driver-color-dot"
                            role="button"
                            tabIndex={0}
                            style={{
                              width: 14, height: 14, borderRadius: '50%', background: color,
                              flexShrink: 0, border: '2px solid rgba(255,255,255,0.2)', cursor: 'pointer',
                            }}
                            title="Нажмите для смены цвета"
                            onClick={(e) => { e.stopPropagation(); setColorPickerDriverId((id) => (id === dr.id ? null : dr.id)); }}
                          />
                          <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
                            {dr.name}
                          </span>
                          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{count} точ.</span>
                          {slotIdx >= 0 && (
                            <button
                              type="button"
                              className="btn btn-sm"
                              style={{ fontSize: 10, padding: '2px 6px', minWidth: 0 }}
                              onClick={(e) => { e.stopPropagation(); setEditingDriverId(editingDriverId === dr.id ? null : dr.id); }}
                              title="Редактировать маршрут"
                            >
                              {editingDriverId === dr.id ? 'Готово' : 'Ред.'}
                            </button>
                          )}
                        </button>
                        {colorPickerDriverId === dr.id && (
                          <div
                            style={{
                              position: 'absolute',
                              left: 0,
                              top: '100%',
                              zIndex: 100,
                              marginTop: 2,
                              padding: 8,
                              background: 'var(--bg-card)',
                              border: '1px solid var(--border)',
                              borderRadius: 8,
                              boxShadow: 'var(--shadow-lg)',
                              display: 'grid',
                              gridTemplateColumns: 'repeat(5, 1fr)',
                              gap: 4,
                            }}
                          >
                            {COLOR_PALETTE.map((c) => (
                              <button
                                key={c}
                                type="button"
                                style={{
                                  width: 24,
                                  height: 24,
                                  borderRadius: '50%',
                                  background: c,
                                  border: '2px solid transparent',
                                  cursor: 'pointer',
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDriverCustomColors((prev) => ({ ...prev, [dr.id]: c }));
                                  setColorPickerDriverId(null);
                                }}
                                title={c}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </details>
            </div>
          )}

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
              <button
                className={`driver-tab ${
                  selectedDriver === '__unassigned__' ? 'active' : ''
                }`}
                onClick={() => setSelectedDriver(selectedDriver === '__unassigned__' ? null : '__unassigned__')}
                style={selectedDriver === '__unassigned__' ? { borderBottomColor: '#888' } : {}}
              >
                <span className="driver-color-dot" style={{ background: '#888' }} />
                Нераспред. <span className="tab-count">{stats.total - stats.assigned}</span>
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

          {/* Список точек: раскрывающиеся блоки Поставщики / Партнёры / Адреса */}
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
                      : 'Список точек'}
                  </h3>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {displayOrders.length} шт.
                  </span>
                </div>
                {supplierItems.length > 0 && (
                  <details className="dc-orders-group" open style={{ marginTop: 8 }}>
                    <summary className="dc-orders-group-summary" style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                      📦 Поставщики ({supplierItems.length})
                    </summary>
                    <div style={{ marginTop: 4 }}>
                {supplierItems.map(order => {
                  const driverIdx = order.driverIndex;
                  const color =
                    driverIdx >= 0
                      ? (driverColorsBySlot[driverIdx] ?? DRIVER_COLORS[driverIdx % DRIVER_COLORS.length])
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
                        onMouseEnter={() => setHoveredOrderId(order.id)}
                        onMouseLeave={() => setHoveredOrderId(null)}
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
                            {order.isSupplier && !order.supplierDbId && (
                              <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline"
                                  style={{ fontSize: 10, color: 'var(--danger)', borderColor: 'var(--danger)' }}
                                  onClick={(e) => { e.stopPropagation(); setFindSupplierOrderId(order.id); }}
                                >
                                  🔍 Не найден — найти в базе
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline"
                                  style={{ fontSize: 10, color: 'var(--success)', borderColor: 'var(--success)' }}
                                  onClick={(e) => { e.stopPropagation(); setCreateSupplierOrderId(order.id); }}
                                >
                                  + В базу
                                </button>
                              </div>
                            )}
                            {order.isPartner && !order.partnerDbId && (
                              <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline"
                                  style={{ fontSize: 10, color: 'var(--warning)', borderColor: 'var(--warning)' }}
                                  onClick={(e) => { e.stopPropagation(); setFindPartnerOrderId(order.id); }}
                                >
                                  🔎 Не выбран — найти в базе
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline"
                                  style={{ fontSize: 10, color: 'var(--warning)', borderColor: 'var(--warning)' }}
                                  onClick={(e) => { e.stopPropagation(); setShowCreatePartner(true); }}
                                >
                                  + Новый партнёр
                                </button>
                              </div>
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
                    </div>
                  </details>
                )}
                {partnerItems.length > 0 && (
                  <details className="dc-orders-group" open style={{ marginTop: 8 }}>
                    <summary className="dc-orders-group-summary" style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                      🤝 Партнёры ({partnerItems.length})
                    </summary>
                    <div style={{ marginTop: 4 }}>
                {partnerItems.map(order => {
                  const driverIdx = order.driverIndex;
                  const color = driverIdx >= 0 ? (driverColorsBySlot[driverIdx] ?? DRIVER_COLORS[driverIdx % DRIVER_COLORS.length]) : undefined;
                  const isEditing = editingOrderId === order.id;
                  const isPlacing = placingOrderId === order.id;
                  const isFailed = !order.geocoded && order.error;
                  return (
                    <div key={order.id}>
                      <div className={`order-item ${driverIdx >= 0 ? 'assigned' : ''} ${manualMode ? 'clickable' : ''} ${isPlacing ? 'placing' : ''}`} style={{ borderLeftColor: driverIdx >= 0 ? color : undefined, borderLeftWidth: isFailed ? 3 : undefined, ...(isFailed && driverIdx < 0 ? { borderLeftColor: 'var(--danger)' } : {}) }} onClick={() => manualMode && handleManualAssign(order.globalIndex)} onMouseEnter={() => setHoveredOrderId(order.id)} onMouseLeave={() => setHoveredOrderId(null)}>
                        {assignments && <input type="checkbox" checked={selectedOrderIds.has(order.id)} onChange={(e) => { e.stopPropagation(); toggleOrderSelected(order.id); }} onClick={(e) => e.stopPropagation()} style={{ marginRight: 6, flexShrink: 0 }} />}
                        <div className="order-number" style={driverIdx >= 0 ? { background: color, color: '#fff' } : isFailed ? { background: 'var(--danger)', color: '#fff' } : {}}>{order.orderNum}</div>
                        <div className="order-info">
                          <div className="order-address" title={order.formattedAddress || order.address}>{order.address}</div>
                          <div className="order-time">
                            {order.timeSlot && <span>⏰ {order.timeSlot}</span>}
                            {order.phone && <span style={{ marginLeft: order.timeSlot ? 8 : 0 }}>📞 {order.phone}</span>}
                            {order.formattedAddress && <span style={{ marginLeft: order.timeSlot || order.phone ? 8 : 0, opacity: 0.7, display: 'block' }}>📍 {order.formattedAddress}</span>}
                            {order.isPartner && !order.partnerDbId && <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}><button type="button" className="btn btn-sm btn-outline" style={{ fontSize: 10, color: 'var(--warning)', borderColor: 'var(--warning)' }} onClick={(e) => { e.stopPropagation(); setFindPartnerOrderId(order.id); }}>🔎 Не выбран — найти в базе</button><button type="button" className="btn btn-sm btn-outline" style={{ fontSize: 10, color: 'var(--warning)', borderColor: 'var(--warning)' }} onClick={(e) => { e.stopPropagation(); setShowCreatePartner(true); }}>+ Новый партнёр</button></div>}
                          </div>
                        </div>
                        {manualMode ? <span className="order-status" style={{ background: 'var(--accent-light)', color: 'var(--accent)', cursor: 'pointer' }}>{driverIdx >= 0 ? `В${driverIdx + 1}` : '?'}</span> : order.geocoded ? <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}><span className="order-status geocoded">✓</span><button className="btn-icon-delete" onClick={e => { e.stopPropagation(); handleDeleteOrder(order.id); }} title="Удалить точку">×</button></div> : order.error ? <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}><button className="btn btn-sm btn-outline" onClick={e => { e.stopPropagation(); handleStartEdit(order); }} title="Изменить адрес">✎</button><button className="btn btn-sm btn-outline" onClick={e => { e.stopPropagation(); handleStartPlacing(order.id); }} title="Поставить на карте">📍</button><button className="btn-icon-delete" onClick={e => { e.stopPropagation(); handleDeleteOrder(order.id); }} title="Удалить">×</button></div> : <span className="order-status pending">...</span>}
                      </div>
                      {isEditing && <div className="order-edit-row"><input className="order-edit-input" value={editAddress} onChange={e => setEditAddress(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleRetryGeocode(order.id)} placeholder="Введите адрес..." autoFocus /><button className="btn btn-sm btn-primary" onClick={() => handleRetryGeocode(order.id)} disabled={isRetrying || !editAddress.trim()}>{isRetrying ? '...' : 'Найти'}</button><button className="btn btn-sm btn-outline" onClick={() => setEditingOrderId(null)}>✕</button></div>}
                      {isPlacing && <div className="order-edit-row" style={{ color: 'var(--warning)', fontSize: 12 }}>👆 Кликните на карту для установки точки<button className="btn btn-sm btn-outline" onClick={() => setPlacingOrderId(null)} style={{ marginLeft: 'auto' }}>Отмена</button></div>}
                    </div>
                  );
                })}
                    </div>
                  </details>
                )}
                {addressItems.length > 0 && (
                  <details className="dc-orders-group" open style={{ marginTop: 8 }}>
                    <summary className="dc-orders-group-summary" style={{ cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                      📍 Адреса доставки ({addressItems.length})
                    </summary>
                    <div style={{ marginTop: 4 }}>
                {addressItems.map(order => {
                  const driverIdx = order.driverIndex;
                  const color = driverIdx >= 0 ? (driverColorsBySlot[driverIdx] ?? DRIVER_COLORS[driverIdx % DRIVER_COLORS.length]) : undefined;
                  const isEditing = editingOrderId === order.id;
                  const isPlacing = placingOrderId === order.id;
                  const isFailed = !order.geocoded && order.error;
                  return (
                    <div key={order.id}>
                      <div className={`order-item ${driverIdx >= 0 ? 'assigned' : ''} ${manualMode ? 'clickable' : ''} ${isPlacing ? 'placing' : ''}`} style={{ borderLeftColor: driverIdx >= 0 ? color : undefined, borderLeftWidth: isFailed ? 3 : undefined, ...(isFailed && driverIdx < 0 ? { borderLeftColor: 'var(--danger)' } : {}) }} onClick={() => manualMode && handleManualAssign(order.globalIndex)} onMouseEnter={() => setHoveredOrderId(order.id)} onMouseLeave={() => setHoveredOrderId(null)}>
                        {assignments && <input type="checkbox" checked={selectedOrderIds.has(order.id)} onChange={(e) => { e.stopPropagation(); toggleOrderSelected(order.id); }} onClick={(e) => e.stopPropagation()} style={{ marginRight: 6, flexShrink: 0 }} />}
                        <div className="order-number" style={driverIdx >= 0 ? { background: color, color: '#fff' } : isFailed ? { background: 'var(--danger)', color: '#fff' } : {}}>{order.orderNum}</div>
                        <div className="order-info">
                          <div className="order-address" title={order.formattedAddress || order.address}>{order.address}</div>
                          <div className="order-time">
                            {order.timeSlot && <span>⏰ {order.timeSlot}</span>}
                            {order.phone && <span style={{ marginLeft: order.timeSlot ? 8 : 0 }}>📞 {order.phone}</span>}
                            {order.formattedAddress && <span style={{ marginLeft: order.timeSlot || order.phone ? 8 : 0, opacity: 0.7, display: 'block' }}>📍 {order.formattedAddress}</span>}
                          </div>
                        </div>
                        {manualMode ? <span className="order-status" style={{ background: 'var(--accent-light)', color: 'var(--accent)', cursor: 'pointer' }}>{driverIdx >= 0 ? `В${driverIdx + 1}` : '?'}</span> : order.geocoded ? <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }}><span className="order-status geocoded">✓</span><button className="btn-icon-delete" onClick={e => { e.stopPropagation(); handleDeleteOrder(order.id); }} title="Удалить точку">×</button></div> : order.error ? <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}><button className="btn btn-sm btn-outline" onClick={e => { e.stopPropagation(); handleStartEdit(order); }} title="Изменить адрес">✎</button><button className="btn btn-sm btn-outline" onClick={e => { e.stopPropagation(); handleStartPlacing(order.id); }} title="Поставить на карте">📍</button><button className="btn-icon-delete" onClick={e => { e.stopPropagation(); handleDeleteOrder(order.id); }} title="Удалить">×</button></div> : <span className="order-status pending">...</span>}
                      </div>
                      {isEditing && <div className="order-edit-row"><input className="order-edit-input" value={editAddress} onChange={e => setEditAddress(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleRetryGeocode(order.id)} placeholder="Введите адрес..." autoFocus /><button className="btn btn-sm btn-primary" onClick={() => handleRetryGeocode(order.id)} disabled={isRetrying || !editAddress.trim()}>{isRetrying ? '...' : 'Найти'}</button><button className="btn btn-sm btn-outline" onClick={() => setEditingOrderId(null)}>✕</button></div>}
                      {isPlacing && <div className="order-edit-row" style={{ color: 'var(--warning)', fontSize: 12 }}>👆 Кликните на карту для установки точки<button className="btn btn-sm btn-outline" onClick={() => setPlacingOrderId(null)} style={{ marginLeft: 'auto' }}>Отмена</button></div>}
                    </div>
                  );
                })}
                    </div>
                  </details>
                )}
              </>
            )}
          </div>
        </aside>

        {/* Карта: фиксированная высота 70vh, чтобы не зависеть от flex и сразу иметь размер (как в старой версии) */}
        <div
          className="dc-map-wrap"
          style={{
            position: 'relative',
            flex: 1,
            minWidth: 0,
            height: '70vh',
            minHeight: 500,
          }}
        >
        <YandexMapView
          orders={orders}
          assignments={assignments}
          driverCount={driverCount}
          selectedDriver={selectedDriver}
          onAssignDriver={handleMapAssignDriver}
          onDeleteOrder={handleDeleteOrder}
          placingMode={!!placingOrderId}
          onMapClick={handleMapClick}
          dbDrivers={dbDrivers}
          driverSlots={driverSlots}
          driverColorsBySlot={driverColorsBySlot}
          onToggleKbt={handleToggleKbt}
          onSetHelper={handleSetHelper}
          hoveredOrderId={hoveredOrderId}
          selectedOrderIds={selectedOrderIds}
          onToggleOrderSelect={handleMapToggleOrderSelect}
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

      {/* Модалка: Найти поставщика в базе */}
      {findSupplierOrderId && (
        <div className="modal" style={{ display: 'flex' }}>
          <div className="modal-content" style={{ maxWidth: 420 }}>
            <h3 className="modal-title">Найти поставщика в базе</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
              Выберите поставщика для привязки к точке «{orders.find((o) => o.id === findSupplierOrderId)?.address ?? ''}»
            </p>
            <input
              type="text"
              className="form-input"
              placeholder="Поиск по названию..."
              style={{ marginBottom: 8 }}
              onChange={(e) => {
                const q = compactNameHelper(e.target.value);
                setSupplierSearchQuery(e.target.value);
              }}
              value={supplierSearchQuery}
            />
            <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(supplierSearchQuery.trim() ? supplierSuggestResults : dbSuppliers.slice(0, 20)).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="btn btn-outline"
                  style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                  onClick={() => handleLinkSupplier(findSupplierOrderId, s)}
                >
                  <span style={{ fontWeight: 600 }}>{s.name}</span>
                  {s.address && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>{s.address}</span>}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-outline" style={{ marginTop: 12, width: '100%' }} onClick={() => setFindSupplierOrderId(null)}>
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* Модалка: Найти партнёра в базе */}
      {findPartnerOrderId && (
        <div className="modal" style={{ display: 'flex' }}>
          <div className="modal-content" style={{ maxWidth: 420 }}>
            <h3 className="modal-title">Найти партнёра в базе</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
              Выберите партнёра для привязки к точке «{orders.find((o) => o.id === findPartnerOrderId)?.address ?? ''}»
            </p>
            <input
              type="text"
              className="form-input"
              placeholder="Поиск по названию..."
              style={{ marginBottom: 8 }}
              value={partnerSearchQuery}
              onChange={(e) => setPartnerSearchQuery(e.target.value)}
            />
            <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(partnerSearchQuery.trim() ? partnerSuggestResults : dbPartners.slice(0, 20)).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="btn btn-outline"
                  style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                  onClick={() => handleLinkPartner(findPartnerOrderId, p)}
                >
                  <span style={{ fontWeight: 600 }}>{p.name}</span>
                  {p.address && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>{p.address}</span>}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-outline" style={{ marginTop: 12, width: '100%' }} onClick={() => setFindPartnerOrderId(null)}>
              Отмена
            </button>
          </div>
        </div>
      )}

      {/* Модалка: Завершить поставщиков */}
      {showFinishSuppliersModal && (() => {
        const driverSupplierCounts = {};
        orders.forEach((o, i) => {
          if (!o.isSupplier || !o.geocoded || o.poiId) return;
          const slot = assignments?.[i];
          if (slot == null || slot < 0) return;
          const did = driverSlots[slot];
          if (!did) return;
          driverSupplierCounts[did] = (driverSupplierCounts[did] || 0) + 1;
        });
        const totalSuppliers = Object.values(driverSupplierCounts).reduce((a, b) => a + b, 0);
        return (
          <div className="modal" style={{ display: 'flex' }}>
            <div className="modal-content" style={{ maxWidth: 420 }}>
              <h3 className="modal-title" style={{ textAlign: 'center' }}>Завершить поставщиков</h3>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                Поставщики будут сохранены как завершённый выезд и убраны с карты.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {Object.entries(driverSupplierCounts).map(([driverId, count]) => {
                  const driver = dbDrivers.find((d) => String(d.id) === String(driverId));
                  const name = driver ? driver.name : driverId;
                  return (
                    <button
                      key={driverId}
                      type="button"
                      className="btn btn-outline"
                      style={{ color: 'var(--success)', borderColor: 'var(--success)' }}
                      onClick={() => handleFinishSupplierRoute(driverId)}
                    >
                      {name} ({count} пост.)
                    </button>
                  );
                })}
                {totalSuppliers > 0 && (
                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{ color: 'var(--success)', borderColor: 'var(--success)' }}
                    onClick={() => handleFinishAllSupplierRoutes()}
                  >
                    Все водители ({totalSuppliers} пост.)
                  </button>
                )}
                <button type="button" className="btn btn-outline" style={{ marginTop: 8 }} onClick={() => setShowFinishSuppliersModal(false)}>
                  Отмена
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Модалка: Создать поставщика / Новый партнёр — заглушка (переход на раздел или форма) */}
      {createSupplierOrderId && (
        <div className="modal" style={{ display: 'flex' }}>
          <div className="modal-content" style={{ maxWidth: 400 }}>
            <h3 className="modal-title">+ В базу (поставщик)</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Точка: «{orders.find((o) => o.id === createSupplierOrderId)?.address ?? ''}». Создайте поставщика в разделе «Поставщики» и затем привяжите через «Найти в базе».
            </p>
            <button type="button" className="btn btn-outline" style={{ marginTop: 12, width: '100%' }} onClick={() => setCreateSupplierOrderId(null)}>
              Закрыть
            </button>
          </div>
        </div>
      )}
      {showCreatePartner && (
        <div className="modal" style={{ display: 'flex' }}>
          <div className="modal-content" style={{ maxWidth: 400 }}>
            <h3 className="modal-title">+ Новый партнёр</h3>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Создайте партнёра в разделе «Партнёры» и затем привяжите через «Найти в базе».
            </p>
            <button type="button" className="btn btn-outline" style={{ marginTop: 12, width: '100%' }} onClick={() => setShowCreatePartner(false)}>
              Закрыть
            </button>
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

