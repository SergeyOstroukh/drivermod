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

-- Создание индексов
CREATE INDEX IF NOT EXISTS idx_drivers_name ON public.drivers(name);
CREATE INDEX IF NOT EXISTS idx_drivers_license ON public.drivers(license_number);

-- Функция для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_drivers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Триггер для автоматического обновления updated_at
DROP TRIGGER IF EXISTS update_drivers_updated_at ON public.drivers;
CREATE TRIGGER update_drivers_updated_at BEFORE UPDATE ON public.drivers
    FOR EACH ROW EXECUTE FUNCTION update_drivers_updated_at();

-- Включение Row Level Security (RLS)
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;

-- Политики для анонимного доступа
DROP POLICY IF EXISTS "Allow anonymous read access" ON public.drivers;
DROP POLICY IF EXISTS "Allow anonymous insert access" ON public.drivers;
DROP POLICY IF EXISTS "Allow anonymous update access" ON public.drivers;
DROP POLICY IF EXISTS "Allow anonymous delete access" ON public.drivers;

CREATE POLICY "Allow anonymous read access" ON public.drivers
    FOR SELECT USING (true);

CREATE POLICY "Allow anonymous insert access" ON public.drivers
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow anonymous update access" ON public.drivers
    FOR UPDATE USING (true);

CREATE POLICY "Allow anonymous delete access" ON public.drivers
    FOR DELETE USING (true);

