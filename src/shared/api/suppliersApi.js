import { supabase } from './supabaseClient.js';

export async function fetchSuppliers() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('suppliers')
    .select('*')
    .order('name', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createSupplier(row) {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.from('suppliers').insert([row]).select().single();
  if (error) throw error;
  return data;
}

export async function updateSupplier(id, row) {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.from('suppliers').update(row).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteSupplier(id) {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.from('suppliers').delete().eq('id', id);
  if (error) throw error;
}
