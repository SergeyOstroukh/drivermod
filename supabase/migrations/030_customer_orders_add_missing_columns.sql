-- Добавить недостающие колонки в customer_orders (если таблица была создана раньше без них)
ALTER TABLE public.customer_orders ADD COLUMN IF NOT EXISTS delivery_time_slot TEXT;
ALTER TABLE public.customer_orders ADD COLUMN IF NOT EXISTS assigned_driver_id BIGINT REFERENCES public.drivers(id) ON DELETE SET NULL;
ALTER TABLE public.customer_orders ADD COLUMN IF NOT EXISTS driver_route_id BIGINT REFERENCES public.driver_routes(id) ON DELETE SET NULL;
ALTER TABLE public.customer_orders ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.customer_orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
