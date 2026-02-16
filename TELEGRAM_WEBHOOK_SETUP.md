# Настройка Telegram Webhook для подтверждений

## Что это даёт?
Когда водитель нажимает "Принял" или "Отклонил" в Telegram:
- Кнопки **мгновенно** исчезают из чата
- В сообщении появляется статус (✅ Принято / ❌ Отклонено)
- В веб-интерфейсе статус обновляется автоматически (опрос каждые 10 сек)

## Шаг 1: Создать таблицу в Supabase

Зайдите в [Supabase Dashboard](https://supabase.com/dashboard) → SQL Editor и выполните:

```sql
CREATE TABLE IF NOT EXISTS telegram_confirmations (
  id BIGSERIAL PRIMARY KEY,
  order_id TEXT NOT NULL,
  chat_id BIGINT NOT NULL,
  message_id BIGINT NOT NULL,
  driver_name TEXT,
  supplier_name TEXT,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'confirmed', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tg_conf_order_id ON telegram_confirmations (order_id);
CREATE INDEX IF NOT EXISTS idx_tg_conf_status ON telegram_confirmations (status);

ALTER TABLE telegram_confirmations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for anon" ON telegram_confirmations
  FOR ALL USING (true) WITH CHECK (true);
```

## Шаг 2: Деплой Edge Function

```bash
# Установите Supabase CLI если ещё нет
npm install -g supabase

# Залогиньтесь
supabase login

# Свяжите с проектом
supabase link --project-ref mrdicoctfaxdrmoluqpi

# Установите секреты
supabase secrets set TELEGRAM_BOT_TOKEN=8341968562:AAG322AITdXhlZCQ_8PKQRnshwD6hyB_-VI

# Деплой функции (--no-verify-jwt чтобы Telegram мог вызывать без авторизации)
supabase functions deploy telegram-webhook --no-verify-jwt
```

## Шаг 3: Зарегистрировать webhook в Telegram

Откройте в браузере (или выполните curl):

```
https://api.telegram.org/bot8341968562:AAG322AITdXhlZCQ_8PKQRnshwD6hyB_-VI/setWebhook?url=https://mrdicoctfaxdrmoluqpi.supabase.co/functions/v1/telegram-webhook
```

Должны получить ответ:
```json
{"ok":true,"result":true,"description":"Webhook was set"}
```

## Шаг 4: Проверить

```
https://api.telegram.org/bot8341968562:AAG322AITdXhlZCQ_8PKQRnshwD6hyB_-VI/getWebhookInfo
```

## Готово!

Теперь при нажатии кнопки водителем:
1. Telegram → Edge Function (мгновенно)
2. Edge Function → убирает кнопки + пишет статус в БД
3. Фронтенд → опрашивает БД каждые 10 сек → обновляет UI
