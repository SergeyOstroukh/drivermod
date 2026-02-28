-- График работы водителей: в какие дни недели выходят на смену
-- work_days: NULL или пусто = все дни; иначе строка вида '1,2,3,4,5' (1=Пн .. 7=Вс)
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS work_days TEXT;
COMMENT ON COLUMN public.drivers.work_days IS 'Дни работы: через запятую 1-7 (1=Пн, 7=Вс). NULL = все дни';
