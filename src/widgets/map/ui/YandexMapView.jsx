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
    return () => {
      delete window.__drivecontrol_assign;
      delete window.__drivecontrol_delete;
      delete window.__drivecontrol_centerOrder;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const getContainer = () => mapContainerRef.current || document.getElementById('distributionMap');

    const initWhenReady = () => {
      if (cancelled || mapRef.current) return;
      const el = getContainer();
      if (!el) return;
      const w = el.offsetWidth || el.parentElement?.offsetWidth || 0;
      const h = el.offsetHeight || el.parentElement?.offsetHeight || 0;
      if (w < 50 || h < 50) return;
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
    (order, globalIdx, currentDriverIdx) => {
      const driverButtons = Array.from({ length: driverCount }, (_, d) => {
        const color = DRIVER_COLORS[d % DRIVER_COLORS.length];
        const isActive = d === currentDriverIdx;
        return `<button onclick="window.__drivecontrol_assign(${globalIdx}, ${d})" style="
        width:30px;height:30px;border-radius:50%;border:3px solid ${
          isActive ? '#fff' : 'transparent'
        };
        background:${color};cursor:pointer;margin:0 3px;
        box-shadow:${isActive ? '0 0 0 2px ' + color : 'none'};
        transition:all 0.15s;
      " title="Водитель ${d + 1}"></button>`;
      }).join('');

      const escapedId = order.id.replace(/'/g, "\\'");

      return `
      <div style="font-family:Inter,sans-serif;min-width:200px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <div style="font-weight:700;font-size:14px;margin-bottom:4px;">${
            order.address
          }</div>
          <button onclick="window.__drivecontrol_delete('${escapedId}')" style="
            flex-shrink:0;width:28px;height:28px;border-radius:6px;border:1px solid #e5e5e5;
            background:#fff;color:#ef4444;font-size:16px;cursor:pointer;display:flex;
            align-items:center;justify-content:center;transition:all 0.15s;
          " onmouseover="this.style.background='#ef4444';this.style.color='#fff';this.style.borderColor='#ef4444'"
             onmouseout="this.style.background='#fff';this.style.color='#ef4444';this.style.borderColor='#e5e5e5'"
             title="Удалить точку">✕</button>
        </div>
        ${
          order.formattedAddress
            ? `<div style="color:#888;font-size:11px;margin-bottom:4px;">${order.formattedAddress}</div>`
            : ''
        }
        ${
          order.timeSlot
            ? `<div style="font-size:12px;margin-bottom:4px;">⏰ ${order.timeSlot}</div>`
            : ''
        }
        ${
          order.phone
            ? `<div style="font-size:12px;margin-bottom:8px;">📞 ${order.phone}</div>`
            : ''
        }
        <div style="border-top:1px solid #eee;padding-top:8px;margin-top:4px;">
          <div style="font-size:11px;color:#888;margin-bottom:6px;">Назначить водителя:</div>
          <div style="display:flex;align-items:center;">${driverButtons}</div>
        </div>
      </div>
    `;
    },
    [driverCount],
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

    geocodedOrders.forEach(order => {
      const globalIdx = orders.findIndex(o => o.id === order.id);
      const driverIdx = assignments ? assignments[globalIdx] : -1;
      const isVisible =
        selectedDriver === null || selectedDriver === -1
          ? true
          : selectedDriver === '__unassigned__'
            ? driverIdx < 0
            : driverIdx === selectedDriver;
      const opacity = isVisible ? 1 : 0.25;
      const color =
        driverIdx >= 0
          ? DRIVER_COLORS[driverIdx % DRIVER_COLORS.length]
          : '#3b82f6';

      const balloonContent = buildBalloonContent(order, globalIdx, driverIdx);

      const placemark = new ymaps.Placemark(
        [order.lat, order.lng],
        {
          balloonContentBody: balloonContent,
          iconContent: `${globalIdx + 1}`,
        },
        {
          preset: 'islands#circleIcon',
          iconColor: color,
          opacity,
          zIndex: isVisible ? 100 : 1,
          balloonCloseButton: true,
          hideIconOnBalloonOpen: false,
        },
      );

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
  }, [orders, assignments, selectedDriver, mapReady, buildBalloonContent]);

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

