-- Удаляем дублирующиеся автомобили, оставляя только запись с наименьшим id
-- Для каждой группы дубликатов по plate_number оставляем одну запись

-- Сначала переносим записи пробега с дубликатов на оригинал
UPDATE vehicle_mileage_log
SET vehicle_id = originals.min_id
FROM (
    SELECT plate_number, MIN(id) AS min_id
    FROM vehicles
    GROUP BY plate_number
    HAVING COUNT(*) > 1
) originals
JOIN vehicles v ON v.plate_number = originals.plate_number AND v.id != originals.min_id
WHERE vehicle_mileage_log.vehicle_id = v.id;

-- Переносим записи истории
UPDATE vehicle_driver_history
SET vehicle_id = originals.min_id
FROM (
    SELECT plate_number, MIN(id) AS min_id
    FROM vehicles
    GROUP BY plate_number
    HAVING COUNT(*) > 1
) originals
JOIN vehicles v ON v.plate_number = originals.plate_number AND v.id != originals.min_id
WHERE vehicle_driver_history.vehicle_id = v.id;

-- Переносим записи ТО
UPDATE vehicle_maintenance_log
SET vehicle_id = originals.min_id
FROM (
    SELECT plate_number, MIN(id) AS min_id
    FROM vehicles
    GROUP BY plate_number
    HAVING COUNT(*) > 1
) originals
JOIN vehicles v ON v.plate_number = originals.plate_number AND v.id != originals.min_id
WHERE vehicle_maintenance_log.vehicle_id = v.id;

-- Удаляем дубликаты (все кроме записи с минимальным id)
DELETE FROM vehicles
WHERE id NOT IN (
    SELECT MIN(id)
    FROM vehicles
    GROUP BY plate_number
);

-- Добавляем уникальный индекс, чтобы дубли больше не появлялись
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_plate_number_unique
ON vehicles (plate_number);
