-- Статус синхронизации customer_orders -> 1C
ALTER TABLE public.customer_orders
  ADD COLUMN IF NOT EXISTS sync_1c_state TEXT
    CHECK (sync_1c_state IN ('pending', 'ok', 'error'));

ALTER TABLE public.customer_orders
  ADD COLUMN IF NOT EXISTS sync_1c_last_error TEXT;

ALTER TABLE public.customer_orders
  ADD COLUMN IF NOT EXISTS sync_1c_retry_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.customer_orders
  ADD COLUMN IF NOT EXISTS sync_1c_updated_at TIMESTAMPTZ;

ALTER TABLE public.customer_orders
  ADD COLUMN IF NOT EXISTS sync_1c_status_sent TEXT;

CREATE INDEX IF NOT EXISTS idx_customer_orders_sync_1c_state
  ON public.customer_orders(sync_1c_state);
