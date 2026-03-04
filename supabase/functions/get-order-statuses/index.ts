import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

const SUPABASE_URL = Deno.env.get("PROJECT_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date"); // YYYY-MM-DD
  const orderIdsParam = url.searchParams.get("order_ids"); // id1,id2,id3
  const sinceParam = url.searchParams.get("since"); // ISO8601

  let query = supabase
    .from("customer_orders")
    .select("order_1c_id, status, status_updated_at, driver_id, order_date");

  if (dateParam) {
    query = query.eq("order_date", dateParam);
  }
  if (orderIdsParam) {
    const ids = orderIdsParam.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length > 0) {
      query = query.in("order_1c_id", ids);
    }
  }
  if (sinceParam) {
    query = query.gte("status_updated_at", sinceParam);
  }

  const { data, error } = await query.order("status_updated_at", { ascending: false });

  if (error) {
    console.error("get-order-statuses error", error);
    return new Response(JSON.stringify({ error: "db_error" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  return new Response(
    JSON.stringify({ orders: data ?? [] }),
    { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
  );
});
