-- Добавление поля расхода топлива в таблицу vehicles
ALTER TABLE public.vehicles 
ADD COLUMN IF NOT EXISTS fuel_consumption DECIMAL(5,2); -- расход в литрах на 100 км

COMMENT ON COLUMN public.vehicles.fuel_consumption IS 'Расход топлива в литрах на 100 км';

