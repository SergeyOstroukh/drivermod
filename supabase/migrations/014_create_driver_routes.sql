-- Таблица маршрутов водителей (публикуемых логистом)
CREATE TABLE IF NOT EXISTS public.driver_routes (
    id BIGSERIAL PRIMARY KEY,
    driver_id BIGINT NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
    route_date DATE NOT NULL DEFAULT CURRENT_DATE,
    points JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_driver_routes_driver_id ON public.driver_routes(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_routes_date ON public.driver_routes(route_date);
CREATE INDEX IF NOT EXISTS idx_driver_routes_status ON public.driver_routes(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_routes_driver_date ON public.driver_routes(driver_id, route_date);

-- Автообновление updated_at
CREATE OR REPLACE FUNCTION update_driver_routes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_driver_routes_updated_at ON public.driver_routes;
CREATE TRIGGER trigger_driver_routes_updated_at
    BEFORE UPDATE ON public.driver_routes
    FOR EACH ROW
    EXECUTE FUNCTION update_driver_routes_updated_at();

-- RLS
ALTER TABLE public.driver_routes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to driver_routes" ON public.driver_routes
    FOR ALL USING (true) WITH CHECK (true);
