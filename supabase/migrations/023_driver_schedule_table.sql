-- Схема графика для водителя: 5x2, 3x3, 2x2 (используется для автозаполнения и напоминаний)
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS schedule_scheme TEXT DEFAULT '5x2';
COMMENT ON COLUMN public.drivers.schedule_scheme IS 'Схема графика: 5x2, 3x3, 2x2';

-- Таблица ячеек графика: переопределения по дням (рабочий/выходной/больничный)
CREATE TABLE IF NOT EXISTS public.driver_schedule (
    id BIGSERIAL PRIMARY KEY,
    driver_id BIGINT NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
    schedule_date DATE NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('work', 'off', 'sick')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(driver_id, schedule_date)
);
CREATE INDEX IF NOT EXISTS idx_driver_schedule_driver ON public.driver_schedule(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_schedule_date ON public.driver_schedule(schedule_date);

ALTER TABLE public.driver_schedule ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Allow anonymous read driver_schedule" ON public.driver_schedule;
DROP POLICY IF EXISTS "Allow anonymous insert driver_schedule" ON public.driver_schedule;
DROP POLICY IF EXISTS "Allow anonymous update driver_schedule" ON public.driver_schedule;
DROP POLICY IF EXISTS "Allow anonymous delete driver_schedule" ON public.driver_schedule;
CREATE POLICY "Allow anonymous read driver_schedule" ON public.driver_schedule FOR SELECT USING (true);
CREATE POLICY "Allow anonymous insert driver_schedule" ON public.driver_schedule FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow anonymous update driver_schedule" ON public.driver_schedule FOR UPDATE USING (true);
CREATE POLICY "Allow anonymous delete driver_schedule" ON public.driver_schedule FOR DELETE USING (true);
