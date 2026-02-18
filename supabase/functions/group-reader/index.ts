// Supabase Edge Function: group-reader
// Webhook for a separate Telegram bot that reads 1C messages from a group.
// Parses supplier name + items from messages and saves to supplier_orders table.
//
// Deploy: supabase functions deploy group-reader --no-verify-jwt
// Set secrets:
//   supabase secrets set GROUP_BOT_TOKEN=<your_group_bot_token>
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<your_service_role_key>
//
// Register webhook:
//   curl "https://api.telegram.org/bot<GROUP_BOT_TOKEN>/setWebhook?url=https://<PROJECT_REF>.supabase.co/functions/v1/group-reader"

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("OK", { status: 200 });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    const update = await req.json();

    // We only care about regular messages (not callbacks, not edits)
    const message = update.message;
    if (!message || !message.text) {
      return new Response("OK", { status: 200 });
    }

    const text = message.text.trim();
    const chatId = message.chat?.id;
    const messageId = message.message_id;

    // Parse the message: try to extract supplier name and items
    const parsed = parseSupplierMessage(text);

    if (!parsed) {
      console.log("Message not recognized as supplier order:", text.substring(0, 100));
      return new Response("OK", { status: 200 });
    }

    // Save to database
    const today = new Date().toISOString().split("T")[0];

    const { error } = await supabase.from("supplier_orders").insert({
      supplier_name: parsed.supplierName,
      items: parsed.items,
      order_date: today,
      source_message_id: messageId,
      source_chat_id: chatId,
      raw_text: text,
    });

    if (error) {
      console.error("DB insert error:", error);
    } else {
      console.log(`Saved order: ${parsed.supplierName} — ${parsed.items.substring(0, 50)}...`);
    }

    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("Webhook error:", err);
    return new Response("OK", { status: 200 });
  }
});

/**
 * Parse a message from the 1C bot.
 *
 * Real format from 1C:
 *   ООО "Термостудия"
 *   7724115505 Радиатор VK-Profil 22/500/500 1 шт
 *
 * First line = supplier name (often with org form: ООО, ОАО, ЗАО, ИП, etc.)
 * Remaining lines = items to pick up.
 *
 * If Telegram includes the header "Информация из 1С, [...]" in the text,
 * it is stripped automatically.
 */
function parseSupplierMessage(text: string): { supplierName: string; items: string } | null {
  let lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

  // Strip "Информация из 1С" header if present
  if (lines.length > 0 && /^информация\s+из\s+1с/i.test(lines[0])) {
    lines = lines.slice(1);
  }

  if (lines.length < 2) return null;

  const firstLine = lines[0];

  // Check if first line looks like a company name:
  // - contains org form (ООО, ОАО, ЗАО, ИП, Общество, etc.)
  // - or is short and doesn't contain quantities
  const orgFormPattern = /^(ООО|ОАО|ЗАО|ПАО|АО|ИП|Общество|ФГУП|МУП|ЧУП)/i;
  const looksLikeCompany = orgFormPattern.test(firstLine)
    || (firstLine.length < 80 && !/\d+\s*(шт|кг|л|уп|м\b|мм|см)/i.test(firstLine));

  if (!looksLikeCompany) return null;

  const supplierName = firstLine;
  const items = lines.slice(1).join("\n");

  if (!supplierName || !items) return null;

  return { supplierName, items };
}
