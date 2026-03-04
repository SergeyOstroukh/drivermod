-- Таблица заказов из 1С для доставки клиентам
CREATE TABLE IF NOT EXISTS public.customer_orders (
    id BIGSERIAL PRIMARY KEY,
    order_1c_id TEXT NOT NULL,
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    customer_name TEXT,
    delivery_address TEXT NOT NULL,
    phone TEXT,
    items JSONB,
    amount NUMERIC(12,2),

    status TEXT NOT NULL DEFAULT 'new'
        CHECK (status IN ('new','assigned','sold','not_sold','refused','returned')),
    status_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    driver_id BIGINT REFERENCES public.drivers(id),
    route_id BIGINT REFERENCES public.driver_routes(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Уникальность номера сделки 1С (если нужно по дню – скорректируйте)
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_orders_1c_id
    ON public.customer_orders(order_1c_id);

CREATE INDEX IF NOT EXISTS idx_customer_orders_date
    ON public.customer_orders(order_date);

-- Автообновление updated_at
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
    FOR EACH ROW EXECUTE FUNCTION update_customer_orders_updated_at();

-- RLS + простая политика (как в других таблицах)
ALTER TABLE public.customer_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for anon on customer_orders"
    ON public.customer_orders
    FOR ALL USING (true) WITH CHECK (true);

