-- Заказы на доставку из 1С (таблица customer_orders — приём из Edge Function, распределение по водителям)
-- Уникальный ключ для 1С: order_1c_id

CREATE TABLE IF NOT EXISTS public.customer_orders (
    id BIGSERIAL PRIMARY KEY,
    order_1c_id TEXT NOT NULL,
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    customer_name TEXT,
    delivery_address TEXT NOT NULL,
    phone TEXT,
    items JSONB,
    amount NUMERIC(12, 2),
    status TEXT NOT NULL DEFAULT 'new'
        CHECK (status IN ('new', 'assigned', 'in_delivery', 'delivered', 'cancelled')),
    delivery_time_slot TEXT,
    assigned_driver_id BIGINT REFERENCES public.drivers(id) ON DELETE SET NULL,
    driver_route_id BIGINT REFERENCES public.driver_routes(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_orders_order_1c_id
    ON public.customer_orders(order_1c_id);

CREATE INDEX IF NOT EXISTS idx_customer_orders_order_date
    ON public.customer_orders(order_date);

CREATE INDEX IF NOT EXISTS idx_customer_orders_status
    ON public.customer_orders(status);

CREATE INDEX IF NOT EXISTS idx_customer_orders_assigned_driver
    ON public.customer_orders(assigned_driver_id);

-- Колонки для распределения (если таблица уже была создана раньше без них)
ALTER TABLE public.customer_orders ADD COLUMN IF NOT EXISTS delivery_time_slot TEXT;
ALTER TABLE public.customer_orders ADD COLUMN IF NOT EXISTS assigned_driver_id BIGINT REFERENCES public.drivers(id) ON DELETE SET NULL;
ALTER TABLE public.customer_orders ADD COLUMN IF NOT EXISTS driver_route_id BIGINT REFERENCES public.driver_routes(id) ON DELETE SET NULL;
ALTER TABLE public.customer_orders ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.customer_orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE OR REPLACE FUNCTION update_customer_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_customer_orders_updated_at ON public.customer_orders;
CREATE TRIGGER trigger_customer_orders_updated_at
    BEFORE UPDATE ON public.customer_orders
    FOR EACH ROW
    EXECUTE FUNCTION update_customer_orders_updated_at();

ALTER TABLE public.customer_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access to customer_orders" ON public.customer_orders;
CREATE POLICY "Allow all access to customer_orders" ON public.customer_orders
    FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE public.customer_orders IS 'Заказы из 1С: приём через Edge Function, распределение по водителям, статусы обратно в 1С по order_1c_id';
