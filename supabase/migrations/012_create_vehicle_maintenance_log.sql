-- Создание таблицы журнала ТО автомобилей
CREATE TABLE IF NOT EXISTS public.vehicle_maintenance_log (
    id BIGSERIAL PRIMARY KEY,
    vehicle_id BIGINT NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
    mileage INTEGER NOT NULL,           -- пробег на момент ТО
    service_date DATE NOT NULL DEFAULT CURRENT_DATE,
    work_types TEXT NOT NULL,            -- виды работ
    parts_replaced TEXT,                 -- замененные запчасти
    total_cost NUMERIC(12, 2),           -- общая сумма (работа + запчасти)
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Создание индексов
CREATE INDEX IF NOT EXISTS idx_maintenance_log_vehicle ON public.vehicle_maintenance_log(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_log_date ON public.vehicle_maintenance_log(service_date);
CREATE INDEX IF NOT EXISTS idx_maintenance_log_mileage ON public.vehicle_maintenance_log(mileage);

-- Функция для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_maintenance_log_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Триггер для автоматического обновления updated_at
DROP TRIGGER IF EXISTS update_maintenance_log_updated_at ON public.vehicle_maintenance_log;
CREATE TRIGGER update_maintenance_log_updated_at BEFORE UPDATE ON public.vehicle_maintenance_log
    FOR EACH ROW EXECUTE FUNCTION update_maintenance_log_updated_at();

-- Включение Row Level Security (RLS)
ALTER TABLE public.vehicle_maintenance_log ENABLE ROW LEVEL SECURITY;

-- Политики для анонимного доступа
DROP POLICY IF EXISTS "Allow anonymous read access" ON public.vehicle_maintenance_log;
DROP POLICY IF EXISTS "Allow anonymous insert access" ON public.vehicle_maintenance_log;
DROP POLICY IF EXISTS "Allow anonymous update access" ON public.vehicle_maintenance_log;
DROP POLICY IF EXISTS "Allow anonymous delete access" ON public.vehicle_maintenance_log;

CREATE POLICY "Allow anonymous read access" ON public.vehicle_maintenance_log
    FOR SELECT USING (true);

CREATE POLICY "Allow anonymous insert access" ON public.vehicle_maintenance_log
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow anonymous update access" ON public.vehicle_maintenance_log
    FOR UPDATE USING (true);

CREATE POLICY "Allow anonymous delete access" ON public.vehicle_maintenance_log
    FOR DELETE USING (true);
