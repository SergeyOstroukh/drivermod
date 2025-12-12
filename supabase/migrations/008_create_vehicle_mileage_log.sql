-- Создание таблицы для записи ежедневных показаний пробега
CREATE TABLE IF NOT EXISTS public.vehicle_mileage_log (
    id BIGSERIAL PRIMARY KEY,
    vehicle_id BIGINT NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
    driver_id BIGINT REFERENCES public.drivers(id) ON DELETE SET NULL,
    mileage INTEGER NOT NULL, -- общий пробег на момент записи
    log_date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(vehicle_id, log_date) -- одна запись на автомобиль в день
);

-- Создание индексов
CREATE INDEX IF NOT EXISTS idx_mileage_log_vehicle ON public.vehicle_mileage_log(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_mileage_log_driver ON public.vehicle_mileage_log(driver_id);
CREATE INDEX IF NOT EXISTS idx_mileage_log_date ON public.vehicle_mileage_log(log_date);
CREATE INDEX IF NOT EXISTS idx_mileage_log_vehicle_date ON public.vehicle_mileage_log(vehicle_id, log_date);

-- Функция для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_mileage_log_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Триггер для автоматического обновления updated_at
DROP TRIGGER IF EXISTS update_mileage_log_updated_at ON public.vehicle_mileage_log;
CREATE TRIGGER update_mileage_log_updated_at BEFORE UPDATE ON public.vehicle_mileage_log
    FOR EACH ROW EXECUTE FUNCTION update_mileage_log_updated_at();

-- Функция для автоматического обновления пробега в vehicles при добавлении записи
CREATE OR REPLACE FUNCTION update_vehicle_mileage()
RETURNS TRIGGER AS $$
DECLARE
    max_mileage INTEGER;
BEGIN
    -- Получаем максимальный пробег из логов
    SELECT MAX(mileage) INTO max_mileage
    FROM public.vehicle_mileage_log 
    WHERE vehicle_id = NEW.vehicle_id;
    
    -- Обновляем пробег только если есть записи (max_mileage не NULL)
    IF max_mileage IS NOT NULL THEN
        UPDATE public.vehicles
        SET mileage = max_mileage
        WHERE id = NEW.vehicle_id;
    END IF;
    -- Если записей нет, пробег не обновляем - остается прежний
    
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Триггер для автоматического обновления пробега
DROP TRIGGER IF EXISTS update_vehicle_mileage_trigger ON public.vehicle_mileage_log;
CREATE TRIGGER update_vehicle_mileage_trigger 
    AFTER INSERT OR UPDATE ON public.vehicle_mileage_log
    FOR EACH ROW EXECUTE FUNCTION update_vehicle_mileage();

-- Включение Row Level Security (RLS)
ALTER TABLE public.vehicle_mileage_log ENABLE ROW LEVEL SECURITY;

-- Политики для анонимного доступа
DROP POLICY IF EXISTS "Allow anonymous read access" ON public.vehicle_mileage_log;
DROP POLICY IF EXISTS "Allow anonymous insert access" ON public.vehicle_mileage_log;
DROP POLICY IF EXISTS "Allow anonymous update access" ON public.vehicle_mileage_log;
DROP POLICY IF EXISTS "Allow anonymous delete access" ON public.vehicle_mileage_log;

CREATE POLICY "Allow anonymous read access" ON public.vehicle_mileage_log
    FOR SELECT USING (true);

CREATE POLICY "Allow anonymous insert access" ON public.vehicle_mileage_log
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow anonymous update access" ON public.vehicle_mileage_log
    FOR UPDATE USING (true);

CREATE POLICY "Allow anonymous delete access" ON public.vehicle_mileage_log
    FOR DELETE USING (true);

