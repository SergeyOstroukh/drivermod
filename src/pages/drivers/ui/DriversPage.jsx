import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { fetchDrivers, createDriver, updateDriver, deleteDriver } from '../../../shared/api/driversApi.js';

export default function DriversPage() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: '', phone: '', license_number: '', license_expiry: '', telegram_chat_id: '', notes: '', show_in_schedule: true });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchDrivers();
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
    setForm({ name: '', phone: '', license_number: '', license_expiry: '', telegram_chat_id: '', notes: '', show_in_schedule: true });
    setModalOpen(true);
  };

  const openEdit = (item) => {
    setEditingId(item.id);
    setForm({
      name: item.name || '',
      phone: item.phone || '',
      license_number: item.license_number || '',
      license_expiry: item.license_expiry ? item.license_expiry.slice(0, 10) : '',
      telegram_chat_id: item.telegram_chat_id != null ? String(item.telegram_chat_id) : '',
      notes: item.notes || '',
      show_in_schedule: item.show_in_schedule !== false,
    });
    setModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    try {
      const row = {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        license_number: form.license_number.trim() || null,
        license_expiry: form.license_expiry || null,
        telegram_chat_id: form.telegram_chat_id.trim() ? parseInt(form.telegram_chat_id, 10) : null,
        notes: form.notes.trim() || null,
        show_in_schedule: form.show_in_schedule,
      };
      if (editingId) {
        await updateDriver(editingId, row);
      } else {
        await createDriver(row);
      }
      setModalOpen(false);
      load();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Ошибка сохранения');
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Удалить водителя?')) return;
    try {
      await deleteDriver(id);
      load();
    } catch (err) {
      console.error(err);
      alert(err.message || 'Ошибка удаления');
    }
  };

  return (
    <section className="content-section active">
      <section className="section-header">
        <h1 className="section-title">Водители</h1>
        <Link to="/distribution" className="btn btn-outline">Распределение</Link>
        <button type="button" className="btn btn-primary" onClick={openCreate}>
          Добавить водителя
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
                {item.phone && <p className="card-meta">📞 {item.phone}</p>}
                {item.license_number && <p className="card-meta">Удостоверение: {item.license_number}</p>}
                {item.notes && <p className="card-meta">{item.notes}</p>}
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
        <p className="muted">Нет водителей. Нажмите «Добавить водителя».</p>
      )}

      {modalOpen && (
        <div className="modal" style={{ display: 'flex' }}>
          <div className="modal-content modal-content-large">
            <h3 className="modal-title">{editingId ? 'Редактировать водителя' : 'Добавить водителя'}</h3>
            <form className="supplier-form" onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">ФИО *</label>
                <input className="form-input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label className="form-label">Телефон</label>
                <input type="tel" className="form-input" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Номер ВУ</label>
                <input className="form-input" value={form.license_number} onChange={(e) => setForm((f) => ({ ...f, license_number: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Срок действия ВУ</label>
                <input type="date" className="form-input" value={form.license_expiry} onChange={(e) => setForm((f) => ({ ...f, license_expiry: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Telegram Chat ID</label>
                <input type="number" className="form-input" value={form.telegram_chat_id} onChange={(e) => setForm((f) => ({ ...f, telegram_chat_id: e.target.value }))} placeholder="Для рассылки маршрутов" />
              </div>
              <div className="form-group">
                <label className="form-label">Примечания</label>
                <textarea className="form-textarea" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="checkbox-label">
                  <input type="checkbox" checked={form.show_in_schedule} onChange={(e) => setForm((f) => ({ ...f, show_in_schedule: e.target.checked }))} />
                  Показывать в графике смен
                </label>
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
