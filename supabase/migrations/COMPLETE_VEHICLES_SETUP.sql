-- ============================================
-- ПОЛНАЯ НАСТРОЙКА ТАБЛИЦ ВОДИТЕЛЕЙ И АВТОМОБИЛЕЙ
-- ============================================
-- Выполните этот скрипт в Supabase SQL Editor
-- ============================================

-- Создание таблицы водителей
CREATE TABLE IF NOT EXISTS public.drivers (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    license_number TEXT,
    license_expiry DATE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Создание таблицы автомобилей
CREATE TABLE IF NOT EXISTS public.vehicles (
    id BIGSERIAL PRIMARY KEY,
    plate_number TEXT NOT NULL,
    driver_id BIGINT REFERENCES public.drivers(id) ON DELETE SET NULL,
    mileage INTEGER DEFAULT 0,
    oil_change_mileage INTEGER,
    oil_change_info TEXT,
    oil_change_interval INTEGER,
    inspection_start DATE,
    inspection_expiry DATE,
    insurance_start DATE,
    insurance_expiry DATE,
    driver_period_start DATE,
    driver_period_end DATE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Индексы для водителей
CREATE INDEX IF NOT EXISTS idx_drivers_name ON public.drivers(name);
CREATE INDEX IF NOT EXISTS idx_drivers_license ON public.drivers(license_number);

-- Индексы для автомобилей
CREATE INDEX IF NOT EXISTS idx_vehicles_plate ON public.vehicles(plate_number);
CREATE INDEX IF NOT EXISTS idx_vehicles_driver ON public.vehicles(driver_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_inspection ON public.vehicles(inspection_expiry);
CREATE INDEX IF NOT EXISTS idx_vehicles_insurance ON public.vehicles(insurance_expiry);

-- Функции для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_drivers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE OR REPLACE FUNCTION update_vehicles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Триггеры
DROP TRIGGER IF EXISTS update_drivers_updated_at ON public.drivers;
CREATE TRIGGER update_drivers_updated_at BEFORE UPDATE ON public.drivers
    FOR EACH ROW EXECUTE FUNCTION update_drivers_updated_at();

DROP TRIGGER IF EXISTS update_vehicles_updated_at ON public.vehicles;
CREATE TRIGGER update_vehicles_updated_at BEFORE UPDATE ON public.vehicles
    FOR EACH ROW EXECUTE FUNCTION update_vehicles_updated_at();

-- Включение Row Level Security
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;

-- Политики для водителей
DROP POLICY IF EXISTS "Allow anonymous read access" ON public.drivers;
DROP POLICY IF EXISTS "Allow anonymous insert access" ON public.drivers;
DROP POLICY IF EXISTS "Allow anonymous update access" ON public.drivers;
DROP POLICY IF EXISTS "Allow anonymous delete access" ON public.drivers;

CREATE POLICY "Allow anonymous read access" ON public.drivers FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert access" ON public.drivers FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anonymous update access" ON public.drivers FOR UPDATE USING (true);
CREATE POLICY "Allow anonymous delete access" ON public.drivers FOR DELETE USING (true);

-- Политики для автомобилей
DROP POLICY IF EXISTS "Allow anonymous read access" ON public.vehicles;
DROP POLICY IF EXISTS "Allow anonymous insert access" ON public.vehicles;
DROP POLICY IF EXISTS "Allow anonymous update access" ON public.vehicles;
DROP POLICY IF EXISTS "Allow anonymous delete access" ON public.vehicles;

CREATE POLICY "Allow anonymous read access" ON public.vehicles FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert access" ON public.vehicles FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anonymous update access" ON public.vehicles FOR UPDATE USING (true);
CREATE POLICY "Allow anonymous delete access" ON public.vehicles FOR DELETE USING (true);

-- ============================================
-- ГОТОВО! Таблицы созданы и настроены
-- ============================================

