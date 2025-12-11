-- Добавление полей для времени работы и дополнительной информации
-- Выполните этот SQL после создания основной таблицы

-- Добавляем поле для времени работы
ALTER TABLE public.suppliers 
ADD COLUMN IF NOT EXISTS working_hours TEXT;

-- Добавляем поле для дополнительной информации (текст вместо JSONB)
ALTER TABLE public.suppliers 
ADD COLUMN IF NOT EXISTS additional_info TEXT;

-- Если поле info существует как JSONB, можно оставить его для обратной совместимости
-- или удалить, если не нужно:
-- ALTER TABLE public.suppliers DROP COLUMN IF EXISTS info;

