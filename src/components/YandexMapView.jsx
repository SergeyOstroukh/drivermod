import { useEffect, useRef, useState, useCallback } from 'react';
import { DRIVER_COLORS } from '../utils/distributor';

const YMAPS_SRC = 'https://api-maps.yandex.ru/2.1/?lang=ru_RU';
const MINSK_CENTER = [53.9006, 27.5590];
const DEFAULT_ZOOM = 11;

let ymapsLoaded = false;
let ymapsLoadPromise = null;

function loadYmaps() {
  if (ymapsLoaded) return Promise.resolve(window.ymaps);
  if (ymapsLoadPromise) return ymapsLoadPromise;

  ymapsLoadPromise = new Promise((resolve, reject) => {
    if (window.ymaps) {
      window.ymaps.ready(() => { ymapsLoaded = true; resolve(window.ymaps); });
      return;
    }
    const script = document.createElement('script');
    script.src = YMAPS_SRC;
    script.async = true;
    script.onload = () => {
      window.ymaps.ready(() => { ymapsLoaded = true; resolve(window.ymaps); });
    };
    script.onerror = () => reject(new Error('Failed to load Yandex Maps'));
    document.head.appendChild(script);
  });

  return ymapsLoadPromise;
}

export default function YandexMapView({
  orders,
  assignments,
  driverCount,
  selectedDriver,
  onAssignDriver, // callback(globalIndex, driverIdx)
  onDeleteOrder,   // callback(orderId) to delete an order
  placingMode,    // boolean: is user placing a point on map?
  onMapClick,     // callback(lat, lng) for placing mode
}) {
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const placemarksRef = useRef([]);
  const [mapReady, setMapReady] = useState(false);

  // Refs for callbacks
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
    window.__drivecontrol_delete = (orderId) => {
      if (onDeleteRef.current) {
        onDeleteRef.current(orderId);
      }
      if (mapRef.current) {
        mapRef.current.balloon.close();
      }
    };
    return () => {
      delete window.__drivecontrol_assign;
      delete window.__drivecontrol_delete;
    };
  }, []);

  // Initialize map
  useEffect(() => {
    let cancelled = false;
    loadYmaps().then((ymaps) => {
      if (cancelled || !mapContainerRef.current || mapRef.current) return;
      const map = new ymaps.Map(mapContainerRef.current, {
        center: MINSK_CENTER,
        zoom: DEFAULT_ZOOM,
        controls: ['zoomControl', 'fullscreenControl'],
      }, { suppressMapOpenBlock: true });
      // Handle map clicks for placing mode
      map.events.add('click', (e) => {
        if (placingModeRef.current && onMapClickRef.current) {
          const coords = e.get('coords');
          onMapClickRef.current(coords[0], coords[1]);
        }
      });

      mapRef.current = map;
      setMapReady(true);
    });
    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.destroy(); mapRef.current = null; }
    };
  }, []);

  // Change cursor when in placing mode
  useEffect(() => {
    if (!mapContainerRef.current) return;
    mapContainerRef.current.style.cursor = placingMode ? 'crosshair' : '';
  }, [placingMode]);

  // Build balloon HTML with driver assignment buttons + delete
  const buildBalloonContent = useCallback((order, globalIdx, currentDriverIdx) => {
    const driverButtons = Array.from({ length: driverCount }, (_, d) => {
      const color = DRIVER_COLORS[d % DRIVER_COLORS.length];
      const isActive = d === currentDriverIdx;
      return `<button onclick="window.__drivecontrol_assign(${globalIdx}, ${d})" style="
        width:30px;height:30px;border-radius:50%;border:3px solid ${isActive ? '#fff' : 'transparent'};
        background:${color};cursor:pointer;margin:0 3px;
        box-shadow:${isActive ? '0 0 0 2px ' + color : 'none'};
        transition:all 0.15s;
      " title="Водитель ${d + 1}"></button>`;
    }).join('');

    const escapedId = order.id.replace(/'/g, "\\'");

    return `
      <div style="font-family:Inter,sans-serif;min-width:200px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <div style="font-weight:700;font-size:14px;margin-bottom:4px;">${order.address}</div>
          <button onclick="window.__drivecontrol_delete('${escapedId}')" style="
            flex-shrink:0;width:28px;height:28px;border-radius:6px;border:1px solid #e5e5e5;
            background:#fff;color:#ef4444;font-size:16px;cursor:pointer;display:flex;
            align-items:center;justify-content:center;transition:all 0.15s;
          " onmouseover="this.style.background='#ef4444';this.style.color='#fff';this.style.borderColor='#ef4444'"
             onmouseout="this.style.background='#fff';this.style.color='#ef4444';this.style.borderColor='#e5e5e5'"
             title="Удалить точку">✕</button>
        </div>
        ${order.formattedAddress ? `<div style="color:#888;font-size:11px;margin-bottom:4px;">${order.formattedAddress}</div>` : ''}
        ${order.timeSlot ? `<div style="font-size:12px;margin-bottom:4px;">⏰ ${order.timeSlot}</div>` : ''}
        ${order.phone ? `<div style="font-size:12px;margin-bottom:8px;">📞 ${order.phone}</div>` : ''}
        <div style="border-top:1px solid #eee;padding-top:8px;margin-top:4px;">
          <div style="font-size:11px;color:#888;margin-bottom:6px;">Назначить водителя:</div>
          <div style="display:flex;align-items:center;">${driverButtons}</div>
        </div>
      </div>
    `;
  }, [driverCount]);

  // Update placemarks
  useEffect(() => {
    if (!mapReady || !mapRef.current || !window.ymaps) return;

    const map = mapRef.current;
    const ymaps = window.ymaps;

    placemarksRef.current.forEach(pm => map.geoObjects.remove(pm));
    placemarksRef.current = [];

    const geocodedOrders = orders.filter(o => o.geocoded && o.lat && o.lng);
    if (geocodedOrders.length === 0) return;

    const bounds = [];

    geocodedOrders.forEach((order) => {
      const globalIdx = orders.findIndex(o => o.id === order.id);
      const driverIdx = assignments ? assignments[globalIdx] : -1;
      const isVisible = selectedDriver === null || selectedDriver === -1 || driverIdx === selectedDriver;
      const opacity = isVisible ? 1 : 0.25;
      const color = driverIdx >= 0 ? DRIVER_COLORS[driverIdx % DRIVER_COLORS.length] : '#3b82f6';

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
        }
      );

      map.geoObjects.add(placemark);
      placemarksRef.current.push(placemark);
      bounds.push([order.lat, order.lng]);
    });

    if (bounds.length > 0) {
      if (bounds.length === 1) {
        map.setCenter(bounds[0], 15, { duration: 300 });
      } else {
        map.setBounds(
          ymaps.util.bounds.fromPoints(bounds),
          { checkZoomRange: true, zoomMargin: 40, duration: 300 }
        );
      }
    }
  }, [orders, assignments, selectedDriver, mapReady, buildBalloonContent]);

  return (
    <div className="map-container">
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}
