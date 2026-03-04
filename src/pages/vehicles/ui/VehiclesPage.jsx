import { useState, useEffect, useCallback } from 'react';
import {
  fetchVehicles,
  createVehicle,
  updateVehicle,
  deleteVehicle,
  getMileageLog,
  addMileageLog,
  updateMileageLog,
  deleteMileageLog,
  getMileageFilledVehicleIdsForDate,
} from '../../../shared/api/vehiclesApi.js';
import { fetchDrivers } from '../../../shared/api/driversApi.js';

const MONTH_NAMES = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

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

  const [mileageVehicleId, setMileageVehicleId] = useState(null);
  const [mileageEntries, setMileageEntries] = useState([]);
  const [mileageMonthFilter, setMileageMonthFilter] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [mileageForm, setMileageForm] = useState({ driver_id: '', log_date: '', mileage: '', fuel_level_out: '', fuel_refill: '', notes: '' });
  const [filledTodayIds, setFilledTodayIds] = useState(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [vehiclesData, driversData] = await Promise.all([fetchVehicles(), fetchDrivers()]);
      setList(vehiclesData || []);
      setDrivers(driversData || []);
      const today = new Date().toISOString().split('T')[0];
      const ids = await getMileageFilledVehicleIdsForDate(today);
      setFilledTodayIds(new Set(ids));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadMileage = useCallback(async () => {
    if (!mileageVehicleId) return;
    try {
      const [y, m] = mileageMonthFilter.split('-');
      const start = `${y}-${m}-01`;
      const lastDay = new Date(parseInt(y), parseInt(m), 0).getDate();
      const end = `${y}-${m}-${String(lastDay).padStart(2, '0')}`;
      const entries = await getMileageLog(mileageVehicleId, start, end);
      setMileageEntries(entries);
    } catch (e) {
      console.error(e);
      setMileageEntries([]);
    }
  }, [mileageVehicleId, mileageMonthFilter]);

  useEffect(() => {
    loadMileage();
  }, [loadMileage]);

  const currentVehicle = list.find((v) => v.id === mileageVehicleId);
  const todayStr = new Date().toISOString().split('T')[0];

  const getDriverName = (driverId) => {
    if (!driverId) return '—';
    const d = drivers.find((x) => Number(x.id) === Number(driverId));
    return d ? d.name : driverId;
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

  const openMileage = (vehicle) => {
    setMileageVehicleId(vehicle.id);
    setMileageForm({
      driver_id: vehicle.driver_id ? String(vehicle.driver_id) : '',
      log_date: todayStr,
      mileage: '',
      fuel_level_out: '',
      fuel_refill: '',
      notes: '',
    });
  };

  const closeMileage = () => {
    setMileageVehicleId(null);
    setMileageEntries([]);
    load();
  };

  const submitMileage = async (e) => {
    e.preventDefault();
    if (!mileageVehicleId) return;
    const mileageReturn = parseInt(mileageForm.mileage, 10);
    if (!Number.isFinite(mileageReturn)) {
      alert('Укажите пробег при возвращении');
      return;
    }
    try {
      const allEntries = await getMileageLog(mileageVehicleId);
      const sorted = [...allEntries].sort((a, b) => new Date(a.log_date) - new Date(b.log_date));
      let mileageOut = 0;
      if (sorted.length > 0) {
        const last = sorted[sorted.length - 1];
        mileageOut = last.mileage || 0;
      } else if (currentVehicle && currentVehicle.mileage) {
        mileageOut = currentVehicle.mileage;
      }
      if (mileageReturn <= mileageOut) {
        alert(`Показания одометра (${mileageReturn}) должны быть больше предыдущего (${mileageOut})`);
        return;
      }
      const entry = {
        vehicle_id: mileageVehicleId,
        driver_id: mileageForm.driver_id ? parseInt(mileageForm.driver_id, 10) : null,
        log_date: mileageForm.log_date || todayStr,
        mileage: mileageReturn,
        mileage_out: mileageOut,
        notes: mileageForm.notes.trim() || null,
      };
      if (mileageForm.fuel_level_out) entry.fuel_level_out = parseFloat(mileageForm.fuel_level_out);
      if (mileageForm.fuel_refill) entry.fuel_refill = parseFloat(mileageForm.fuel_refill);
      await addMileageLog(entry);
      setMileageForm((f) => ({ ...f, mileage: '', fuel_level_out: '', fuel_refill: '', notes: '' }));
      loadMileage();
      load();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Ошибка сохранения');
    }
  };

  const removeMileageEntry = async (id) => {
    if (!confirm('Удалить запись?')) return;
    try {
      await deleteMileageLog(id);
      loadMileage();
      load();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Ошибка удаления');
    }
  };

  const printMileage = () => {
    const printArea = document.getElementById('mileagePrintArea');
    if (!printArea) return;
    const win = window.open('', '_blank');
    win.document.write(`
      <!DOCTYPE html>
      <html>
        <head><meta charset="utf-8"><title>Путевой лист</title>
          <style>
            body { font-family: sans-serif; padding: 16px; }
            table { border-collapse: collapse; width: 100%; }
            th, td { border: 1px solid #333; padding: 6px 8px; text-align: left; }
            .header { margin-bottom: 16px; }
          </style>
        </head>
        <body>
          <div class="header">
            <strong>Автомобиль:</strong> ${currentVehicle ? [currentVehicle.brand, currentVehicle.model, currentVehicle.plate_number].filter(Boolean).join(' ') || currentVehicle.plate_number : '—'}<br/>
            <strong>Период:</strong> ${mileageMonthFilter ? MONTH_NAMES[parseInt(mileageMonthFilter.split('-')[1], 10) - 1] + ' ' + mileageMonthFilter.split('-')[0] : '—'}
          </div>
          ${printArea.innerHTML}
        </body>
      </html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  };

  if (mileageVehicleId != null) {
    const sorted = [...mileageEntries].sort((a, b) => new Date(a.log_date) - new Date(b.log_date));
    let prevMileage = currentVehicle?.mileage ?? 0;
    const rowsWithShift = sorted.map((entry, i) => {
      const out = entry.mileage_out ?? prevMileage;
      const ret = entry.mileage ?? 0;
      const shift = ret - out;
      prevMileage = ret;
      return { ...entry, _out: out, _shift: shift };
    });

    return (
      <section className="content-section active">
        <section className="section-header">
          <h1 className="section-title">Лог пробега: {currentVehicle?.plate_number || '—'}</h1>
          <button type="button" className="btn btn-outline" onClick={closeMileage}>
            ← К списку автомобилей
          </button>
        </section>

        <div className="mileage-content" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <form onSubmit={submitMileage} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Водитель</label>
              <select
                className="form-input"
                value={mileageForm.driver_id}
                onChange={(e) => setMileageForm((f) => ({ ...f, driver_id: e.target.value }))}
              >
                <option value="">—</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Дата</label>
              <input
                type="date"
                className="form-input"
                value={mileageForm.log_date}
                onChange={(e) => setMileageForm((f) => ({ ...f, log_date: e.target.value }))}
                required
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Пробег (км при возвращении) *</label>
              <input
                type="number"
                min={0}
                className="form-input"
                value={mileageForm.mileage}
                onChange={(e) => setMileageForm((f) => ({ ...f, mileage: e.target.value }))}
                placeholder={currentVehicle?.mileage ? `Текущий: ${currentVehicle.mileage}` : ''}
                required
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Топливо при выезде (л)</label>
              <input
                type="number"
                step="0.1"
                min={0}
                className="form-input"
                value={mileageForm.fuel_level_out}
                onChange={(e) => setMileageForm((f) => ({ ...f, fuel_level_out: e.target.value }))}
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Заправка (л)</label>
              <input
                type="number"
                step="0.1"
                min={0}
                className="form-input"
                value={mileageForm.fuel_refill}
                onChange={(e) => setMileageForm((f) => ({ ...f, fuel_refill: e.target.value }))}
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">Примечания</label>
              <input
                type="text"
                className="form-input"
                value={mileageForm.notes}
                onChange={(e) => setMileageForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
            <button type="submit" className="btn btn-primary">Добавить запись</button>
          </form>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <label>
              Период:{' '}
              <input
                type="month"
                value={mileageMonthFilter}
                onChange={(e) => setMileageMonthFilter(e.target.value)}
              />
            </label>
            <button type="button" className="btn btn-outline" onClick={loadMileage}>Обновить</button>
            <button type="button" className="btn btn-outline" onClick={printMileage}>Печать за месяц</button>
          </div>

          <div id="mileagePrintArea">
            <table className="table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Водитель</th>
                  <th>Выезд (км)</th>
                  <th>Возвращение (км)</th>
                  <th>За смену (км)</th>
                  <th>Примечания</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rowsWithShift.length === 0 ? (
                  <tr><td colSpan={7} className="muted">Нет записей за выбранный период</td></tr>
                ) : (
                  rowsWithShift.map((entry) => (
                    <tr key={entry.id}>
                      <td>{entry.log_date}</td>
                      <td>{entry.driver?.name ?? '—'}</td>
                      <td>{entry._out > 0 ? entry._out.toLocaleString() : '—'}</td>
                      <td>{(entry.mileage || 0).toLocaleString()}</td>
                      <td>{entry._shift > 0 ? entry._shift.toLocaleString() : '—'}</td>
                      <td>{entry.notes || '—'}</td>
                      <td>
                        <button type="button" className="btn btn-outline btn-sm" style={{ color: 'var(--danger)' }} onClick={() => removeMileageEntry(entry.id)}>Удалить</button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="content-section active">
      <section className="section-header">
        <h1 className="section-title">Автомобили</h1>
        <button type="button" className="btn btn-primary" onClick={() => { setEditingId(null); setForm({ plate_number: '', driver_id: '', mileage: '', notes: '', inspection_expiry: '', insurance_expiry: '' }); setModalOpen(true); }}>
          Добавить автомобиль
        </button>
      </section>
      {loading ? (
        <p className="muted">Загрузка...</p>
      ) : (
        <ul className="cards">
          {list.map((item) => {
            const filledToday = filledTodayIds.has(item.id);
            return (
              <li key={item.id} className="card">
                <div className="card-body">
                  <h3 className="card-title">{item.plate_number}</h3>
                  <p className="card-meta">Водитель: {getDriverName(item.driver_id)}</p>
                  {item.mileage != null && <p className="card-meta">Пробег: {item.mileage.toLocaleString()} км</p>}
                  <p className="card-meta" style={{ fontWeight: 500, color: filledToday ? 'var(--success, green)' : 'var(--muted)' }}>
                    {filledToday ? '✅ Пробег за смену: заполнен' : '⚠️ Пробег за смену: не заполнен'}
                  </p>
                  {item.inspection_expiry && <p className="card-meta">Техосмотр до: {item.inspection_expiry}</p>}
                  {item.insurance_expiry && <p className="card-meta">Страховка до: {item.insurance_expiry}</p>}
                </div>
                <div className="card-actions">
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => openMileage(item)}>Лог пробега</button>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => openEdit(item)}>Изменить</button>
                  <button type="button" className="btn btn-outline btn-sm" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }} onClick={() => handleDelete(item.id)}>Удалить</button>
                </div>
              </li>
            );
          })}
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
