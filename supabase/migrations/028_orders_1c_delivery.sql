-- Заказы на доставку из 1С (клиентские заказы, день в день)
-- 1С передаёт заказы сюда; мы распределяем по водителям и отдаём статусы обратно в 1С по order_id_1c

CREATE TABLE IF NOT EXISTS public.orders_1c (
    id BIGSERIAL PRIMARY KEY,
    order_id_1c TEXT NOT NULL,
    delivery_date DATE NOT NULL DEFAULT CURRENT_DATE,
    delivery_time_slot TEXT,
    items TEXT,
    total_price NUMERIC(12, 2),
    address TEXT NOT NULL,
    client_phone TEXT,
    status TEXT NOT NULL DEFAULT 'new'
        CHECK (status IN ('new', 'assigned', 'in_delivery', 'delivered', 'cancelled')),
    assigned_driver_id BIGINT REFERENCES public.drivers(id) ON DELETE SET NULL,
    driver_route_id BIGINT REFERENCES public.driver_routes(id) ON DELETE SET NULL,
    raw_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_1c_order_id_1c
    ON public.orders_1c(order_id_1c);

CREATE INDEX IF NOT EXISTS idx_orders_1c_delivery_date
    ON public.orders_1c(delivery_date);

CREATE INDEX IF NOT EXISTS idx_orders_1c_status
    ON public.orders_1c(status);

CREATE INDEX IF NOT EXISTS idx_orders_1c_assigned_driver
    ON public.orders_1c(assigned_driver_id);

CREATE INDEX IF NOT EXISTS idx_orders_1c_route
    ON public.orders_1c(driver_route_id);

CREATE OR REPLACE FUNCTION update_orders_1c_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_orders_1c_updated_at ON public.orders_1c;
CREATE TRIGGER trigger_orders_1c_updated_at
    BEFORE UPDATE ON public.orders_1c
    FOR EACH ROW
    EXECUTE FUNCTION update_orders_1c_updated_at();

ALTER TABLE public.orders_1c ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to orders_1c" ON public.orders_1c
    FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE public.orders_1c IS 'Заказы на доставку из 1С: приём от 1С, распределение по водителям, статусы обратно в 1С по order_id_1c';
COMMENT ON COLUMN public.orders_1c.order_id_1c IS 'Уникальный идентификатор заказа в 1С';
COMMENT ON COLUMN public.orders_1c.status IS 'new=новый, assigned=распределен, in_delivery=в доставке, delivered=доставлен, cancelled=отменен';
