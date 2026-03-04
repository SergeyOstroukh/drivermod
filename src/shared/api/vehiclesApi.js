import { supabase } from './supabaseClient.js';

export async function fetchVehicles() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('vehicles')
    .select('*')
    .order('plate_number', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createVehicle(row) {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.from('vehicles').insert([row]).select().single();
  if (error) throw error;
  return data;
}

export async function updateVehicle(id, row) {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.from('vehicles').update(row).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteVehicle(id) {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.from('vehicles').delete().eq('id', id);
  if (error) throw error;
}

// ——— Лог пробега (путевые листы) ———

export async function getMileageFilledVehicleIdsForDate(dateStr) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('vehicle_mileage_log')
    .select('vehicle_id')
    .eq('log_date', dateStr);
  if (error) {
    console.error('getMileageFilledVehicleIdsForDate', error);
    return [];
  }
  return [...new Set((data || []).map((r) => r.vehicle_id))];
}

export async function getMileageLog(vehicleId, startDate = null, endDate = null) {
  if (!supabase) return [];
  let query = supabase
    .from('vehicle_mileage_log')
    .select('*, drivers(id, name, phone)')
    .eq('vehicle_id', vehicleId)
    .order('log_date', { ascending: false });
  if (startDate) query = query.gte('log_date', startDate);
  if (endDate) query = query.lte('log_date', endDate);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((item) => ({
    ...item,
    driver: Array.isArray(item.drivers) ? item.drivers[0] : item.drivers || null,
  }));
}

export async function addMileageLog(entry) {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase
    .from('vehicle_mileage_log')
    .insert([entry])
    .select('*, drivers(id, name, phone)')
    .single();
  if (error) throw error;
  const row = data;
  return {
    ...row,
    driver: Array.isArray(row.drivers) ? row.drivers[0] : row.drivers || null,
  };
}

export async function updateMileageLog(id, patch) {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase
    .from('vehicle_mileage_log')
    .update(patch)
    .eq('id', id)
    .select('*, drivers(id, name, phone)')
    .single();
  if (error) throw error;
  const row = data;
  return {
    ...row,
    driver: Array.isArray(row.drivers) ? row.drivers[0] : row.drivers || null,
  };
}

export async function deleteMileageLog(id) {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.from('vehicle_mileage_log').delete().eq('id', id);
  if (error) throw error;
}
