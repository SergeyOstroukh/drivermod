# Инструкция по выполнению миграций в Supabase

## Вариант 1: Таблица еще НЕ создана (первый раз)

### Шаг 1: Откройте Supabase Dashboard
1. Перейдите на https://supabase.com/dashboard
2. Войдите в свой аккаунт
3. Выберите проект **mrdicoctfaxdrmoluqpi**

### Шаг 2: Откройте SQL Editor
1. В левом меню нажмите **SQL Editor** (иконка с символом `</>`)
2. Нажмите кнопку **New query** (или `Ctrl+N` / `Cmd+N`)

### Шаг 3: Выполните миграцию
1. Откройте файл `supabase/migrations/COMPLETE_SETUP.sql` в вашем редакторе
2. **Скопируйте ВЕСЬ код** из файла
3. **Вставьте** в SQL Editor в Supabase
4. Нажмите кнопку **Run** (или `Ctrl+Enter` / `Cmd+Enter`)

### Шаг 4: Проверьте результат
1. В левом меню нажмите **Table Editor**
2. Должна появиться таблица `suppliers`
3. Нажмите на таблицу, чтобы увидеть все поля:
   - ✅ id
   - ✅ name
   - ✅ address
   - ✅ lat
   - ✅ lon
   - ✅ working_hours
   - ✅ additional_info
   - ✅ info
   - ✅ created_at
   - ✅ updated_at

**Готово!** Теперь откройте `index.html` в браузере.

---

## Вариант 2: Таблица УЖЕ создана (нужно добавить поля)

### Шаг 1: Откройте Supabase Dashboard
1. Перейдите на https://supabase.com/dashboard
2. Войдите в свой аккаунт
3. Выберите проект **mrdicoctfaxdrmoluqpi**

### Шаг 2: Откройте SQL Editor
1. В левом меню нажмите **SQL Editor**
2. Нажмите кнопку **New query**

### Шаг 3: Выполните миграцию
1. Откройте файл `supabase/migrations/ADD_FIELDS_TO_EXISTING_TABLE.sql`
2. **Скопируйте ВЕСЬ код** из файла
3. **Вставьте** в SQL Editor в Supabase
4. Нажмите кнопку **Run** (или `Ctrl+Enter` / `Cmd+Enter`)

### Шаг 4: Проверьте результат
1. В левом меню нажмите **Table Editor**
2. Откройте таблицу `suppliers`
3. Проверьте, что появились новые поля:
   - ✅ working_hours
   - ✅ additional_info

**Готово!** Теперь откройте `index.html` в браузере.

---

## Визуальная инструкция

### Где найти SQL Editor:
```
Supabase Dashboard
├── Project: mrdicoctfaxdrmoluqpi
│   ├── Table Editor (для просмотра таблиц)
│   ├── SQL Editor ← ВОТ ТУТ!
│   ├── Database
│   └── Settings
```

### Как выглядит SQL Editor:
```
┌─────────────────────────────────────┐
│  SQL Editor                    [×]  │
├─────────────────────────────────────┤
│  [New query] [Save] [Run]           │
├─────────────────────────────────────┤
│                                       │
│  -- Вставьте SQL код сюда            │
│                                       │
│                                       │
└─────────────────────────────────────┘
```

---

## Решение проблем

### Ошибка: "relation already exists"
- Таблица уже существует
- Используйте вариант 2 (ADD_FIELDS_TO_EXISTING_TABLE.sql)

### Ошибка: "permission denied"
- Убедитесь, что вы вошли в правильный проект
- Проверьте, что вы владелец проекта

### Ошибка: "column already exists"
- Поля уже добавлены
- Всё в порядке, можно продолжать работу

### Не вижу таблицу в Table Editor
- Обновите страницу (F5)
- Проверьте, что выполнили SQL без ошибок
- Посмотрите в консоль браузера (F12)

---

## Быстрая проверка

После выполнения миграции выполните этот запрос в SQL Editor:

```sql
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'suppliers' 
ORDER BY ordinal_position;
```

Должны увидеть все 10 полей таблицы.

---

## Готово!

После выполнения миграции:
1. ✅ Таблица создана/обновлена
2. ✅ Политики безопасности настроены
3. ✅ Можно открывать `index.html` и работать с приложением

При первом запуске данные из `suppliers.json` будут автоматически импортированы.

