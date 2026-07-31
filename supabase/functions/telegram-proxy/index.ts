// Supabase Edge Function: telegram-proxy
// Proxies Telegram Bot API calls so the bot token stays in Supabase secrets (not in frontend/git).
// Deploy: supabase functions deploy telegram-proxy --no-verify-jwt
// Secret: TELEGRAM_BOT_TOKEN (already used by telegram-webhook / send-telegram)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_METHODS = new Set(["sendMessage", "editMessageText", "editMessageReplyMarkup"]);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) {
      return new Response(JSON.stringify({ ok: false, description: "TELEGRAM_BOT_TOKEN not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const method = body.method || "sendMessage";
    if (!ALLOWED_METHODS.has(method)) {
      return new Response(JSON.stringify({ ok: false, description: "Method not allowed" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { method: _m, ...payload } = body;
    const resp = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await resp.json();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, description: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
