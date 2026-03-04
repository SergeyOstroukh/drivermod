import { useState, useEffect } from 'react';
import { supabase } from '../../../shared/api/supabaseClient.js';
import { fetchDrivers } from '../../../shared/api/driversApi.js';

export default function SchedulePage() {
  const [drivers, setDrivers] = useState([]);
  const [yearMonth, setYearMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [schedule, setSchedule] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const driversList = await fetchDrivers();
        const visible = (driversList || []).filter((d) => d.show_in_schedule !== false);
        if (cancelled) return;
        setDrivers(visible);
        if (visible.length === 0) {
          setSchedule({});
          return;
        }
        const [y, m] = yearMonth.split('-').map(Number);
        const start = `${yearMonth}-01`;
        const lastDay = new Date(y, m, 0).getDate();
        const end = `${yearMonth}-${String(lastDay).padStart(2, '0')}`;
        const { data, error } = await supabase
          .from('driver_schedule')
          .select('driver_id, schedule_date, status')
          .in('driver_id', visible.map((d) => d.id))
          .gte('schedule_date', start)
          .lte('schedule_date', end);
        if (cancelled) return;
        if (error) throw error;
        const byDriver = {};
        visible.forEach((d) => {
          byDriver[d.id] = {};
        });
        (data || []).forEach((row) => {
          if (byDriver[row.driver_id]) byDriver[row.driver_id][row.schedule_date] = row.status;
        });
        setSchedule(byDriver);
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [yearMonth]);

  const days = (() => {
    const [y, m] = yearMonth.split('-').map(Number);
    const n = new Date(y, m, 0).getDate();
    return Array.from({ length: n }, (_, i) => `${yearMonth}-${String(i + 1).padStart(2, '0')}`);
  })();

  const statusLabel = (s) => {
    const map = { work: 'P', off: 'В', sick: 'Б', extra: 'доп' };
    return map[s] || s || '—';
  };

  return (
    <section className="content-section active">
      <section className="section-header" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <h1 className="section-title">График смен</h1>
        <input
          type="month"
          className="form-input"
          value={yearMonth}
          onChange={(e) => setYearMonth(e.target.value)}
          style={{ width: 'auto' }}
        />
      </section>
      {loading ? (
        <p className="muted">Загрузка...</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="schedule-table" style={{ minWidth: 600, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ padding: 8, textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Водитель</th>
                {days.map((d) => (
                  <th key={d} style={{ padding: 4, fontSize: 11, borderBottom: '1px solid var(--border)' }}>{d.slice(8)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {drivers.map((dr) => (
                <tr key={dr.id}>
                  <td style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>{dr.name}</td>
                  {days.map((date) => (
                    <td key={date} style={{ padding: 4, fontSize: 12, borderBottom: '1px solid var(--border)' }}>
                      {statusLabel(schedule[dr.id]?.[date])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {drivers.length === 0 && !loading && (
        <p className="muted">Нет водителей в графике. Добавьте водителей и включите «Показывать в графике смен».</p>
      )}
    </section>
  );
}
