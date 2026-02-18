-- Таблица для хранения заявок на забор товара (из 1С через Telegram)
CREATE TABLE IF NOT EXISTS supplier_orders (
  id BIGSERIAL PRIMARY KEY,
  supplier_name TEXT NOT NULL,
  items TEXT NOT NULL,
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  source_message_id BIGINT,
  source_chat_id BIGINT,
  raw_text TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Индекс для поиска по поставщику и дате
CREATE INDEX IF NOT EXISTS idx_supplier_orders_name_date
  ON supplier_orders (supplier_name, order_date);

CREATE INDEX IF NOT EXISTS idx_supplier_orders_date
  ON supplier_orders (order_date);

-- RLS: разрешаем чтение и запись
ALTER TABLE supplier_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for anon" ON supplier_orders
  FOR ALL USING (true) WITH CHECK (true);
