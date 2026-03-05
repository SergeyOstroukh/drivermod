-- Добавить статус 'on_map' (На карте) для заказов, перенесённых на карту до отправки в путевой лист
ALTER TABLE public.customer_orders DROP CONSTRAINT IF EXISTS customer_orders_status_check;
ALTER TABLE public.customer_orders ADD CONSTRAINT customer_orders_status_check
  CHECK (status IN ('new', 'on_map', 'assigned', 'in_delivery', 'delivered', 'cancelled'));
