-- Добавление полей для уровня топлива и заправки в таблицу vehicle_mileage_log
ALTER TABLE public.vehicle_mileage_log 
ADD COLUMN IF NOT EXISTS fuel_level DECIMAL(6,2); -- текущий уровень топлива в баке (литры)

ALTER TABLE public.vehicle_mileage_log 
ADD COLUMN IF NOT EXISTS fuel_refill DECIMAL(6,2); -- заправка за смену (литры)

COMMENT ON COLUMN public.vehicle_mileage_log.fuel_level IS 'Текущий уровень топлива в баке (литры)';
COMMENT ON COLUMN public.vehicle_mileage_log.fuel_refill IS 'Заправка за смену (литры)';

