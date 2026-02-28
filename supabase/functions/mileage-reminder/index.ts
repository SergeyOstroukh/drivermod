// Supabase Edge Function: mileage-reminder
// Вызывается по расписанию в 22:00. Проверяет, заполнен ли пробег за смену у водителей с графиком на сегодня.
// Если нет — отправляет напоминание в Telegram.
// Деплой: supabase functions deploy mileage-reminder --no-verify-jwt
// Секреты: TELEGRAM_BOT_TOKEN, SUPABASE_SERVICE_ROLE_KEY (или SUPABASE_ANON_KEY)
// Cron: вызывать GET/POST https://<PROJECT_REF>.supabase.co/functions/v1/mileage-reminder каждый день в 22:00 (например cron-job.org).
// Опционально: ?date=YYYY-MM-DD (если не передано — используется текущая дата UTC).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// По схеме 5x2, 3x3, 2x2 — рабочий ли день (year, month, day)
function worksByScheme(scheme: string, year: number, month: number, day: number): boolean {
  const d = new Date(year, month - 1, day);
  const dayOfWeek = d.getDay();
  if (scheme === "5x2") return dayOfWeek >= 1 && dayOfWeek <= 5;
  if (scheme === "3x3") return (day - 1) % 6 < 3;
  if (scheme === "2x2") return (day - 1) % 4 < 2;
  return true;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) {
      console.error("TELEGRAM_BOT_TOKEN not set");
      return new Response(JSON.stringify({ error: "TELEGRAM_BOT_TOKEN not set" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const dateParam = url.searchParams.get("date");
    const today = dateParam || new Date().toISOString().slice(0, 10);
    const [y, m, day] = today.split("-").map(Number);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: drivers, error: driversErr } = await supabase
      .from("drivers")
      .select("id, name, telegram_chat_id, schedule_scheme")
      .not("telegram_chat_id", "is", null);

    if (driversErr) {
      console.error("drivers error", driversErr);
      return new Response(JSON.stringify({ error: driversErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const driverIds = (drivers || []).map((d) => d.id);
    const { data: overrides } = await supabase
      .from("driver_schedule")
      .select("driver_id, status")
      .eq("schedule_date", today)
      .in("driver_id", driverIds);
    const overrideMap = new Map<number, string>();
    (overrides || []).forEach((r: { driver_id: number; status: string }) => overrideMap.set(r.driver_id, r.status));

    const workingToday = (drivers || []).filter((d) => {
      const override = overrideMap.get(d.id);
      if (override) return override === "work";
      return worksByScheme(d.schedule_scheme || "5x2", y, m, day);
    });

    if (workingToday.length === 0) {
      return new Response(JSON.stringify({ ok: true, message: "No drivers working today", sent: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Автомобили, закреплённые за этими водителями
    const driverIds = workingToday.map((d) => d.id);
    const { data: vehicles, error: vehiclesErr } = await supabase
      .from("vehicles")
      .select("id, plate_number, driver_id")
      .in("driver_id", driverIds);

    if (vehiclesErr) {
      console.error("vehicles error", vehiclesErr);
      return new Response(JSON.stringify({ error: vehiclesErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const vehiclesByDriver = new Map<number, { id: number; plate_number: string }[]>();
    for (const v of vehicles || []) {
      const did = v.driver_id;
      if (!did) continue;
      if (!vehiclesByDriver.has(did)) vehiclesByDriver.set(did, []);
      vehiclesByDriver.get(did)!.push({ id: v.id, plate_number: v.plate_number || "—" });
    }

    // Записи пробега за сегодня по vehicle_id
    const vehicleIds = (vehicles || []).map((v) => v.id);
    let filledVehicleIds = new Set<number>();
    if (vehicleIds.length > 0) {
      const { data: logs } = await supabase
        .from("vehicle_mileage_log")
        .select("vehicle_id")
        .eq("log_date", today)
        .in("vehicle_id", vehicleIds);
      filledVehicleIds = new Set((logs || []).map((r) => r.vehicle_id));
    }

    let sent = 0;
    for (const driver of workingToday) {
      const driverVehicles = vehiclesByDriver.get(driver.id) || [];
      const notFilled = driverVehicles.filter((v) => !filledVehicleIds.has(v.id));
      if (notFilled.length === 0) continue;

      const chatId = driver.telegram_chat_id;
      if (!chatId || chatId < 0) continue;

      const plates = notFilled.map((v) => v.plate_number).join(", ");
      const text = `⚠️ Напоминание: пожалуйста, заполните пробег за смену до конца дня.\n\nДата: ${today}\nАвтомобиль(и): ${plates}\n\nСпасибо!`;

      const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
        }),
      });
      const data = await resp.json();
      if (data.ok) sent++;
      else console.warn("Telegram send failed for driver", driver.id, data);
    }

    return new Response(
      JSON.stringify({ ok: true, date: today, sent, driversChecked: workingToday.length }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("mileage-reminder error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
