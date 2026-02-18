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
 * This function tries multiple common formats. Adjust patterns to match
 * the actual format of messages from your 1C bot.
 *
 * Supported formats:
 *
 * Format 1 — "Поставщик: ООО ОМА\nТовар: Холодильник Samsung, 2 шт"
 * Format 2 — "ООО ОМА\nХолодильник Samsung, 2 шт\nМикроволновка LG, 1 шт"
 * Format 3 — "ООО ОМА — Холодильник Samsung, 2 шт"
 * Format 4 — "Заявка №123\nПоставщик: ООО ОМА\nТовар: ..."
 *
 * Returns { supplierName, items } or null if not recognized.
 */
function parseSupplierMessage(text: string): { supplierName: string; items: string } | null {
  // Format: explicit "Поставщик:" and "Товар:" labels
  const supplierMatch = text.match(/поставщик[:\s]+(.+)/i);
  const itemsMatch = text.match(/товар[ыи]?[:\s]+(.+)/is);

  if (supplierMatch && itemsMatch) {
    const supplierName = supplierMatch[1].trim().split("\n")[0].trim();
    const items = itemsMatch[1].trim();
    if (supplierName && items) {
      return { supplierName, items };
    }
  }

  // Format: "Заявка" with supplier on one line, items on next lines
  const orderMatch = text.match(/заявк[аи]\s*[№#]?\s*\d*/i);
  if (orderMatch) {
    const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
    let supplierName = "";
    const itemLines: string[] = [];

    for (const line of lines) {
      if (/^заявк/i.test(line)) continue;
      if (/^поставщик/i.test(line)) {
        supplierName = line.replace(/^поставщик[:\s]*/i, "").trim();
        continue;
      }
      if (/^товар/i.test(line)) {
        itemLines.push(line.replace(/^товар[ыи]?[:\s]*/i, "").trim());
        continue;
      }
      if (!supplierName) {
        supplierName = line;
      } else {
        itemLines.push(line);
      }
    }

    if (supplierName && itemLines.length > 0) {
      return { supplierName, items: itemLines.join("\n") };
    }
  }

  // Format: first line = supplier, rest = items (simple multiline)
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length >= 2) {
    const firstLine = lines[0];
    // Heuristic: first line looks like a company name (short, no quantities)
    if (firstLine.length < 80 && !/\d+\s*(шт|кг|л|уп)/i.test(firstLine)) {
      const supplierName = firstLine.replace(/^[\d.)\-\s]+/, "").trim();
      const items = lines.slice(1).join("\n");
      if (supplierName && items) {
        return { supplierName, items };
      }
    }
  }

  return null;
}
