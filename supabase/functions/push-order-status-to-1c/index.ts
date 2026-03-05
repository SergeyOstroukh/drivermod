// Отправка статуса заказа в 1С по order_1c_id
// Вызывается из кабинета водителя при смене статуса. POST body: { order_1c_id, status }
// В Supabase Secrets задать: ONE_C_WEBHOOK_URL=https://your-1c-server/ws/order-status

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const ONE_C_WEBHOOK_URL = Deno.env.get("ONE_C_WEBHOOK_URL") || "";

serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
  };
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Use POST" }), {
      status: 405,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  let body: { order_1c_id?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  const order_1c_id = body.order_1c_id;
  const status = body.status;
  if (!order_1c_id || !status) {
    return new Response(JSON.stringify({ error: "order_1c_id and status required" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  if (!ONE_C_WEBHOOK_URL) {
    return new Response(
      JSON.stringify({ ok: true, sent: false, message: "ONE_C_WEBHOOK_URL not set" }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  try {
    const res = await fetch(ONE_C_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order_1c_id, status }),
    });
    const ok = res.ok;
    return new Response(
      JSON.stringify({ ok: true, sent: true, httpStatus: res.status }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (e) {
    console.error("push to 1C error", e);
    return new Response(
      JSON.stringify({ ok: false, error: String(e) }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
