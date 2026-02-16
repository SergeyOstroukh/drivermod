// Supabase Edge Function: telegram-webhook
// Handles Telegram callback_query when driver presses inline buttons
// Deploy: supabase functions deploy telegram-webhook --no-verify-jwt
// Set secrets:
//   supabase secrets set TELEGRAM_BOT_TOKEN=your_bot_token
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
//
// Then register webhook:
//   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<PROJECT_REF>.supabase.co/functions/v1/telegram-webhook"

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

serve(async (req) => {
  // Only accept POST
  if (req.method !== "POST") {
    return new Response("OK", { status: 200 });
  }

  try {
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) {
      console.error("TELEGRAM_BOT_TOKEN not set");
      return new Response("OK", { status: 200 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    const update = await req.json();

    // Handle callback_query (inline button press)
    if (update.callback_query) {
      const cb = update.callback_query;
      const cbData = cb.data || "";
      const parts = cbData.split(":");
      if (parts.length < 2) {
        return new Response("OK", { status: 200 });
      }

      const action = parts[0]; // 'accept' or 'reject'
      const orderId = parts.slice(1).join(":");
      const cbId = cb.id;
      const chatId = cb.message?.chat?.id;
      const messageId = cb.message?.message_id;
      const originalText = cb.message?.text || "";
      const driverName = cb.from?.first_name || cb.from?.username || "Водитель";

      // Determine new status
      const newStatus = action === "accept" ? "confirmed" : action === "reject" ? "rejected" : null;
      if (!newStatus) {
        return new Response("OK", { status: 200 });
      }

      // 1. Answer callback query immediately (driver sees popup)
      const answerText = action === "accept" ? "✅ Принято!" : "❌ Отклонено";
      await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callback_query_id: cbId,
          text: answerText,
          show_alert: false,
        }),
      });

      // 2. Edit message: remove buttons, add status text
      const statusEmoji = action === "accept" ? "✅" : "❌";
      const statusLabel = action === "accept" ? "Принято" : "Отклонено";
      const newText = originalText + "\n\n" + statusEmoji + " " + statusLabel + " — " + driverName;

      if (chatId && messageId) {
        await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: messageId,
            text: newText,
          }),
        });
      }

      // 3. Save confirmation to database
      // Try to update existing record first, insert if not found
      const { data: existing } = await supabase
        .from("telegram_confirmations")
        .select("id")
        .eq("order_id", orderId)
        .order("created_at", { ascending: false })
        .limit(1);

      if (existing && existing.length > 0) {
        await supabase
          .from("telegram_confirmations")
          .update({ status: newStatus, updated_at: new Date().toISOString() })
          .eq("id", existing[0].id);
      } else {
        await supabase.from("telegram_confirmations").insert({
          order_id: orderId,
          chat_id: chatId || 0,
          message_id: messageId || 0,
          driver_name: driverName,
          status: newStatus,
        });
      }

      console.log(`Callback processed: order=${orderId}, action=${action}, driver=${driverName}`);
    }

    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("Webhook error:", err);
    return new Response("OK", { status: 200 });
  }
});
