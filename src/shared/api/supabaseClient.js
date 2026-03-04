import { createClient } from '@supabase/supabase-js';

const url =
  import.meta.env.VITE_SUPABASE_URL ||
  (typeof window !== 'undefined' && window.SUPABASE_CONFIG
    ? window.SUPABASE_CONFIG.url
    : null);
const anonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  (typeof window !== 'undefined' && window.SUPABASE_CONFIG
    ? window.SUPABASE_CONFIG.anonKey
    : null);

if (!url || !anonKey) {
  // Для дев‑окружения можно оставить без выброса ошибки,
  // но в проде лучше настроить переменные окружения.
  console.warn(
    '[supabaseClient] Не заданы VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY и нет window.SUPABASE_CONFIG',
  );
}

export const supabase =
  url && anonKey ? createClient(url, anonKey) : null;

