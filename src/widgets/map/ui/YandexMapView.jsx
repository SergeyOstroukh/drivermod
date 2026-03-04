import { useEffect, useRef, useState, useCallback } from 'react';
import { DRIVER_COLORS } from '../../../entities/distribution/lib/distributor.js';

// Тот же URL с API-ключом, что и в старой версии (distribution-geocoder.js) — без ключа карта может не грузиться на проде
const YMAPS_SRC = 'https://api-maps.yandex.ru/2.1/?apikey=8c44c726-c732-45f2-94ac-af2cf0bb0181&lang=ru_RU&suggest_apikey=8b2a44b9-d35a-4aed-8e5a-4a1d71d30de8';
const MINSK_CENTER = [53.9006, 27.559];
const DEFAULT_ZOOM = 12;

let ymapsLoaded = false;
let ymapsLoadPromise = null;

function loadYmaps() {
  if (ymapsLoaded) return Promise.resolve(window.ymaps);
  if (ymapsLoadPromise) return ymapsLoadPromise;

  ymapsLoadPromise = new Promise((resolve, reject) => {
    if (window.ymaps && window.ymaps.geocode) {
      window.ymaps.ready(() => {
        ymapsLoaded = true;
        resolve(window.ymaps);
      });
      return;
    }
    if (!document.querySelector('script[src*="api-maps.yandex.ru"]')) {
      const script = document.createElement('script');
      script.src = YMAPS_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
    const start = Date.now();
    const interval = setInterval(() => {
      if (window.ymaps && window.ymaps.geocode) {
        clearInterval(interval);
        window.ymaps.ready(() => {
          ymapsLoaded = true;
          resolve(window.ymaps);
        });
      } else if (Date.now() - start > 20000) {
        clearInterval(interval);
        reject(new Error('Яндекс Карты не загрузились'));
      }
    }, 300);
  });

  return ymapsLoadPromise;
}

export default function YandexMapView({
  orders,
  assignments,
  driverCount,
  selectedDriver,
  onAssignDriver,
  onDeleteOrder,
  placingMode,
  onMapClick,
  dbDrivers = [],
  driverSlots = [],
  driverColorsBySlot = [],
  onToggleKbt,
  onSetHelper,
  hoveredOrderId = null,
  selectedOrderIds = new Set(),
  onToggleOrderSelect,
}) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const placemarksRef = useRef([]);
  const [mapReady, setMapReady] = useState(false);

  const onAssignRef = useRef(onAssignDriver);
  onAssignRef.current = onAssignDriver;
  const onDeleteRef = useRef(onDeleteOrder);
  onDeleteRef.current = onDeleteOrder;
  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;
  const placingModeRef = useRef(placingMode);
  placingModeRef.current = placingMode;
  const onToggleKbtRef = useRef(onToggleKbt);
  onToggleKbtRef.current = onToggleKbt;
  const onSetHelperRef = useRef(onSetHelper);
  onSetHelperRef.current = onSetHelper;
  const onToggleOrderSelectRef = useRef(onToggleOrderSelect);
  onToggleOrderSelectRef.current = onToggleOrderSelect;

  useEffect(() => {
    window.__drivecontrol_assign = (globalIdx, driverIdx) => {
      if (onAssignRef.current) {
        onAssignRef.current(globalIdx, driverIdx);
      }
      if (mapRef.current) {
        mapRef.current.balloon.close();
      }
    };
    window.__drivecontrol_delete = orderId => {
      if (onDeleteRef.current) {
        onDeleteRef.current(orderId);
      }
      if (mapRef.current) {
        mapRef.current.balloon.close();
      }
    };
    window.__drivecontrol_centerOrder = (lat, lng) => {
      if (mapRef.current && lat != null && lng != null) {
        mapRef.current.setCenter([lat, lng], 15, { duration: 300 });
      }
    };
    window.__drivecontrol_toggleKbt = (globalIdx) => {
      if (onToggleKbtRef.current) onToggleKbtRef.current(globalIdx);
    };
    window.__drivecontrol_setHelper = (globalIdx, helperSlot) => {
      if (onSetHelperRef.current) onSetHelperRef.current(globalIdx, helperSlot);
    };
    window.__drivecontrol_toggleSelect = (globalIdx) => {
      if (onToggleOrderSelectRef.current) onToggleOrderSelectRef.current(globalIdx);
    };
    return () => {
      delete window.__drivecontrol_assign;
      delete window.__drivecontrol_delete;
      delete window.__drivecontrol_centerOrder;
      delete window.__drivecontrol_toggleKbt;
      delete window.__drivecontrol_setHelper;
      delete window.__drivecontrol_toggleSelect;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const getContainer = () => mapContainerRef.current || document.getElementById('distributionMap');

    const initWhenReady = () => {
      if (cancelled || mapRef.current) return;
      const el = getContainer();
      if (!el) return;
      let w = el.offsetWidth || el.parentElement?.offsetWidth || 0;
      let h = el.offsetHeight || el.parentElement?.offsetHeight || 0;
      // Чтобы карта открывалась сразу, а не только после resize: задаём минимальный размер контейнера
      if (w < 100 || h < 100) {
        el.style.minWidth = '400px';
        el.style.minHeight = '500px';
        w = Math.max(w, 400);
        h = Math.max(h, 500);
      }
      loadYmaps().then(ymaps => {
        if (cancelled || mapRef.current) return;
        const container = getContainer();
        if (!container) return;
        const map = new ymaps.Map(
          container,
          {
            center: MINSK_CENTER,
            zoom: DEFAULT_ZOOM,
            controls: ['zoomControl', 'fullscreenControl'],
          },
          { suppressMapOpenBlock: true },
        );
        map.events.add('click', e => {
          if (placingModeRef.current && onMapClickRef.current) {
            const coords = e.get('coords');
            onMapClickRef.current(coords[0], coords[1]);
          }
        });
        mapRef.current = map;
        setMapReady(true);
        // После монтирования подогнать карту под контейнер и принудительно пересчитать размер (карта сразу видна без resize)
        setTimeout(() => {
          if (mapRef.current) {
            try {
              if (typeof mapRef.current.container?.fitToViewport === 'function') {
                mapRef.current.container.fitToViewport();
              }
              const z = mapRef.current.getZoom();
              mapRef.current.setCenter(MINSK_CENTER, z);
            } catch (e) {}
          }
        }, 150);
        setTimeout(() => {
          if (mapRef.current && window.dispatchEvent) {
            try {
              window.dispatchEvent(new Event('resize'));
            } catch (e) {}
          }
        }, 400);
      });
    };

    const ro = new ResizeObserver(() => initWhenReady());
    const containerEl = getContainer();
    if (containerEl) ro.observe(containerEl);
    const observeLater = () => {
      const c = getContainer();
      if (c && !mapRef.current) ro.observe(c);
    };
    observeLater();
    initWhenReady();
    const rafId = requestAnimationFrame(() => requestAnimationFrame(() => initWhenReady()));
    const t1 = setTimeout(() => { observeLater(); initWhenReady(); }, 100);
    const t2 = setTimeout(() => initWhenReady(), 300);
    const t3 = setTimeout(() => initWhenReady(), 600);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      ro.disconnect();
      if (mapRef.current) {
        mapRef.current.destroy();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const el = mapContainerRef.current || document.getElementById('distributionMap');
    if (el) el.style.cursor = placingMode ? 'crosshair' : '';
  }, [placingMode]);

  const buildBalloonContent = useCallback(
    (order, globalIdx, currentDriverIdx, isSelected) => {
      const colors = driverColorsBySlot.length ? driverColorsBySlot : DRIVER_COLORS;
      let driverButtons = '';
      if (dbDrivers.length && driverSlots.length) {
        dbDrivers.forEach((dr, di) => {
          const slotIdx = driverSlots.findIndex((id) => String(id) === String(dr.id));
          if (slotIdx < 0) return;
          const color = colors[slotIdx] ?? DRIVER_COLORS[slotIdx % DRIVER_COLORS.length];
          const isActive = slotIdx === currentDriverIdx;
          const displayName = (dr.name || '').split(' ')[0] || `В${slotIdx + 1}`;
          driverButtons += `<button onclick="window.__drivecontrol_assign(${globalIdx}, ${slotIdx})" style="display:flex;align-items:center;gap:4px;padding:4px 8px;border-radius:12px;border:2px solid ${isActive ? '#fff' : 'transparent'};background:${color};cursor:pointer;margin:2px;box-shadow:${isActive ? '0 0 0 2px ' + color : 'none'};color:#fff;font-size:11px;font-weight:600;" title="${dr.name || ''}"><span style="width:10px;height:10px;border-radius:50%;background:rgba(255,255,255,0.4);"></span>${displayName}</button>`;
        });
        if (currentDriverIdx >= 0) {
          driverButtons += `<button onclick="window.__drivecontrol_assign(${globalIdx}, -1)" style="display:flex;align-items:center;gap:4px;padding:4px 8px;border-radius:12px;border:1px solid #ddd;background:#f5f5f5;cursor:pointer;margin:2px;color:#999;font-size:11px;">✕ Снять</button>`;
        }
      } else {
        driverButtons = Array.from({ length: driverCount }, (_, d) => {
          const color = colors[d] ?? DRIVER_COLORS[d % DRIVER_COLORS.length];
          const isActive = d === currentDriverIdx;
          return `<button onclick="window.__drivecontrol_assign(${globalIdx}, ${d})" style="width:30px;height:30px;border-radius:50%;border:3px solid ${isActive ? '#fff' : 'transparent'};background:${color};cursor:pointer;margin:0 3px;box-shadow:${isActive ? '0 0 0 2px ' + color : 'none'};" title="Водитель ${d + 1}"></button>`;
        }).join('');
      }

      const escapedId = order.id.replace(/'/g, "\\'");
      const kbtActive = !!order.isKbt;
      let kbtHtml = '<div style="border-top:1px solid #eee;padding-top:8px;margin-top:8px;">';
      kbtHtml += `<button onclick="window.__drivecontrol_toggleKbt && window.__drivecontrol_toggleKbt(${globalIdx})" style="display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border-radius:8px;border:2px solid ${kbtActive ? '#a855f7' : '#ddd'};background:${kbtActive ? '#a855f7' : '#fff'};color:${kbtActive ? '#fff' : '#666'};cursor:pointer;font-size:12px;font-weight:600;">📦 КБТ +1${kbtActive ? ' ✓' : ''}</button>`;
      if (kbtActive && dbDrivers.length && driverSlots.length) {
        kbtHtml += '<div style="margin-top:8px;font-size:11px;color:#888;">Помощник (едет вместе):</div><div style="display:flex;flex-wrap:wrap;margin-top:4px;">';
        dbDrivers.forEach((hdr, hi) => {
          const slotIdx = driverSlots.findIndex((id) => String(id) === String(hdr.id));
          if (slotIdx < 0 || slotIdx === currentDriverIdx) return;
          const hc = colors[slotIdx] ?? DRIVER_COLORS[slotIdx % DRIVER_COLORS.length];
          const hActive = order.helperDriverSlot === slotIdx;
          const hName = (hdr.name || '').split(' ')[0] || `В${slotIdx + 1}`;
          kbtHtml += `<button onclick="window.__drivecontrol_setHelper && window.__drivecontrol_setHelper(${globalIdx}, ${slotIdx})" style="display:flex;align-items:center;gap:4px;padding:3px 8px;border-radius:10px;border:2px solid ${hActive ? '#a855f7' : 'transparent'};background:${hActive ? 'rgba(168,85,247,0.15)' : '#f5f5f5'};cursor:pointer;margin:2px;color:${hActive ? '#a855f7' : '#666'};font-size:11px;font-weight:${hActive ? '700' : '500'};"><span style="width:8px;height:8px;border-radius:50%;background:${hc};"></span>${hName}${hActive ? ' ✓' : ''}</button>`;
        });
        kbtHtml += '</div>';
      }
      kbtHtml += '</div>';

      const selectBtn = typeof window.__drivecontrol_toggleSelect === 'function'
        ? `<button onclick="window.__drivecontrol_toggleSelect(${globalIdx})" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:8px;border:1px solid #3b82f6;background:${isSelected ? '#3b82f6' : '#fff'};color:${isSelected ? '#fff' : '#3b82f6'};cursor:pointer;font-size:11px;margin-top:6px;" title="${isSelected ? 'Убрать из выбора' : 'Добавить в выбор для массового назначения'}">${isSelected ? '✓ В выборе' : '☐ В выбор'}</button>`
        : '';
      return `
      <div style="font-family:Inter,sans-serif;min-width:240px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <div style="font-weight:700;font-size:14px;margin-bottom:4px;">${order.address}</div>
          <button onclick="window.__drivecontrol_delete('${escapedId}')" style="flex-shrink:0;width:28px;height:28px;border-radius:6px;border:1px solid #e5e5e5;background:#fff;color:#ef4444;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;" title="Удалить">✕</button>
        </div>
        ${order.formattedAddress ? `<div style="color:#888;font-size:11px;margin-bottom:4px;">${order.formattedAddress}</div>` : ''}
        ${order.timeSlot ? `<div style="font-size:12px;margin-bottom:4px;">⏰ ${order.timeSlot}</div>` : ''}
        ${order.phone ? `<div style="font-size:12px;margin-bottom:8px;">📞 ${order.phone}</div>` : ''}
        <div style="border-top:1px solid #eee;padding-top:8px;margin-top:4px;">
          <div style="font-size:11px;color:#888;margin-bottom:6px;">Назначить водителя:</div>
          <div style="display:flex;flex-wrap:wrap;align-items:center;">${driverButtons}</div>
          ${selectBtn}
        </div>
        ${kbtHtml}
      </div>
    `;
    },
    [driverCount, dbDrivers, driverSlots, driverColorsBySlot],
  );

  useEffect(() => {
    if (!mapReady || !mapRef.current || !window.ymaps) return;

    const map = mapRef.current;
    const ymaps = window.ymaps;

    placemarksRef.current.forEach(pm => map.geoObjects.remove(pm));
    placemarksRef.current = [];

    const geocodedOrders = orders.filter(o => o.geocoded && o.lat && o.lng);
    if (geocodedOrders.length === 0) return;

    const bounds = [];
    const overlapKey = (o) => `${Number(o.lat).toFixed(5)}_${Number(o.lng).toFixed(5)}`;
    const overlapGroups = {};
    geocodedOrders.forEach((o) => {
      const k = overlapKey(o);
      if (!overlapGroups[k]) overlapGroups[k] = [];
      overlapGroups[k].push(o);
    });

    const colors = driverColorsBySlot.length ? driverColorsBySlot : DRIVER_COLORS;

    geocodedOrders.forEach((order) => {
      const globalIdx = orders.findIndex(o => o.id === order.id);
      const driverIdx = assignments ? assignments[globalIdx] : -1;
      const isVisible =
        selectedDriver === null || selectedDriver === -1
          ? true
          : selectedDriver === '__unassigned__'
            ? driverIdx < 0
            : driverIdx === selectedDriver;
      const opacity = isVisible ? 1 : 0.25;
      const color = driverIdx >= 0 ? (colors[driverIdx] ?? DRIVER_COLORS[driverIdx % DRIVER_COLORS.length]) : '#e0e0e0';
      const isHovered = hoveredOrderId === order.id;
      const displayNum = order.isSupplier ? 'П' : order.isPartner ? 'ПР' : (order.poiShort || `${globalIdx + 1}`);

      const isSelected = selectedOrderIds && (selectedOrderIds.has ? selectedOrderIds.has(order.id) : selectedOrderIds.includes(order.id));
      const balloonContent = buildBalloonContent(order, globalIdx, driverIdx, isSelected);

      const k = overlapKey(order);
      const group = overlapGroups[k] || [order];
      const overlapIndex = group.findIndex((o) => o.id === order.id);
      const offset = group.length > 1 ? [overlapIndex * 12, overlapIndex * 12] : [0, 0];

      let placemark;
      if (order.poiId) {
        const sqColor = driverIdx >= 0 ? color : (order.poiColor || '#e0e0e0');
        const sqHtml = `<div style="width:24px;height:24px;border-radius:4px;background:${sqColor};display:flex;align-items:center;justify-content:center;box-shadow:0 2px 5px rgba(0,0,0,.35);border:2px solid ${driverIdx >= 0 ? 'rgba(255,255,255,.8)' : '#888'};opacity:${opacity};${isHovered ? 'box-shadow:0 0 0 3px #fff;z-index:200;' : ''}"><span style="color:#111;font-size:10px;font-weight:800;">${order.poiShort || 'П'}</span></div>`;
        const layout = ymaps.templateLayoutFactory.createClass(sqHtml);
        placemark = new ymaps.Placemark(
          [order.lat, order.lng],
          { balloonContentBody: balloonContent },
          { iconLayout: layout, iconShape: { type: 'Rectangle', coordinates: [[0, 0], [24, 24]] }, iconOffset: [-12 + offset[0], -12 + offset[1]], zIndex: isHovered ? 300 : (isVisible ? 100 : 1) },
        );
      } else if (order.isSupplier) {
        const supHtml = `<div style="width:26px;height:26px;transform:rotate(45deg);border-radius:4px;background:${color};display:flex;align-items:center;justify-content:center;box-shadow:0 2px 5px rgba(0,0,0,.35);border:2px solid ${driverIdx >= 0 ? 'rgba(255,255,255,.9)' : '#888'};opacity:${opacity};${isHovered ? 'box-shadow:0 0 0 3px #fff;z-index:200;' : ''}"><span style="transform:rotate(-45deg);color:${driverIdx >= 0 ? '#fff' : '#333'};font-size:10px;font-weight:800;">П</span></div>`;
        const layout = ymaps.templateLayoutFactory.createClass(supHtml);
        placemark = new ymaps.Placemark(
          [order.lat, order.lng],
          { balloonContentBody: balloonContent },
          { iconLayout: layout, iconShape: { type: 'Rectangle', coordinates: [[0, 0], [26, 26]] }, iconOffset: [-13 + offset[0], -13 + offset[1]], zIndex: isHovered ? 300 : (isVisible ? 100 : 1) },
        );
      } else if (order.isPartner) {
        const partnerHtml = `<div style="width:26px;height:26px;border-radius:7px;background:${color};display:flex;align-items:center;justify-content:center;box-shadow:0 2px 5px rgba(0,0,0,.35);border:2px solid ${driverIdx >= 0 ? 'rgba(255,255,255,.9)' : '#888'};opacity:${opacity};${isHovered ? 'box-shadow:0 0 0 3px #fff;z-index:200;' : ''}"><span style="color:${driverIdx >= 0 ? '#fff' : '#333'};font-size:9px;font-weight:800;">ПР</span></div>`;
        const layout = ymaps.templateLayoutFactory.createClass(partnerHtml);
        placemark = new ymaps.Placemark(
          [order.lat, order.lng],
          { balloonContentBody: balloonContent },
          { iconLayout: layout, iconShape: { type: 'Rectangle', coordinates: [[0, 0], [26, 26]] }, iconOffset: [-13 + offset[0], -13 + offset[1]], zIndex: isHovered ? 300 : (isVisible ? 100 : 1) },
        );
      } else {
        placemark = new ymaps.Placemark(
          [order.lat, order.lng],
          {
            balloonContentBody: balloonContent,
            iconContent: `${displayNum}`,
          },
          {
            preset: 'islands#circleIcon',
            iconColor: color,
            opacity,
            zIndex: isHovered ? 300 : (isVisible ? 100 : 1),
            balloonCloseButton: true,
            hideIconOnBalloonOpen: false,
            iconOffset: [offset[0], offset[1]],
          },
        );
      }

      map.geoObjects.add(placemark);
      placemarksRef.current.push(placemark);
      bounds.push([order.lat, order.lng]);
    });

    if (bounds.length > 0) {
      if (bounds.length === 1) {
        map.setCenter(bounds[0], 15, { duration: 300 });
      } else {
        map.setBounds(ymaps.util.bounds.fromPoints(bounds), {
          checkZoomRange: true,
          zoomMargin: 40,
          duration: 300,
        });
      }
    }
  }, [orders, assignments, selectedDriver, mapReady, buildBalloonContent, driverColorsBySlot, hoveredOrderId, selectedOrderIds]);

  // Как в старой версии: один контейнер #distributionMap.dc-map (index.legacy.html)
  return (
    <div
      id="distributionMap"
      className="dc-map"
      ref={mapContainerRef}
      style={{
        width: '100%',
        height: '100%',
        minHeight: 500,
      }}
    />
  );
}

