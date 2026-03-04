import { useState, useEffect, useCallback } from 'react';
import { fetchVehicles, createVehicle, updateVehicle, deleteVehicle } from '../../../shared/api/vehiclesApi.js';
import { fetchDrivers } from '../../../shared/api/driversApi.js';

export default function VehiclesPage() {
  const [list, setList] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    plate_number: '', driver_id: '', mileage: '', notes: '',
    inspection_expiry: '', insurance_expiry: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [vehiclesData, driversData] = await Promise.all([fetchVehicles(), fetchDrivers()]);
      setList(vehiclesData || []);
      setDrivers(driversData || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const getDriverName = (driverId) => {
    if (!driverId) return '—';
    const d = drivers.find((x) => Number(x.id) === Number(driverId));
    return d ? d.name : driverId;
  };

  const openCreate = () => {
    setEditingId(null);
    setForm({
      plate_number: '', driver_id: '', mileage: '', notes: '',
      inspection_expiry: '', insurance_expiry: '',
    });
    setModalOpen(true);
  };

  const openEdit = (item) => {
    setEditingId(item.id);
    setForm({
      plate_number: item.plate_number || '',
      driver_id: item.driver_id != null ? String(item.driver_id) : '',
      mileage: item.mileage != null ? String(item.mileage) : '',
      notes: item.notes || '',
      inspection_expiry: item.inspection_expiry ? item.inspection_expiry.slice(0, 10) : '',
      insurance_expiry: item.insurance_expiry ? item.insurance_expiry.slice(0, 10) : '',
    });
    setModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.plate_number.trim()) return;
    try {
      const row = {
        plate_number: form.plate_number.trim(),
        driver_id: form.driver_id ? parseInt(form.driver_id, 10) : null,
        mileage: form.mileage ? parseInt(form.mileage, 10) : 0,
        notes: form.notes.trim() || null,
        inspection_expiry: form.inspection_expiry || null,
        insurance_expiry: form.insurance_expiry || null,
      };
      if (editingId) {
        await updateVehicle(editingId, row);
      } else {
        await createVehicle(row);
      }
      setModalOpen(false);
      load();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Ошибка сохранения');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Удалить автомобиль?')) return;
    try {
      await deleteVehicle(id);
      load();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Ошибка удаления');
    }
  };

  return (
    <section className="content-section active">
      <section className="section-header">
        <h1 className="section-title">Автомобили</h1>
        <button type="button" className="btn btn-primary" onClick={openCreate}>
          Добавить автомобиль
        </button>
      </section>
      {loading ? (
        <p className="muted">Загрузка...</p>
      ) : (
        <ul className="cards">
          {list.map((item) => (
            <li key={item.id} className="card">
              <div className="card-body">
                <h3 className="card-title">{item.plate_number}</h3>
                <p className="card-meta">Водитель: {getDriverName(item.driver_id)}</p>
                {item.mileage != null && <p className="card-meta">Пробег: {item.mileage} км</p>}
                {item.inspection_expiry && <p className="card-meta">Техосмотр до: {item.inspection_expiry}</p>}
                {item.insurance_expiry && <p className="card-meta">Страховка до: {item.insurance_expiry}</p>}
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
        <p className="muted">Нет автомобилей. Нажмите «Добавить автомобиль».</p>
      )}

      {modalOpen && (
        <div className="modal" style={{ display: 'flex' }}>
          <div className="modal-content">
            <h3 className="modal-title">{editingId ? 'Редактировать автомобиль' : 'Добавить автомобиль'}</h3>
            <form className="supplier-form" onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">Гос. номер *</label>
                <input className="form-input" value={form.plate_number} onChange={(e) => setForm((f) => ({ ...f, plate_number: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label className="form-label">Водитель</label>
                <select className="form-input" value={form.driver_id} onChange={(e) => setForm((f) => ({ ...f, driver_id: e.target.value }))}>
                  <option value="">Не назначен</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Пробег (км)</label>
                <input type="number" min={0} className="form-input" value={form.mileage} onChange={(e) => setForm((f) => ({ ...f, mileage: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Техосмотр до</label>
                <input type="date" className="form-input" value={form.inspection_expiry} onChange={(e) => setForm((f) => ({ ...f, inspection_expiry: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Страховка до</label>
                <input type="date" className="form-input" value={form.insurance_expiry} onChange={(e) => setForm((f) => ({ ...f, insurance_expiry: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Примечания</label>
                <textarea className="form-textarea" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
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
