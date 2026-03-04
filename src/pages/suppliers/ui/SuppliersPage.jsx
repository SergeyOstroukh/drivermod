import { useState, useEffect, useCallback } from 'react';
import { fetchSuppliers, createSupplier, updateSupplier, deleteSupplier } from '../../../shared/api/suppliersApi.js';

export default function SuppliersPage() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
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

  return (
    <section className="content-section active">
      <section className="section-header">
        <h1 className="section-title">Поставщики</h1>
        <button type="button" className="btn btn-primary" onClick={openCreate}>
          Добавить
        </button>
      </section>
      {loading ? (
        <p className="muted">Загрузка...</p>
      ) : (
        <ul className="cards">
          {list.map((item) => (
            <li key={item.id} className="card">
              <div className="card-body">
                <h3 className="card-title">{item.name}</h3>
                {item.address && <p className="card-meta">{item.address}</p>}
                <p className="card-meta">Координаты: {item.lat}, {item.lon}</p>
              </div>
              <div className="card-actions">
                <button type="button" className="btn btn-outline btn-sm" onClick={() => openEdit(item)}>Изменить</button>
                <button type="button" className="btn btn-outline btn-sm" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => handleDelete(item.id)}>Удалить</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {list.length === 0 && !loading && (
        <p className="muted">Нет поставщиков. Нажмите «Добавить».</p>
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
