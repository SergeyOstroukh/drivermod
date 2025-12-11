# Настройка Supabase

## Шаг 1: Создание проекта в Supabase

1. Перейдите на [https://supabase.com](https://supabase.com)
2. Зарегистрируйтесь или войдите в аккаунт
3. Нажмите "New Project"
4. Заполните данные проекта:
   - **Name**: название проекта (например: "Suppliers")
   - **Database Password**: придумайте надежный пароль (сохраните его!)
   - **Region**: выберите ближайший регион
   - **Pricing Plan**: выберите Free план (достаточно для начала)
5. Нажмите "Create new project"
6. Дождитесь создания проекта (обычно 1-2 минуты)

## Шаг 2: Получение API ключей

1. В вашем проекте перейдите в **Settings** (настройки) → **API**
2. Найдите следующие значения:
   - **Project URL** (например: `https://xxxxx.supabase.co`)
   - **anon/public key** (длинная строка, начинается с `eyJ...`)

## Шаг 3: Настройка конфигурации

Откройте файл `js/config.js` и замените значения:

```javascript
window.SUPABASE_CONFIG = {
	url: 'https://ваш-проект.supabase.co',  // Ваш Project URL
	anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'  // Ваш anon key
};
```

## Шаг 4: Создание таблицы в Supabase

1. В Supabase Dashboard перейдите в **SQL Editor**
2. Нажмите "New query"
3. Скопируйте и выполните следующий SQL код:

```sql
-- Создание таблицы suppliers
CREATE TABLE IF NOT EXISTS public.suppliers (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT,
    lat DOUBLE PRECISION NOT NULL,
    lon DOUBLE PRECISION NOT NULL,
    info JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Создание индексов для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_suppliers_name ON public.suppliers(name);
CREATE INDEX IF NOT EXISTS idx_suppliers_coords ON public.suppliers(lat, lon);

-- Функция для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Триггер для автоматического обновления updated_at
CREATE TRIGGER update_suppliers_updated_at BEFORE UPDATE ON public.suppliers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Включение Row Level Security (RLS)
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

-- Политика для анонимного доступа (чтение и запись)
CREATE POLICY "Allow anonymous read access" ON public.suppliers
    FOR SELECT
    USING (true);

CREATE POLICY "Allow anonymous insert access" ON public.suppliers
    FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Allow anonymous update access" ON public.suppliers
    FOR UPDATE
    USING (true);

CREATE POLICY "Allow anonymous delete access" ON public.suppliers
    FOR DELETE
    USING (true);
```

4. Нажмите "Run" или `Ctrl+Enter` (Windows) / `Cmd+Enter` (Mac)

## Шаг 5: Проверка

1. Откройте `index.html` в браузере
2. Приложение автоматически подключится к Supabase
3. Если база пуста, данные из `suppliers.json` будут импортированы автоматически

## Альтернативный способ: через Table Editor

Если вы предпочитаете графический интерфейс:

1. Перейдите в **Table Editor**
2. Нажмите "New table"
3. Назовите таблицу `suppliers`
4. Добавьте колонки:
   - `id` - тип `int8`, Primary Key, Auto-increment
   - `name` - тип `text`, Not null
   - `address` - тип `text`
   - `lat` - тип `float8`, Not null
   - `lon` - тип `float8`, Not null
   - `info` - тип `jsonb`
   - `created_at` - тип `timestamptz`, Default: `now()`
   - `updated_at` - тип `timestamptz`, Default: `now()`

5. Затем выполните SQL для создания индексов, триггера и политик (см. выше)

## Настройка Row Level Security (RLS)

RLS уже настроен через SQL выше, но вы можете проверить:

1. Перейдите в **Authentication** → **Policies**
2. Выберите таблицу `suppliers`
3. Должны быть видны 4 политики для анонимного доступа

## Важные замечания

- **Бесплатный план Supabase** включает:
  - 500 MB базы данных
  - 2 GB bandwidth
  - Достаточно для небольших проектов

- **Безопасность**: 
  - Anon key безопасен для использования в браузере
  - RLS политики защищают ваши данные
  - Не публикуйте Service Role key в клиентском коде!

- **Лимиты**:
  - Бесплатный план имеет ограничения на количество запросов
  - Для продакшена рассмотрите платные планы

## Решение проблем

### Ошибка "Invalid API key"
- Проверьте, что вы используете правильный anon key (не service role key)
- Убедитесь, что URL проекта указан правильно

### Ошибка "relation does not exist"
- Убедитесь, что таблица создана
- Проверьте, что вы выполнили SQL миграцию

### Ошибка "new row violates row-level security policy"
- Проверьте, что RLS политики созданы и активны
- Убедитесь, что политики разрешают анонимный доступ

## Полезные ссылки

- [Документация Supabase](https://supabase.com/docs)
- [Supabase Dashboard](https://supabase.com/dashboard)
- [Supabase JavaScript Client](https://supabase.com/docs/reference/javascript/introduction)

