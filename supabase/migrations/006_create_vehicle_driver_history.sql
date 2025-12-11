-- Создание таблицы истории использования автомобилей водителями
CREATE TABLE IF NOT EXISTS public.vehicle_driver_history (
    id BIGSERIAL PRIMARY KEY,
    vehicle_id BIGINT NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
    driver_id BIGINT NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    end_date DATE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Создание индексов
CREATE INDEX IF NOT EXISTS idx_history_vehicle ON public.vehicle_driver_history(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_history_driver ON public.vehicle_driver_history(driver_id);
CREATE INDEX IF NOT EXISTS idx_history_dates ON public.vehicle_driver_history(start_date, end_date);

-- Функция для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_history_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Триггер для автоматического обновления updated_at
DROP TRIGGER IF EXISTS update_history_updated_at ON public.vehicle_driver_history;
CREATE TRIGGER update_history_updated_at BEFORE UPDATE ON public.vehicle_driver_history
    FOR EACH ROW EXECUTE FUNCTION update_history_updated_at();

-- Включение Row Level Security (RLS)
ALTER TABLE public.vehicle_driver_history ENABLE ROW LEVEL SECURITY;

-- Политики для анонимного доступа
DROP POLICY IF EXISTS "Allow anonymous read access" ON public.vehicle_driver_history;
DROP POLICY IF EXISTS "Allow anonymous insert access" ON public.vehicle_driver_history;
DROP POLICY IF EXISTS "Allow anonymous update access" ON public.vehicle_driver_history;
DROP POLICY IF EXISTS "Allow anonymous delete access" ON public.vehicle_driver_history;

CREATE POLICY "Allow anonymous read access" ON public.vehicle_driver_history
    FOR SELECT USING (true);

CREATE POLICY "Allow anonymous insert access" ON public.vehicle_driver_history
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow anonymous update access" ON public.vehicle_driver_history
    FOR UPDATE USING (true);

CREATE POLICY "Allow anonymous delete access" ON public.vehicle_driver_history
    FOR DELETE USING (true);

