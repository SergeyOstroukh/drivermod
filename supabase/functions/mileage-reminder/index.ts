// Supabase Edge Function: mileage-reminder
// Ранее: cron в 22:00 напоминал водителям заполнить пробег.
// Сейчас отключено — сообщения о незаполненной смене не отправляются.
// Деплой: supabase functions deploy mileage-reminder --no-verify-jwt

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  return new Response(
    JSON.stringify({ ok: true, sent: 0, disabled: true, message: "Mileage reminders disabled" }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
