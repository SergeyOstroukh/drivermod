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
