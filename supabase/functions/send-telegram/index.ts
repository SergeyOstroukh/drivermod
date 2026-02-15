// Supabase Edge Function: send-telegram
// Sends route/supplier messages to drivers via Telegram Bot API
// Deploy: supabase functions deploy send-telegram
// Set secret: supabase secrets set TELEGRAM_BOT_TOKEN=your_bot_token

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RoutePoint {
  address: string;
  formattedAddress?: string;
  phone?: string;
  timeSlot?: string;
  orderNum: number;
  isSupplier?: boolean;
  supplierName?: string;
  isKbt?: boolean;
  isKbtHelper?: boolean;
  helperDriverName?: string;
  mainDriverName?: string;
}

interface SendRequest {
  messages: {
    chat_id: number;
    driver_name: string;
    route_date: string;
    points: RoutePoint[];
  }[];
}

function formatMessage(driverName: string, routeDate: string, points: RoutePoint[]): string {
  const dateFormatted = new Date(routeDate + "T00:00:00").toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    weekday: "short",
  });

  let msg = `📋 *Маршрут на ${dateFormatted}*\n`;
  msg += `👤 ${driverName}\n`;
  msg += `📍 Точек: ${points.length}\n`;
  msg += `─────────────────\n\n`;

  // Separate suppliers and addresses
  const suppliers = points.filter((p) => p.isSupplier);
  const addresses = points.filter((p) => !p.isSupplier);

  if (suppliers.length > 0) {
    msg += `🏢 *Поставщики (${suppliers.length}):*\n`;
    suppliers.forEach((p, i) => {
      msg += `${i + 1}. *${escapeMarkdown(p.address)}*`;
      if (p.timeSlot) msg += ` ⏰ ${p.timeSlot}`;
      if (p.formattedAddress) msg += `\n   📍 ${escapeMarkdown(p.formattedAddress)}`;
      if (p.phone) msg += `\n   📞 ${p.phone}`;
      if (p.isKbt) msg += `\n   📦 КБТ`;
      if (p.isKbtHelper) msg += `\n   🤝 помощник для ${escapeMarkdown(p.mainDriverName || "?")}`;
      msg += `\n`;
    });
    msg += `\n`;
  }

  if (addresses.length > 0) {
    msg += `🏠 *Адреса (${addresses.length}):*\n`;
    addresses.forEach((p, i) => {
      msg += `${i + 1}. *${escapeMarkdown(p.address)}*`;
      if (p.timeSlot) msg += ` ⏰ ${p.timeSlot}`;
      if (p.formattedAddress && p.formattedAddress !== p.address) {
        msg += `\n   📍 ${escapeMarkdown(p.formattedAddress)}`;
      }
      if (p.phone) msg += `\n   📞 ${p.phone}`;
      if (p.isKbt) msg += `\n   📦 КБТ`;
      if (p.isKbtHelper) msg += `\n   🤝 помощник для ${escapeMarkdown(p.mainDriverName || "?")}`;
      msg += `\n`;
    });
  }

  msg += `\n✅ Хорошего дня!`;
  return msg;
}

function escapeMarkdown(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, "\\$1");
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) {
      return new Response(
        JSON.stringify({ error: "TELEGRAM_BOT_TOKEN not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { messages } = (await req.json()) as SendRequest;
    if (!messages || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "No messages to send" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const results: { driver_name: string; chat_id: number; ok: boolean; error?: string }[] = [];

    for (const msg of messages) {
      if (!msg.chat_id) {
        results.push({ driver_name: msg.driver_name, chat_id: 0, ok: false, error: "No chat_id" });
        continue;
      }

      const text = formatMessage(msg.driver_name, msg.route_date, msg.points);

      try {
        const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: msg.chat_id,
            text: text,
            parse_mode: "MarkdownV2",
          }),
        });

        const data = await resp.json();
        if (data.ok) {
          results.push({ driver_name: msg.driver_name, chat_id: msg.chat_id, ok: true });
        } else {
          // Retry without markdown if parse error
          if (data.description?.includes("parse")) {
            const plainText = text.replace(/[\\*_`\[\]]/g, "");
            const retryResp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chat_id: msg.chat_id, text: plainText }),
            });
            const retryData = await retryResp.json();
            results.push({
              driver_name: msg.driver_name,
              chat_id: msg.chat_id,
              ok: retryData.ok,
              error: retryData.ok ? undefined : retryData.description,
            });
          } else {
            results.push({ driver_name: msg.driver_name, chat_id: msg.chat_id, ok: false, error: data.description });
          }
        }
      } catch (e) {
        results.push({ driver_name: msg.driver_name, chat_id: msg.chat_id, ok: false, error: String(e) });
      }
    }

    const sent = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;

    return new Response(
      JSON.stringify({ sent, failed, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
