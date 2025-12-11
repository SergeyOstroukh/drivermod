-- Создание таблицы suppliers для Supabase
CREATE TABLE IF NOT EXISTS public.suppliers (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT,
    lat DOUBLE PRECISION NOT NULL,
    lon DOUBLE PRECISION NOT NULL,
    info JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Создание индексов для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_suppliers_name ON public.suppliers(name);
CREATE INDEX IF NOT EXISTS idx_suppliers_coords ON public.suppliers(lat, lon);

-- Функция для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Триггер для автоматического обновления updated_at
DROP TRIGGER IF EXISTS update_suppliers_updated_at ON public.suppliers;
CREATE TRIGGER update_suppliers_updated_at BEFORE UPDATE ON public.suppliers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Включение Row Level Security (RLS)
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

-- Удаление старых политик, если они существуют
DROP POLICY IF EXISTS "Allow anonymous read access" ON public.suppliers;
DROP POLICY IF EXISTS "Allow anonymous insert access" ON public.suppliers;
DROP POLICY IF EXISTS "Allow anonymous update access" ON public.suppliers;
DROP POLICY IF EXISTS "Allow anonymous delete access" ON public.suppliers;

-- Политика для анонимного доступа (чтение)
CREATE POLICY "Allow anonymous read access" ON public.suppliers
    FOR SELECT
    USING (true);

-- Политика для анонимного доступа (вставка)
CREATE POLICY "Allow anonymous insert access" ON public.suppliers
    FOR INSERT
    WITH CHECK (true);

-- Политика для анонимного доступа (обновление)
CREATE POLICY "Allow anonymous update access" ON public.suppliers
    FOR UPDATE
    USING (true);

-- Политика для анонимного доступа (удаление)
CREATE POLICY "Allow anonymous delete access" ON public.suppliers
    FOR DELETE
    USING (true);

