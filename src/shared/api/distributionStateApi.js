import { supabase } from './supabaseClient.js';

const TABLE = 'distribution_state';

/**
 * Загрузить состояние распределения из Supabase на дату (YYYY-MM-DD).
 * @param {string} stateDate - дата маршрута
 * @returns {Promise<{ orders, assignments, driverCount, driverSlots, activeVariant, poiCoords } | null>}
 */
export async function loadDistributionState(stateDate) {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('state_json')
      .eq('state_date', stateDate)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn('[distributionStateApi] load error', error);
      return null;
    }
    const d = data?.state_json;
    if (!d || !Array.isArray(d.orders)) return null;
    return {
      orders: d.orders,
      assignments: d.assignments ?? null,
      driverCount: Math.max(1, Math.min(12, Number(d.driverCount) || 3)),
      driverSlots: Array.isArray(d.driverSlots) ? d.driverSlots : [],
      activeVariant: typeof d.activeVariant === 'number' ? d.activeVariant : -1,
      poiCoords: d.poiCoords && typeof d.poiCoords === 'object' ? d.poiCoords : {},
    };
  } catch (e) {
    console.warn('[distributionStateApi] load exception', e);
    return null;
  }
}

/**
 * Сохранить состояние распределения в Supabase на дату.
 * @param {string} stateDate - дата маршрута (YYYY-MM-DD)
 * @param {object} snapshot - { orders, assignments, driverCount, driverSlots, activeVariant, poiCoords, schemaVersion? }
 */
export async function saveDistributionState(stateDate, snapshot) {
  if (!supabase) return;
  try {
    const payload = {
      state_date: stateDate,
      state_json: {
        orders: snapshot.orders ?? [],
        assignments: snapshot.assignments ?? null,
        driverCount: snapshot.driverCount ?? 3,
        driverSlots: snapshot.driverSlots ?? [],
        activeVariant: snapshot.activeVariant ?? -1,
        poiCoords: snapshot.poiCoords ?? {},
        schemaVersion: snapshot.schemaVersion ?? 1,
        updatedAt: Date.now(),
      },
    };
    const { error } = await supabase
      .from(TABLE)
      .upsert(payload, { onConflict: 'state_date' });

    if (error) console.warn('[distributionStateApi] save error', error);
  } catch (e) {
    console.warn('[distributionStateApi] save exception', e);
  }
}
