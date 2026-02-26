-- Таблица партнеров для распределения
CREATE TABLE IF NOT EXISTS public.partners (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Индексы для поиска и координат
CREATE INDEX IF NOT EXISTS idx_partners_name ON public.partners(name);
CREATE INDEX IF NOT EXISTS idx_partners_coords ON public.partners(lat, lon);

-- Триггер обновления updated_at
CREATE OR REPLACE FUNCTION update_partners_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_partners_updated_at ON public.partners;
CREATE TRIGGER trigger_partners_updated_at
  BEFORE UPDATE ON public.partners
  FOR EACH ROW
  EXECUTE FUNCTION update_partners_updated_at();

-- RLS
ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access to partners" ON public.partners;
CREATE POLICY "Allow all access to partners" ON public.partners
  FOR ALL USING (true) WITH CHECK (true);
