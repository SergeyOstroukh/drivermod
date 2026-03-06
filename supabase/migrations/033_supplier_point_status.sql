-- Статусы поставщиков по точкам: Telegram отправлен, товар отправлен.
-- Все сохраняется только в БД, без localStorage. Ключ по дате+водитель+точка.
CREATE TABLE IF NOT EXISTS public.supplier_point_status (
  id BIGSERIAL PRIMARY KEY,
  route_date DATE NOT NULL,
  driver_id BIGINT NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  point_key TEXT NOT NULL,
  address TEXT,
  lat NUMERIC(10, 6),
  lng NUMERIC(10, 6),
  telegram_sent BOOLEAN DEFAULT FALSE,
  telegram_status TEXT,
  telegram_chat_id BIGINT,
  telegram_message_id BIGINT,
  items_sent BOOLEAN DEFAULT FALSE,
  items_sent_text TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_point_status_key
  ON public.supplier_point_status(route_date, driver_id, point_key);
CREATE INDEX IF NOT EXISTS idx_supplier_point_status_date_driver
  ON public.supplier_point_status(route_date, driver_id);

ALTER TABLE public.supplier_point_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for supplier_point_status" ON public.supplier_point_status
  FOR ALL USING (true) WITH CHECK (true);
