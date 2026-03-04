import { supabase } from './supabaseClient.js';

export async function fetchDrivers() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('drivers')
    .select('*')
    .order('name', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createDriver(row) {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.from('drivers').insert([row]).select().single();
  if (error) throw error;
  return data;
}

export async function updateDriver(id, row) {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.from('drivers').update(row).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteDriver(id) {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.from('drivers').delete().eq('id', id);
  if (error) throw error;
}
