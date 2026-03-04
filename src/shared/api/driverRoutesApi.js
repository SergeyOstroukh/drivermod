import { supabase } from './supabaseClient.js';

/**
 * Сохраняет маршруты водителей (удаляет все за дату, вставляет новые).
 * @param {Array} routes — [{ driver_id, route_date, points: [{ address, lat, lng, phone, timeSlot, formattedAddress, orderNum, isSupplier?, isPartner? }] }]
 */
export async function saveDriverRoutes(routes) {
  if (!supabase) throw new Error('Supabase not configured');
  const routeDate = routes[0]?.route_date;
  if (!routeDate) throw new Error('Не указана дата маршрута');

  const { error: delError } = await supabase
    .from('driver_routes')
    .delete()
    .eq('route_date', routeDate);
  if (delError) throw delError;

  const { data, error } = await supabase
    .from('driver_routes')
    .insert(
      routes.map((r) => ({
        driver_id: r.driver_id,
        route_date: r.route_date,
        points: r.points,
        status: 'active',
      }))
    )
    .select('*');
  if (error) throw error;
  return data || [];
}

/**
 * Синхронизирует маршрут одного водителя: обновляет активный или создаёт.
 */
export async function syncDriverRoute(driverId, routeDate, points) {
  if (!supabase) throw new Error('Supabase not configured');
  const { data: existing, error: findErr } = await supabase
    .from('driver_routes')
    .select('id')
    .eq('driver_id', driverId)
    .eq('route_date', routeDate)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (findErr) throw findErr;

  if (existing) {
    const { data, error } = await supabase
      .from('driver_routes')
      .update({ points })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from('driver_routes')
    .insert({
      driver_id: driverId,
      route_date: routeDate,
      points,
      status: 'active',
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/**
 * Удаляет активный маршрут водителя за дату (когда точек не осталось).
 */
export async function clearActiveRoute(driverId, routeDate) {
  if (!supabase) throw new Error('Supabase not configured');
  const { data: existing, error: findErr } = await supabase
    .from('driver_routes')
    .select('id')
    .eq('driver_id', driverId)
    .eq('route_date', routeDate)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (findErr) throw findErr;
  if (existing) {
    const { error } = await supabase.from('driver_routes').delete().eq('id', existing.id);
    if (error) throw error;
  }
}
