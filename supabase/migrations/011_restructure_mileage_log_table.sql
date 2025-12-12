-- Реструктуризация таблицы vehicle_mileage_log для новой схемы
-- Добавляем новые поля

-- Номер смены (фактическое число управления ТС)
ALTER TABLE public.vehicle_mileage_log 
ADD COLUMN IF NOT EXISTS shift_number INTEGER;

-- Километраж при выезде
ALTER TABLE public.vehicle_mileage_log 
ADD COLUMN IF NOT EXISTS mileage_out INTEGER;

-- Остаток топлива при выезде
ALTER TABLE public.vehicle_mileage_log 
ADD COLUMN IF NOT EXISTS fuel_level_out DECIMAL(6,2);

-- Остаток топлива при возвращении
ALTER TABLE public.vehicle_mileage_log 
ADD COLUMN IF NOT EXISTS fuel_level_return DECIMAL(6,2);

-- Фактический расход топлива за смену
ALTER TABLE public.vehicle_mileage_log 
ADD COLUMN IF NOT EXISTS actual_fuel_consumption DECIMAL(6,2);

-- Комментарии к полям
COMMENT ON COLUMN public.vehicle_mileage_log.shift_number IS 'Номер смены (фактическое число управления ТС)';
COMMENT ON COLUMN public.vehicle_mileage_log.mileage_out IS 'Километраж при выезде';
COMMENT ON COLUMN public.vehicle_mileage_log.mileage IS 'Километраж при возвращении (общий пробег)';
COMMENT ON COLUMN public.vehicle_mileage_log.fuel_level_out IS 'Остаток топлива при выезде (л)';
COMMENT ON COLUMN public.vehicle_mileage_log.fuel_level_return IS 'Остаток топлива при возвращении (л)';
COMMENT ON COLUMN public.vehicle_mileage_log.fuel_refill IS 'Заправка литров (если была)';
COMMENT ON COLUMN public.vehicle_mileage_log.actual_fuel_consumption IS 'Фактический расход топлива за смену (л)';

-- Функция для автоматического расчета номера смены
CREATE OR REPLACE FUNCTION calculate_shift_number()
RETURNS TRIGGER AS $$
BEGIN
    -- Если номер смены не указан, вычисляем его как максимальный + 1 для данного автомобиля
    IF NEW.shift_number IS NULL THEN
        SELECT COALESCE(MAX(shift_number), 0) + 1 INTO NEW.shift_number
        FROM public.vehicle_mileage_log
        WHERE vehicle_id = NEW.vehicle_id;
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Триггер для автоматического расчета номера смены
DROP TRIGGER IF EXISTS calculate_shift_number_trigger ON public.vehicle_mileage_log;
CREATE TRIGGER calculate_shift_number_trigger 
    BEFORE INSERT ON public.vehicle_mileage_log
    FOR EACH ROW EXECUTE FUNCTION calculate_shift_number();

