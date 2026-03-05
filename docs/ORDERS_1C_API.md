# Заказы из 1С: приём в базу и обратная передача статусов

---

## Что сделать сейчас (пошагово)

### Шаг 1. База данных в Supabase

1. Зайди в [Supabase Dashboard](https://supabase.com/dashboard) → свой проект.
2. Открой **SQL Editor** (слева).
3. Если таблицы `customer_orders` ещё нет — выполни весь скрипт из файла **`supabase/migrations/029_customer_orders.sql`** (скопируй содержимое и нажми Run).
4. Если таблица уже есть, но была без колонки `delivery_time_slot` — выполни только:
   ```sql
   ALTER TABLE public.customer_orders ADD COLUMN IF NOT EXISTS delivery_time_slot TEXT;
   ALTER TABLE public.customer_orders ADD COLUMN IF NOT EXISTS assigned_driver_id BIGINT REFERENCES public.drivers(id) ON DELETE SET NULL;
   ALTER TABLE public.customer_orders ADD COLUMN IF NOT EXISTS driver_route_id BIGINT REFERENCES public.driver_routes(id) ON DELETE SET NULL;
   ALTER TABLE public.customer_orders ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
   ALTER TABLE public.customer_orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
   ```

### Шаг 2. Realtime (чтобы заказы появлялись на вкладке без «Обновить»)

**Важно:** это не раздел "Replication" в Platform (тот про реплики БД). Нужна **публикация для Realtime**.

**Способ А — через интерфейс**

1. В левом меню Supabase открой **Database Management** → **Publications**.
2. Выбери публикацию **`supabase_realtime`** (или создай её, если нет).
3. Добавь в публикацию таблицу **`customer_orders`** (галочка / кнопка Add table).

**Способ Б — через SQL (проще)**

1. Открой **SQL Editor**.
2. Выполни один запрос:
   ```sql
   ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_orders;
   ```
3. Если таблица уже в публикации, будет ошибка «already member» — тогда ничего делать не нужно, Realtime уже включён.

### Шаг 3. Edge Function (приём заказов из Postman/1С)

1. В терминале в папке проекта выполни:
   ```bash
   supabase login
   supabase link --project-ref mrdicoctfaxdrmoluqpi
   supabase functions deploy orders-1c-ingest --no-verify-jwt
   ```
   (если у тебя другой project ref — подставь его вместо `mrdicoctfaxdrmoluqpi`; ref виден в URL проекта в Dashboard.)

### Шаг 4. Проверка в Postman

1. **Method:** POST  
2. **URL:** `https://mrdicoctfaxdrmoluqpi.supabase.co/functions/v1/orders-1c-ingest`  
3. **Headers:** `Content-Type: application/json`  
4. **Body** → raw → JSON — вставь (дату замени на сегодня):
   ```json
   {
     "order_1c_id": "TEST-001",
     "order_date": "2025-03-06",
     "customer_name": "Иванов И.И.",
     "delivery_address": "г. Минск, ул. Примерная, д. 1",
     "phone": "+375 29 123-45-67",
     "delivery_time_slot": "до 14",
     "items": "Товар 1, Товар 2",
     "amount": 1500.50
   }
   ```
5. Нажми **Send**. Ожидаемый ответ: `{"ok": true}`.

### Шаг 5. Проверка в приложении

1. Открой своё приложение и перейди на вкладку **«Заказы из 1С»**.
2. Должен появиться заказ с номером TEST-001 (если дата в запросе совпадает с сегодняшней).
3. Если включён Realtime — открой вкладку «Заказы из 1С», затем в Postman отправь ещё один заказ (другой `order_1c_id`): он должен появиться в таблице без нажатия «Обновить».

Готово. Дальше в разделе ниже — описание таблицы и API.

---

## Если заказы не отображаются на вкладке

Приложение берёт данные **из таблицы `public.customer_orders`** (та же, что в Table Editor). Если в БД строки есть, а на вкладке — нет, проверь два момента.

### 1. Выбрана ли нужная дата

На вкладке «Заказы из 1С» вверху есть поле **«Дата»**. Загружаются только заказы с `order_date` = выбранной дате. Выбери в календаре дату, по которой в Table Editor есть строки (например 2025-03-06 или 2026-03-05), и нажми «Обновить».

### 2. RLS: доступ для anon

В Table Editor данные показываются под ролью **postgres**, а приложение ходит в API с ключом **anon**. Если для таблицы включён RLS, но нет политики, разрешающей чтение для anon, API вернёт пустой массив.

**Что сделать:** в Supabase открой **SQL Editor** и выполни:

```sql
ALTER TABLE public.customer_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access to customer_orders" ON public.customer_orders;
CREATE POLICY "Allow all access to customer_orders" ON public.customer_orders
    FOR ALL
    USING (true)
    WITH CHECK (true);
```

После этого обнови страницу приложения и снова выбери дату и нажми «Обновить».

---

## Таблица в Supabase: `customer_orders`

Используется таблица **`customer_orders`** и Edge Function **`orders-1c-ingest`** (уже развёрнутая в Supabase или из репозитория).

После применения миграции `029_customer_orders.sql` в базе есть таблица:

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | bigint | Внутренний ID (PK) |
| `order_1c_id` | text | **Уникальный идентификатор заказа в 1С** — по нему 1С узнаёт заказ при передаче статусов |
| `order_date` | date | Дата доставки |
| `customer_name` | text | Имя/название клиента |
| `delivery_address` | text | Адрес доставки |
| `phone` | text | Телефон клиента |
| `items` | jsonb | Товар/список товаров (строка или JSON) |
| `amount` | numeric | Сумма заказа |
| `status` | text | Статус: `new`, `assigned`, `in_delivery`, `delivered`, `cancelled` |
| `delivery_time_slot` | text | Время доставки (например "до 14") |
| `assigned_driver_id` | bigint | ID водителя (когда распределён) |
| `driver_route_id` | bigint | ID рейса водителя (когда назначен рейс) |
| `created_at`, `updated_at` | timestamptz | Время создания/обновления |

Статусы:
- **new** — новый, только пришёл из 1С
- **assigned** — распределён на водителя
- **in_delivery** — в доставке (водитель в пути)
- **delivered** — доставлен
- **cancelled** — отменён

---

## Как 1С записывает заказы: Edge Function `orders-1c-ingest`

1С отправляет **POST** на URL функции:

```
POST https://<PROJECT_REF>.supabase.co/functions/v1/orders-1c-ingest
Content-Type: application/json
```

**Один заказ:**

```json
{
  "order_1c_id": "УНИКАЛЬНЫЙ_НОМЕР_ИЗ_1С",
  "order_date": "2025-03-05",
  "customer_name": "Иванов И.И.",
  "delivery_address": "г. Москва, ул. Примерная, д. 1",
  "phone": "+7 999 123-45-67",
  "items": "Товар 1, Товар 2",
  "amount": 1500.50
}
```

**Пачка заказов:**

```json
{
  "orders": [
    {
      "order_1c_id": "...",
      "order_date": "2025-03-05",
      "customer_name": "...",
      "delivery_address": "...",
      "phone": "...",
      "items": "...",
      "amount": 1500.50
    }
  ]
}
```

Обязательные поля: **`order_1c_id`** и **`delivery_address`**. Остальные опциональны.

- При повторной отправке с тем же `order_1c_id` заказ обновляется (upsert по `order_1c_id`). Так можно и подгружать новые заказы, и обновлять уже отправленные на день.
- В коде функции новые строки получают `status: "new"`; при upsert существующая строка обновляется полями от 1С (статус и привязка к водителю в функции не перезаписываются — это делает только ваш кабинет).

Переменные окружения: Supabase автоматически подставляет `SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY`. Если у вас в настройках Edge Functions заданы `PROJECT_URL` и `SERVICE_ROLE_KEY`, функция их тоже подхватит.

Развёртывание из репозитория:

```bash
supabase functions deploy orders-1c-ingest --no-verify-jwt
```

---

## Как отправить заказ через Postman

1. **Метод и URL**
   - Method: **POST**
   - URL: `https://mrdicoctfaxdrmoluqpi.supabase.co/functions/v1/orders-1c-ingest`  
     (подставь свой Project URL, если другой: `https://<PROJECT_REF>.supabase.co/functions/v1/orders-1c-ingest`)

2. **Headers**
   - **Content-Type**: `application/json`

3. **Body** → вкладка **raw** → тип **JSON**.

   **Один заказ:**
   ```json
   {
     "order_1c_id": "TEST-001",
     "order_date": "2025-03-06",
     "customer_name": "Иванов И.И.",
     "delivery_address": "г. Минск, ул. Примерная, д. 1",
     "phone": "+375 29 123-45-67",
     "delivery_time_slot": "до 14",
     "items": "Товар 1, Товар 2",
     "amount": 1500.50
   }
   ```

   **Несколько заказов (массив `orders`):**
   ```json
   {
     "orders": [
       {
         "order_1c_id": "TEST-002",
         "delivery_address": "г. Минск, пр. Независимости, 45",
         "phone": "+375 29 111-22-33",
         "customer_name": "Петров П.П.",
         "delivery_time_slot": "до 18",
         "items": "Товар А",
         "amount": 800
       },
       {
         "order_1c_id": "TEST-003",
         "delivery_address": "г. Минск, ул. Немига, 12",
         "phone": "+375 33 444-55-66",
         "amount": 2200
       }
     ]
   }
   ```

4. Нажми **Send**. В ответ должно прийти `{"ok": true}` или `{"ok": true, "accepted": N}`.

5. Проверка: открой в приложении вкладку **«Заказы из 1С»** — заказы на сегодня появятся в таблице (дата `order_date` должна совпадать с сегодняшней, иначе отфильтруй по дате в БД или поменяй `order_date` в запросе на сегодня).

**Важно:** обязательны только **`order_1c_id`** и **`delivery_address`**. Остальные поля можно не передавать или передавать частично.

### Тестовое тело со всеми полями (для Postman)

Скопируй в Body → raw → JSON — все поля, которые принимает API (дату замени на сегодня в формате `YYYY-MM-DD`):

```json
{
  "order_1c_id": "TEST-FULL-001",
  "order_date": "2025-03-06",
  "customer_name": "Иванов Иван Иванович",
  "delivery_address": "г. Минск, ул. Примерная, д. 1, кв. 5",
  "phone": "+375 29 123-45-67",
  "delivery_time_slot": "до 14",
  "items": "Молоко 2л, Хлеб белый, Яйца 10 шт.",
  "amount": 1850.50
}
```

**Пачка из двух заказов со всеми полями:**

```json
{
  "orders": [
    {
      "order_1c_id": "TEST-FULL-002",
      "order_date": "2025-03-06",
      "customer_name": "Петров Пётр Петрович",
      "delivery_address": "г. Минск, пр. Независимости, 45, под. 2",
      "phone": "+375 29 111-22-33",
      "delivery_time_slot": "до 18",
      "items": "Вода 5л, Сок яблочный 1л",
      "amount": 1200
    },
    {
      "order_1c_id": "TEST-FULL-003",
      "order_date": "2025-03-06",
      "customer_name": "Сидорова Анна",
      "delivery_address": "г. Минск, ул. Немига, 12",
      "phone": "+375 33 444-55-66",
      "delivery_time_slot": "9:00–12:00",
      "items": "Кефир, Творог 200г, Сметана",
      "amount": 890.00
    }
  ]
}
```

Поля в таблице, которые задаются в приложении (не передаются из 1С): `status`, `assigned_driver_id`, `driver_route_id`, `created_at`, `updated_at`.

---

## Realtime: заказы сразу на вкладке

На вкладке «Заказы из 1С» включена подписка Supabase Realtime на таблицу `customer_orders`: при **INSERT** или **UPDATE** список заказов обновляется без перезагрузки страницы (новый заказ из Postman/1С сразу появляется в таблице).

Чтобы Realtime работал, таблицу `customer_orders` нужно добавить в публикацию **supabase_realtime**: **Database Management** → **Publications** → `supabase_realtime` → добавить таблицу. Либо выполнить в SQL Editor: `ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_orders;`

Если таблица не в публикации, вкладка по-прежнему будет показывать заказы после ручного нажатия «Обновить».

---

## Обратная передача статусов в 1С

Статусы и привязка к водителю/рейсу меняются в кабинете и хранятся в `customer_orders`. Связь с 1С — по полю **`order_1c_id`**.

### Как это работает

1. **Распределение:** с вкладки «Заказы из 1С» ты выбираешь заказы и жмёшь «Перенести на карту». На карте распределяешь их по водителям и жмёшь **«Отправить маршруты»**. Тогда в БД у этих заказов проставляются `assigned_driver_id`, `driver_route_id` и **status = assigned**, а водитель видит их в путевом листе (раздел Водители → открыть свой маршрут).

2. **Путевой лист водителя:** водитель открывает маршрут, видит заказы 1С с кнопками «В доставке», «Доставлен», «Отменён». Кнопка **«Начать задание»** переводит все заказы 1С в этом маршруте в статус «В доставке». При смене статуса по заказу: обновляется запись в `customer_orders`, и наш backend вызывает 1С (webhook).

3. **Отправка в 1С:** при смене статуса водителем вызывается Edge Function **push-order-status-to-1c**. Она отправляет в 1С POST с телом `{ "order_1c_id": "...", "status": "delivered" }` (или `in_delivery`, `cancelled`). URL 1С задаётся в Supabase Secrets: **ONE_C_WEBHOOK_URL** (например `https://your-1c-server/ws/order-status`).

**Деплой функции и настройка:**
```bash
supabase functions deploy push-order-status-to-1c --no-verify-jwt
supabase secrets set ONE_C_WEBHOOK_URL=https://ваш-сервер-1с/путь-к-webhook
```

Если **ONE_C_WEBHOOK_URL** не задан, статусы по-прежнему обновляются в БД и на вкладке «Заказы из 1С», но вызов 1С не выполняется.

### Альтернатива: опрос со стороны 1С

1С может не принимать webhook, а сама периодически опрашивать заказы с изменённым статусом через REST API Supabase (по `updated_at` или `status != 'new'`).

---

## Кратко по шагам

1. Применить миграцию `029_customer_orders.sql` (если таблицы ещё нет или нужно добавить колонки для водителя/рейса).
2. Задеплоить Edge Function: `orders-1c-ingest` (если ещё не развёрнута).
3. В 1С: при формировании/подгрузке заказов на день вызывать `POST .../orders-1c-ingest` с телом по формату выше.
4. Вкладка «Заказы из 1С» в кабинете: выборка из `customer_orders`, распределение по водителям и рейсам, смена статусов; затем — опрос 1С или webhook по `order_1c_id`.
