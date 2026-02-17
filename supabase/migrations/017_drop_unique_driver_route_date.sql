-- Убираем уникальный индекс (driver_id, route_date) чтобы поддерживать мульти-выезды
-- Водитель может иметь несколько маршрутов за одну дату (Выезд 1, Выезд 2, ...)
DROP INDEX IF EXISTS idx_driver_routes_driver_date;
