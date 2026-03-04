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

function DistributionPage() {
  const [rawText, setRawText] = useState('');
  const [orders, setOrders] = useState([]);
  const [driverCount, setDriverCount] = useState(3);
  const [assignments, setAssignments] = useState(null);
  const [selectedDriver, setSelectedDriver] = useState(null);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geocodeProgress, setGeocodeProgress] = useState({ current: 0, total: 0 });
  const [toast, setToast] = useState(null);

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

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
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

  // Generate distribution variants
  const handleDistribute = useCallback(() => {
    const geocodedCount = orders.filter(o => o.geocoded).length;
    if (geocodedCount === 0) {
      showToast('Нет геокодированных адресов', 'error');
      return;
    }
    const vars = generateVariants(orders, driverCount);
    setVariants(vars);
    setActiveVariant(0);
    setAssignments(vars[0].assignments);
    setSelectedDriver(null);
    setManualMode(false);
    showToast(`Создано ${vars.length} вариантов распределения`);
  }, [orders, driverCount, showToast]);

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

  // Delete a single order
  const handleDeleteOrder = useCallback(orderId => {
    setOrders(prev => prev.filter(o => o.id !== orderId));
    // Reset distribution since points changed
    setAssignments(null);
    setVariants([]);
    setActiveVariant(-1);
  }, []);

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

  // Driver routes
  const driverRoutes = useMemo(() => {
    if (!assignments) return [];
    return Array.from({ length: driverCount }, (_, driverIdx) => {
      const driverOrders = orders.filter((_, i) => assignments[i] === driverIdx);
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
        orders: driverOrders,
        color: DRIVER_COLORS[driverIdx % DRIVER_COLORS.length],
        km: Math.round(km * 10) / 10,
      };
    });
  }, [orders, assignments, driverCount]);

  // Display orders
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

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
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

      <div className="main-layout">
        <aside className="sidebar">
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
                    onClick={handleDistribute}
                    disabled={isGeocoding}
                  >
                    Распределить
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
                {orders.length > 0 && (
                  <button className="btn btn-danger btn-sm" onClick={handleClear}>
                    Очистить
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
                {Array.from({ length: driverCount }, (_, d) => (
                  <button
                    key={d}
                    className={`btn btn-sm ${
                      assigningDriver === d ? 'btn-primary' : 'btn-outline'
                    }`}
                    style={
                      assigningDriver === d
                        ? {
                            background: DRIVER_COLORS[d],
                            borderColor: DRIVER_COLORS[d],
                          }
                        : {}
                    }
                    onClick={() => setAssigningDriver(d)}
                  >
                    <span
                      className="driver-color-dot"
                      style={{ background: DRIVER_COLORS[d] }}
                    />
                    В{d + 1}
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
                  {` В${dr.index + 1}`}
                  <span className="tab-count">
                    {dr.orders.length} шт · {dr.km} км
                  </span>
                </button>
              ))}
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
                    {selectedDriver !== null && selectedDriver >= 0
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
        </aside>

        {/* Map */}
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
                <span>Водитель {dr.index + 1}</span>
                <span className="count">
                  {dr.orders.length} шт · {dr.km} км
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

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

