# Заказы из 1С: приём в базу и обратная передача статусов

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

## Обратная передача статусов в 1С

Статусы и привязка к водителю/рейсу меняются в кабинете и хранятся в `customer_orders`. Связь с 1С — по полю **`order_1c_id`**.

1С может:
1. **Опрашивать** — периодически запрашивать заказы с изменённым статусом (например по `updated_at` или `status != 'new'`) через REST API Supabase.
2. **Получать webhook** — при смене статуса отправлять POST на URL 1С с телом вида:
   `{ "order_1c_id": "...", "status": "delivered", "updated_at": "..." }`.

---

## Кратко по шагам

1. Применить миграцию `029_customer_orders.sql` (если таблицы ещё нет или нужно добавить колонки для водителя/рейса).
2. Задеплоить Edge Function: `orders-1c-ingest` (если ещё не развёрнута).
3. В 1С: при формировании/подгрузке заказов на день вызывать `POST .../orders-1c-ingest` с телом по формату выше.
4. Вкладка «Заказы из 1С» в кабинете: выборка из `customer_orders`, распределение по водителям и рейсам, смена статусов; затем — опрос 1С или webhook по `order_1c_id`.
