-- Блокировка повторной продажи по order_1c_id после доставки
ALTER TABLE public.customer_orders
  ADD COLUMN IF NOT EXISTS delivery_locked BOOLEAN NOT NULL DEFAULT FALSE;

-- Все уже доставленные заказы считаем закрытыми для повторного распределения
UPDATE public.customer_orders
SET delivery_locked = TRUE
WHERE status = 'delivered';

CREATE INDEX IF NOT EXISTS idx_customer_orders_delivery_locked
  ON public.customer_orders(delivery_locked);
