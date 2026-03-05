import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

// Supabase подставляет их автоматически; при необходимости можно переопределить через Secrets
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL или SUPABASE_SERVICE_ROLE_KEY не заданы в переменных окружения");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  const today = new Date().toISOString().slice(0, 10);

  type OrderInput = {
    order_1c_id?: string;
    order_date?: string;
    customer_name?: string;
    delivery_address?: string;
    phone?: string;
    items?: unknown;
    amount?: number;
    [key: string]: unknown;
  };

  function toRow(payload: OrderInput): Record<string, unknown> | null {
    if (!payload.order_1c_id || !payload.delivery_address) return null;
    return {
      order_1c_id: String(payload.order_1c_id),
      order_date: payload.order_date || today,
      customer_name: payload.customer_name ?? null,
      delivery_address: String(payload.delivery_address),
      phone: payload.phone ?? null,
      items: payload.items ?? null,
      amount: payload.amount ?? null,
      status: "new",
    };
  }

  const raw = body as { orders?: OrderInput[] } & OrderInput;
  let rows: Record<string, unknown>[];

  if (Array.isArray(raw.orders)) {
    rows = raw.orders.map(toRow).filter((r): r is Record<string, unknown> => r !== null);
    if (rows.length === 0) {
      return new Response(
        JSON.stringify({
          error: "missing_fields",
          message: "В массиве orders нет ни одного заказа с order_1c_id и delivery_address",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }
  } else {
    const row = toRow(raw);
    if (!row) {
      return new Response(JSON.stringify({ error: "missing_fields" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }
    rows = [row];
  }

  const { error } = await supabase.from("customer_orders").upsert(rows, { onConflict: "order_1c_id" });

  if (error) {
    console.error("upsert customer_orders error", error);
    return new Response(JSON.stringify({ error: "db_error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  return new Response(
    JSON.stringify(rows.length === 1 ? { ok: true } : { ok: true, accepted: rows.length }),
    { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
  );
});
