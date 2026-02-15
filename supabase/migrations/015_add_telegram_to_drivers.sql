-- Добавление поля telegram_chat_id для рассылки маршрутов через Telegram
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT;
