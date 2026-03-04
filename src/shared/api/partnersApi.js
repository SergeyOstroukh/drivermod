import { supabase } from './supabaseClient.js';

export async function fetchPartners() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('partners')
    .select('*')
    .order('name', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createPartner(row) {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.from('partners').insert([row]).select().single();
  if (error) throw error;
  return data;
}

export async function updatePartner(id, row) {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.from('partners').update(row).eq('id', id).select().single();
  if (error) throw error;
  return data;
}

export async function deletePartner(id) {
  if (!supabase) throw new Error('Supabase not configured');
  const { error } = await supabase.from('partners').delete().eq('id', id);
  if (error) throw error;
}
