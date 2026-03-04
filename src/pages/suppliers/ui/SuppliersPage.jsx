import { useState, useEffect, useCallback } from 'react';
import { fetchSuppliers, createSupplier, updateSupplier, deleteSupplier } from '../../../shared/api/suppliersApi.js';
import {
  buildYandexPlaceUrl,
  buildYandexRouteUrl,
  buildYandexMultiRouteUrl,
  buildYandexNavigatorPlaceUrl,
  buildYandexNavigatorRouteUrl,
  openWithFallback,
  optimizeRoute,
} from '../../../shared/utils/yandexMaps.js';

function supplierKey(s) {
  return `${s.name || ''}_${s.lat}_${s.lon}`;
}

export default function SuppliersPage() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedKeys, setSelectedKeys] = useState(new Set());
  const [geo, setGeo] = useState(null);
  const [routeModal, setRouteModal] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: '', address: '', lat: '', lon: '', working_hours: '', additional_info: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchSuppliers();
      setList(data || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => setGeo({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => setGeo(null),
      { enableHighAccuracy: true, maximumAge: 60000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  const filtered = searchQuery.trim()
    ? list.filter((s) => (s.name || '').toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : list;

  const toggleSelected = (s) => {
    const key = supplierKey(s);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const clearSelection = () => setSelectedKeys(new Set());

  const openRoute = (lat, lon, label) => {
    setRouteModal({ type: 'single', toLat: lat, toLon: lon, label: label || '' });
  };

  const openRouteMulti = () => {
    const selected = list.filter((s) => selectedKeys.has(supplierKey(s)));
    if (selected.length === 0) {
      alert('Выберите хотя бы одного поставщика');
      return;
    }
    if (!geo) {
      alert('Нужна геопозиция для маршрута. Разрешите доступ к местоположению.');
      return;
    }
    const points = selected.map((s) => ({ lat: s.lat, lon: s.lon }));
    const start = { lat: geo.lat, lon: geo.lon };
    const optimized = optimizeRoute(start, points);
    setRouteModal({ type: 'multi', points: [start, ...optimized] });
  };

  const openInMaps = () => {
    if (!routeModal) return;
    if (routeModal.type === 'single') {
      if (geo) {
        window.location.href = buildYandexRouteUrl(geo.lat, geo.lon, routeModal.toLat, routeModal.toLon);
      } else {
        window.location.href = buildYandexPlaceUrl(routeModal.toLat, routeModal.toLon);
      }
    } else {
      window.location.href = buildYandexMultiRouteUrl(routeModal.points);
    }
    setRouteModal(null);
  };

  const openInNavi = () => {
    if (!routeModal) return;
    if (routeModal.type === 'single') {
      if (geo) {
        const navi = buildYandexNavigatorRouteUrl(geo.lat, geo.lon, routeModal.toLat, routeModal.toLon);
        const maps = buildYandexRouteUrl(geo.lat, geo.lon, routeModal.toLat, routeModal.toLon);
        openWithFallback(navi, maps);
      } else {
        const navi = buildYandexNavigatorPlaceUrl(routeModal.toLat, routeModal.toLon, routeModal.label);
        const maps = buildYandexPlaceUrl(routeModal.toLat, routeModal.toLon);
        openWithFallback(navi, maps);
      }
    } else {
      window.location.href = buildYandexMultiRouteUrl(routeModal.points);
    }
    setRouteModal(null);
  };

  const openPoint = (s) => {
    const navi = buildYandexNavigatorPlaceUrl(s.lat, s.lon, s.name || '');
    const maps = buildYandexPlaceUrl(s.lat, s.lon);
    openWithFallback(navi, maps);
  };

  const openCreate = () => {
    setEditingId(null);
    setForm({ name: '', address: '', lat: '', lon: '', working_hours: '', additional_info: '' });
    setModalOpen(true);
  };

  const openEdit = (item) => {
    setEditingId(item.id);
    setForm({
      name: item.name || '',
      address: item.address || '',
      lat: String(item.lat ?? ''),
      lon: String(item.lon ?? ''),
      working_hours: item.working_hours || '',
      additional_info: item.additional_info || '',
    });
    setModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const lat = parseFloat(form.lat);
    const lon = parseFloat(form.lon);
    if (!form.name.trim() || isNaN(lat) || isNaN(lon)) return;
    try {
      const row = {
        name: form.name.trim(),
        address: form.address.trim() || null,
        lat,
        lon,
        working_hours: form.working_hours.trim() || null,
        additional_info: form.additional_info.trim() || null,
      };
      if (editingId) {
        await updateSupplier(editingId, row);
      } else {
        await createSupplier(row);
      }
      setModalOpen(false);
      load();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Ошибка сохранения');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Удалить поставщика?')) return;
    try {
      await deleteSupplier(id);
      load();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Ошибка удаления');
    }
  };

  const selectedCount = selectedKeys.size;

  return (
    <section className="content-section active">
      <section className="section-header">
        <h1 className="section-title">Поставщики</h1>
        <label className="search" style={{ flex: 1, maxWidth: 280 }}>
          <input
            type="search"
            className="search-input form-input"
            placeholder="Поиск по названию"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </label>
        <button type="button" className="btn btn-primary" onClick={openCreate}>
          Добавить
        </button>
      </section>

      <section className="route-section" style={{ marginBottom: 16 }}>
        <button
          type="button"
          className="btn btn-primary route-btn"
          disabled={selectedCount === 0 || !geo}
          onClick={openRouteMulti}
        >
          {selectedCount > 0 ? `Поехать по маршруту (${selectedCount})` : 'Поехать по маршруту'}
        </button>
        <button
          type="button"
          className="btn btn-outline route-btn"
          disabled={selectedCount === 0}
          onClick={clearSelection}
        >
          Сбросить выбранное
        </button>
        {geo && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Геопозиция определена</span>}
      </section>

      {loading ? (
        <p className="muted">Загрузка...</p>
      ) : (
        <ul className="cards">
          {filtered.map((item) => {
            const key = supplierKey(item);
            const isSelected = selectedKeys.has(key);
            return (
              <li key={item.id} className="card">
                <div className="card-header" style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <div className="checkbox-wrap">
                    <input
                      type="checkbox"
                      className="supplier-checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelected(item)}
                    />
                  </div>
                  <div className="card-body" style={{ flex: 1 }}>
                    <h3 className="card-title">{item.name}</h3>
                    {item.address && <p className="card-meta">{item.address}</p>}
                    {item.working_hours && <p className="card-working-hours">🕐 {item.working_hours}</p>}
                    {item.additional_info && <p className="card-additional-info">{item.additional_info}</p>}
                    <p className="card-meta">Координаты: {item.lat}, {item.lon}</p>
                  </div>
                </div>
                <div className="actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  <button type="button" className="btn btn-primary" onClick={() => openRoute(item.lat, item.lon, item.name)}>
                    Поехали
                  </button>
                  <button type="button" className="btn btn-outline" onClick={() => openPoint(item)}>
                    Открыть точку
                  </button>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => openEdit(item)}>Изменить</button>
                  <button type="button" className="btn btn-outline btn-sm" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => handleDelete(item.id)}>Удалить</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {filtered.length === 0 && !loading && (
        <p className="muted">Нет поставщиков. Нажмите «Добавить».</p>
      )}

      {routeModal && (
        <div className="modal is-open" style={{ display: 'flex' }}>
          <div className="modal-content">
            <h3 className="modal-title">Выберите способ открытия маршрута</h3>
            <div className="modal-actions" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary modal-btn" onClick={() => openInNavi()}>
                Яндекс.Навигатор
              </button>
              <button type="button" className="btn btn-outline modal-btn" onClick={() => openInMaps()}>
                Яндекс.Карты
              </button>
              <button type="button" className="btn btn-outline modal-btn" onClick={() => setRouteModal(null)}>Отмена</button>
            </div>
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="modal" style={{ display: 'flex' }}>
          <div className="modal-content">
            <h3 className="modal-title">{editingId ? 'Редактировать поставщика' : 'Добавить поставщика'}</h3>
            <form className="supplier-form" onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">Название *</label>
                <input className="form-input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label className="form-label">Адрес</label>
                <input className="form-input" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Широта (lat) *</label>
                <input type="number" step="any" className="form-input" value={form.lat} onChange={(e) => setForm((f) => ({ ...f, lat: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label className="form-label">Долгота (lon) *</label>
                <input type="number" step="any" className="form-input" value={form.lon} onChange={(e) => setForm((f) => ({ ...f, lon: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label className="form-label">Время работы</label>
                <input className="form-input" value={form.working_hours} onChange={(e) => setForm((f) => ({ ...f, working_hours: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Доп. информация</label>
                <textarea className="form-textarea" rows={3} value={form.additional_info} onChange={(e) => setForm((f) => ({ ...f, additional_info: e.target.value }))} />
              </div>
              <div className="form-actions">
                <button type="submit" className="btn btn-primary">Сохранить</button>
                <button type="button" className="btn btn-outline" onClick={() => setModalOpen(false)}>Отмена</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
