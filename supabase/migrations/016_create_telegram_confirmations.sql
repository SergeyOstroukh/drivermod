-- Таблица для хранения подтверждений водителей из Telegram
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

-- Индекс для быстрого поиска по order_id
CREATE INDEX IF NOT EXISTS idx_tg_conf_order_id ON telegram_confirmations (order_id);

-- Индекс для поиска непрочитанных
CREATE INDEX IF NOT EXISTS idx_tg_conf_status ON telegram_confirmations (status);

-- RLS: разрешаем чтение и запись через anon ключ
ALTER TABLE telegram_confirmations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for anon" ON telegram_confirmations
  FOR ALL USING (true) WITH CHECK (true);
