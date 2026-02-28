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

// День недели 1=Пн .. 7=Вс (как в work_days)
function getDayOfWeek(dateStr: string): number {
  const d = new Date(dateStr + "T12:00:00Z");
  const day = d.getUTCDay(); // 0=Sun, 1=Mon, ...
  return day === 0 ? 7 : day;
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
    const dayNum = getDayOfWeek(today);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Водители: у кого сегодня рабочий день (work_days пусто = все дни, иначе строка содержит dayNum)
    const { data: drivers, error: driversErr } = await supabase
      .from("drivers")
      .select("id, name, telegram_chat_id, work_days")
      .not("telegram_chat_id", "is", null);

    if (driversErr) {
      console.error("drivers error", driversErr);
      return new Response(JSON.stringify({ error: driversErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const workingToday = (drivers || []).filter((d) => {
      const wd = (d.work_days || "").toString().trim();
      if (!wd) return true;
      const days = wd.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => n >= 1 && n <= 7);
      return days.includes(dayNum);
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
      JSON.stringify({ ok: true, date: today, dayOfWeek: dayNum, sent, driversChecked: workingToday.length }),
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
