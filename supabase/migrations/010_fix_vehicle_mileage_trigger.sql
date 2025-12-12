-- Исправление функции обновления пробега: пробег не должен обнуляться при удалении всех записей
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

