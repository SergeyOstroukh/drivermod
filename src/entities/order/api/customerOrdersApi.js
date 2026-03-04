import { supabase } from '../../../shared/api/supabaseClient.js';

// Загрузка заказов customer_orders на конкретную дату (YYYY-MM-DD)
export async function fetchCustomerOrdersForDate(dateStr) {
  if (!supabase) {
    console.warn('[customerOrdersApi] Supabase client не инициализирован');
    return [];
  }
  const { data, error } = await supabase
    .from('customer_orders')
    .select('*')
    .eq('order_date', dateStr)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[customerOrdersApi] fetch error', error);
    throw error;
  }
  return data || [];
}

// Маппинг строки БД → UI‑модель заказа, совместимая с DistributionPage
export function mapDbOrderToUi(dbRow) {
  return {
    id: `db-${dbRow.id}`,
    dbId: dbRow.id,
    order1cId: dbRow.order_1c_id,
    status: dbRow.status,
    address: dbRow.delivery_address,
    phone: dbRow.phone || '',
    timeSlot: dbRow.time_slot || null, // если такое поле позже добавим
    items: dbRow.items || null,
    amount: dbRow.amount || null,
    geocoded: false,
    lat: null,
    lng: null,
    formattedAddress: null,
    error: null,
    driverIndex: -1,
  };
}

